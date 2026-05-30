<?php

namespace App\Application\Game\WebSocket;

use App\Domain\Localization\LanguageCatalog;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Psr\Log\LoggerInterface;

/**
 * Builds localized card payloads for WebSocket projections without hydrating ORM entities.
 */
final class GameWebsocketCardLocalizationResolver
{
    private const LOOKUP_PRESSURE_THRESHOLD_MS = 400;
    private const SOURCE_FIELDS = [
        'scryfallId',
        'name',
        'printedName',
        'lang',
        'imageUris',
        'cardFaces',
        'typeLine',
        'manaCost',
        'oracleText',
    ];
    private ?bool $printTablesAvailable = null;

    public function __construct(
        private readonly Connection $connection,
        private readonly ?LoggerInterface $logger = null,
    )
    {
    }

    /**
     * @param list<string> $requestedLanguages
     *
     * @return array<string,array<string,array<string,mixed>>>
     */
    public function buildLocalizedLookup(array $previousSnapshot, array $nextSnapshot, array $requestedLanguages): array
    {
        $startedAt = microtime(true);
        $languages = $this->normalizeRequestedLanguages($requestedLanguages);
        if ($languages === []) {
            return [];
        }

        $sourceIds = array_values(array_unique([
            ...$this->snapshotScryfallIds($previousSnapshot),
            ...$this->snapshotScryfallIds($nextSnapshot),
        ]));
        if ($sourceIds === []) {
            return [];
        }

        $sources = $this->fetchSources($sourceIds);
        if ($sources === []) {
            return [];
        }

        $lookupLanguages = array_values(array_unique([...$languages, LanguageCatalog::DEFAULT_LANGUAGE]));
        $exactCandidates = $this->fetchExactCandidates(array_keys($sources), $lookupLanguages);
        $selectedReferences = [];

        $localizedLookup = [];
        foreach ($languages as $language) {
            foreach ($sources as $scryfallId => $source) {
                $selectedReference = $this->preferredCandidateReference($source, $exactCandidates[$scryfallId] ?? [], $language);
                if ($selectedReference === null) {
                    $localizedLookup[$language][$scryfallId] = $this->payloadFromRow($source);
                    continue;
                }

                $selectedReferences[$selectedReference] = true;
                $localizedLookup[$language][$scryfallId] = [
                    '__selectedReference' => $selectedReference,
                ];
            }
        }

        $payloadsByReference = $this->fetchPayloadsByReference(array_keys($selectedReferences));
        foreach ($localizedLookup as $language => $cards) {
            foreach ($cards as $scryfallId => $payload) {
                if (!is_array($payload) || !isset($payload['__selectedReference'])) {
                    continue;
                }

                $reference = (string) $payload['__selectedReference'];
                $source = $sources[$scryfallId] ?? null;
                if (!is_array($source)) {
                    continue;
                }

                $row = $payloadsByReference[$reference] ?? $source;
                $localizedLookup[$language][$scryfallId] = $this->payloadFromRow($row);
            }
        }

        $elapsedMs = (microtime(true) - $startedAt) * 1000;
        if ($elapsedMs > self::LOOKUP_PRESSURE_THRESHOLD_MS) {
            $this->logger?->info('WS card localization lookup pressure detected.', [
                'elapsedMs' => round($elapsedMs, 2),
                'sourceCount' => count($sourceIds),
                'languageCount' => count($languages),
            ]);
        }

        return $localizedLookup;
    }

    /**
     * @param list<string> $scryfallIds
     *
     * @return array<string,array<string,mixed>>
     */
    private function fetchSources(array $scryfallIds): array
    {
        $sources = [];
        if ($this->printTablesAvailable()) {
            $sources = $this->fetchSourcesFromPrintTables($scryfallIds);
        }

        $missingIds = array_values(array_diff($scryfallIds, array_keys($sources)));
        if ($missingIds === []) {
            return $sources;
        }

        $rows = $this->connection->executeQuery(
            <<<'SQL'
SELECT
    scryfall_id,
    normalized_name,
    set_code,
    collector_number,
    name,
    printed_name,
    lang,
    image_uris,
    card_faces,
    type_line,
    mana_cost,
    oracle_text,
    image_status
FROM card
WHERE scryfall_id IN (:ids)
SQL,
            ['ids' => $missingIds],
            ['ids' => ArrayParameterType::STRING],
        )->fetchAllAssociative();
        foreach ($rows as $row) {
            $scryfallId = trim((string) ($row['scryfall_id'] ?? ''));
            if ($scryfallId === '') {
                continue;
            }

            $sources[$scryfallId] = $row;
        }

        return $sources;
    }

    /**
     * @param list<string> $sourceIds
     * @param list<string> $languages
     *
     * @return array<string,array<string,array<string,mixed>>>
     */
    private function fetchExactCandidates(array $sourceIds, array $languages): array
    {
        $candidatesBySource = [];
        if ($this->printTablesAvailable()) {
            $rows = $this->fetchExactCandidatesFromPrintTables($sourceIds, $languages);
            foreach ($rows as $row) {
                $sourceScryfallId = trim((string) ($row['source_scryfall_id'] ?? ''));
                $lang = trim((string) ($row['lang'] ?? ''));
                if ($sourceScryfallId === '' || $lang === '') {
                    continue;
                }

                $candidatesBySource[$sourceScryfallId][$lang] = $row;
            }
        }

        $needsLegacySourceIds = [];
        foreach ($sourceIds as $sourceId) {
            $sourceCandidates = $candidatesBySource[$sourceId] ?? [];
            foreach ($languages as $language) {
                if (!isset($sourceCandidates[$language])) {
                    $needsLegacySourceIds[$sourceId] = true;
                    break;
                }
            }
        }

        if ($needsLegacySourceIds === []) {
            return $candidatesBySource;
        }

        $legacyRows = $this->fetchExactCandidatesFromLegacy(array_keys($needsLegacySourceIds), $languages);
        foreach ($legacyRows as $row) {
            $sourceScryfallId = trim((string) ($row['source_scryfall_id'] ?? ''));
            $lang = trim((string) ($row['lang'] ?? ''));
            if ($sourceScryfallId === '' || $lang === '') {
                continue;
            }

            $candidatesBySource[$sourceScryfallId][$lang] ??= $row;
        }

        return $candidatesBySource;
    }

    /**
     * @param array<string,array<string,mixed>> $candidatesByLanguage
     */
    private function preferredCandidateReference(array $source, array $candidatesByLanguage, string $requestedLanguage): ?string
    {
        $exactRequested = $candidatesByLanguage[$requestedLanguage] ?? null;
        if ($exactRequested !== null && $this->isUsableCandidate($exactRequested, $requestedLanguage)) {
            return $this->candidateReference($exactRequested);
        }

        $exactEnglish = $candidatesByLanguage[LanguageCatalog::DEFAULT_LANGUAGE] ?? null;
        if ($exactEnglish !== null && $this->isUsableCandidate($exactEnglish, LanguageCatalog::DEFAULT_LANGUAGE)) {
            return $this->candidateReference($exactEnglish);
        }

        return null;
    }

    /**
     * @param array<string,mixed> $candidate
     */
    private function candidateReference(array $candidate): ?string
    {
        $scryfallId = $this->nullableString($candidate['candidate_scryfall_id'] ?? null);
        $lang = $this->nullableString($candidate['lang'] ?? null);
        if ($scryfallId === null || $lang === null) {
            return null;
        }

        return $scryfallId.'|'.$lang;
    }

    /**
     * @param array<string,mixed> $candidate
     */
    private function isUsableCandidate(array $candidate, string $requestedLanguage): bool
    {
        if ($this->nullableString($candidate['lang'] ?? null) !== $requestedLanguage) {
            return false;
        }

        if ($this->isImageStatusUnavailable($candidate['image_status'] ?? null)) {
            return false;
        }

        return true;
    }

    private function isImageStatusUnavailable(mixed $value): bool
    {
        $status = $this->nullableString($value);
        if ($status === null) {
            return false;
        }

        return in_array(strtolower($status), ['missing', 'placeholder'], true);
    }

    /**
     * @param array<string,mixed> $row
     *
     * @return array<string,mixed>
     */
    private function payloadFromRow(array $row): array
    {
        $payload = [];
        foreach (self::SOURCE_FIELDS as $field) {
            $payload[$field] = match ($field) {
                'imageUris' => $this->decodeJsonArray($row['image_uris'] ?? []),
                'cardFaces' => $this->decodeJsonArray($row['card_faces'] ?? []),
                default => $this->nullableString($row[$this->snakeCase($field)] ?? null),
            };
        }

        $displayName = trim((string) ($payload['printedName'] ?? ''));
        $payload['name'] = $displayName !== '' ? $displayName : (string) ($payload['name'] ?? '');

        return $payload;
    }

    /**
     * @return list<string>
     */
    private function normalizeRequestedLanguages(array $requestedLanguages): array
    {
        $languages = [];
        foreach ($requestedLanguages as $language) {
            if (!is_string($language)) {
                continue;
            }

            $normalized = LanguageCatalog::normalize($language);
            if ($normalized === null || !LanguageCatalog::isSupported($normalized)) {
                continue;
            }

            $languages[$normalized] = true;
        }

        return array_keys($languages);
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return list<string>
     */
    private function snapshotScryfallIds(array $snapshot): array
    {
        $ids = [];
        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return [];
        }

        foreach ($players as $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            foreach ($player['zones'] as $cards) {
                if (!is_array($cards)) {
                    continue;
                }

                foreach ($cards as $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
                    if ($scryfallId !== '') {
                        $ids[$scryfallId] = true;
                    }
                }
            }
        }

        return array_keys($ids);
    }

    private function nullableString(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string === '' ? null : $string;
    }

    /**
     * @return array<int|string,mixed>
     */
    private function decodeJsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function snakeCase(string $field): string
    {
        return strtolower(preg_replace('/([a-z])([A-Z])/', '$1_$2', $field) ?? $field);
    }

    /**
     * @param list<string> $scryfallIds
     *
     * @return array<string,array<string,mixed>>
     */
    private function fetchSourcesFromPrintTables(array $scryfallIds): array
    {
        $rows = $this->connection->executeQuery(
            <<<'SQL'
SELECT
    p.scryfall_id,
    p.normalized_name,
    p.set_code,
    p.collector_number,
    p.default_name AS name,
    NULL::VARCHAR AS printed_name,
    COALESCE(p.default_lang, 'en') AS lang,
    p.default_image_uris AS image_uris,
    p.default_card_faces AS card_faces,
    p.default_type_line AS type_line,
    p.default_mana_cost AS mana_cost,
    p.default_oracle_text AS oracle_text,
    NULL::VARCHAR AS image_status
FROM card_print p
WHERE p.scryfall_id IN (:ids)
SQL,
            ['ids' => $scryfallIds],
            ['ids' => ArrayParameterType::STRING],
        )->fetchAllAssociative();

        $sources = [];
        foreach ($rows as $row) {
            $scryfallId = trim((string) ($row['scryfall_id'] ?? ''));
            if ($scryfallId === '') {
                continue;
            }

            $sources[$scryfallId] = $row;
        }

        return $sources;
    }

    /**
     * @param list<string> $sourceIds
     * @param list<string> $languages
     *
     * @return list<array<string,mixed>>
     */
    private function fetchExactCandidatesFromPrintTables(array $sourceIds, array $languages): array
    {
        return $this->connection->executeQuery(
            <<<'SQL'
SELECT
    source.scryfall_id AS source_scryfall_id,
    target.scryfall_id AS candidate_scryfall_id,
    l.lang,
    l.image_status
FROM card_print source
INNER JOIN card_print target
    ON target.set_code = source.set_code
   AND target.collector_number = source.collector_number
INNER JOIN card_print_locale l ON l.print_scryfall_id = target.scryfall_id
WHERE source.scryfall_id IN (:sourceIds)
  AND l.lang IN (:languages)
ORDER BY source.scryfall_id ASC
SQL,
            [
                'sourceIds' => $sourceIds,
                'languages' => $languages,
            ],
            [
                'sourceIds' => ArrayParameterType::STRING,
                'languages' => ArrayParameterType::STRING,
            ],
        )->fetchAllAssociative();
    }

    /**
     * @param list<string> $sourceIds
     * @param list<string> $languages
     *
     * @return list<array<string,mixed>>
     */
    private function fetchExactCandidatesFromLegacy(array $sourceIds, array $languages): array
    {
        return $this->connection->executeQuery(
            <<<'SQL'
SELECT
    source.scryfall_id AS source_scryfall_id,
    candidate.scryfall_id AS candidate_scryfall_id,
    candidate.lang,
    candidate.image_status
FROM card source
INNER JOIN card candidate
    ON candidate.set_code = source.set_code
   AND candidate.collector_number = source.collector_number
WHERE source.scryfall_id IN (:sourceIds)
  AND candidate.lang IN (:languages)
ORDER BY source.scryfall_id ASC
SQL,
            [
                'sourceIds' => $sourceIds,
                'languages' => $languages,
            ],
            [
                'sourceIds' => ArrayParameterType::STRING,
                'languages' => ArrayParameterType::STRING,
            ],
        )->fetchAllAssociative();
    }

    /**
     * @param list<string> $references
     *
     * @return array<string,array<string,mixed>>
     */
    private function fetchPayloadsByReference(array $references): array
    {
        if ($references === []) {
            return [];
        }

        $ids = [];
        $languages = [];
        foreach ($references as $reference) {
            [$scryfallId, $lang] = explode('|', $reference, 2) + [null, null];
            if (!is_string($scryfallId) || !is_string($lang) || trim($scryfallId) === '' || trim($lang) === '') {
                continue;
            }

            $ids[$scryfallId] = true;
            $languages[$lang] = true;
        }

        if ($ids === [] || $languages === []) {
            return [];
        }

        $payloads = [];
        if ($this->printTablesAvailable()) {
            $rows = $this->connection->executeQuery(
                <<<'SQL'
SELECT
    p.scryfall_id,
    l.lang,
    l.name,
    l.printed_name,
    l.image_uris,
    l.card_faces,
    l.type_line,
    l.mana_cost,
    l.oracle_text
FROM card_print p
INNER JOIN card_print_locale l ON l.print_scryfall_id = p.scryfall_id
WHERE p.scryfall_id IN (:ids)
  AND l.lang IN (:languages)
SQL,
                [
                    'ids' => array_keys($ids),
                    'languages' => array_keys($languages),
                ],
                [
                    'ids' => ArrayParameterType::STRING,
                    'languages' => ArrayParameterType::STRING,
                ],
            )->fetchAllAssociative();

            foreach ($rows as $row) {
                $scryfallId = trim((string) ($row['scryfall_id'] ?? ''));
                $lang = trim((string) ($row['lang'] ?? ''));
                if ($scryfallId === '' || $lang === '') {
                    continue;
                }

                $payloads[$scryfallId.'|'.$lang] = $row;
            }
        }

        $missingById = [];
        foreach ($references as $reference) {
            if (!isset($payloads[$reference])) {
                [$scryfallId] = explode('|', $reference, 2) + [null, null];
                if (is_string($scryfallId) && trim($scryfallId) !== '') {
                    $missingById[$scryfallId] = true;
                }
            }
        }
        if ($missingById === []) {
            return $payloads;
        }

        $legacyRows = $this->connection->executeQuery(
            <<<'SQL'
SELECT
    scryfall_id,
    lang,
    name,
    printed_name,
    image_uris,
    card_faces,
    type_line,
    mana_cost,
    oracle_text
FROM card
WHERE scryfall_id IN (:ids)
  AND lang IN (:languages)
SQL,
            [
                'ids' => array_keys($missingById),
                'languages' => array_keys($languages),
            ],
            [
                'ids' => ArrayParameterType::STRING,
                'languages' => ArrayParameterType::STRING,
            ],
        )->fetchAllAssociative();

        foreach ($legacyRows as $row) {
            $scryfallId = trim((string) ($row['scryfall_id'] ?? ''));
            $lang = trim((string) ($row['lang'] ?? ''));
            if ($scryfallId === '' || $lang === '') {
                continue;
            }

            $payloads[$scryfallId.'|'.$lang] ??= $row;
        }

        return $payloads;
    }

    private function printTablesAvailable(): bool
    {
        if ($this->printTablesAvailable !== null) {
            return $this->printTablesAvailable;
        }

        try {
            $cardPrint = $this->connection->fetchOne("SELECT to_regclass('public.card_print')");
            $cardPrintLocale = $this->connection->fetchOne("SELECT to_regclass('public.card_print_locale')");

            $this->printTablesAvailable = is_string($cardPrint)
                && $cardPrint !== ''
                && is_string($cardPrintLocale)
                && $cardPrintLocale !== '';
        } catch (\Throwable) {
            $this->printTablesAvailable = false;
        }

        return $this->printTablesAvailable;
    }
}
