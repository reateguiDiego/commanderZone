<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;
use Doctrine\DBAL\Connection;
use Symfony\Component\Uid\Uuid;

final class DeckAnalysisSnapshotService
{
    private const ANALYZER_VERSION = 'basic_deck_analysis_v2';

    public function __construct(
        private readonly Connection $connection,
        private readonly DeckAnalysisDataVersionProvider $versionProvider,
        private readonly DeckAnalysisDeckHasher $deckHasher,
        private readonly ?\App\Infrastructure\Observability\RequestPerformanceContext $performance = null,
        private readonly ?\Doctrine\ORM\EntityManagerInterface $entityManager = null,
        private readonly ?\App\Application\Community\CommunityCache $communityCache = null,
    ) {
    }

    /**
     * @param array<string,mixed> $options
     * @return array<string,mixed>
     */
    public function analyze(Deck $deck, DeckAnalysisService $analysis, array $options = []): array
    {
        $normalizedOptions = $analysis->normalizeOptions($options);
        $context = $this->context($deck, $normalizedOptions);
        $existing = $this->snapshotRow($deck->id(), $context['options_hash']);
        $staleReason = $this->staleReason($existing, $context);

        if ($existing !== null && $staleReason === null) {
            $result = $this->jsonObject($existing['result_json'] ?? null);
            $result['snapshot'] = $this->metadata(true, 'fresh', $existing, $context);

            return $result;
        }

        return $this->calculateSnapshot($deck, $normalizedOptions, fn () => $analysis->analyze($deck, $normalizedOptions));
    }

    public function bracket(Deck $deck, DeckBracketSignalProvider $bracketSignalProvider): array
    {
        return $this->calculateSnapshot($deck, ['view' => 'bracket'], fn () => ['bracket' => $bracketSignalProvider->analysis($deck)['bracket']]);
    }

    private function calculateSnapshot(Deck $deck, array $options, callable $calculate): array
    {
        return (new DeckAnalysisExecution($this->connection))->run($deck->id(), 'basic', function () use ($deck, $options, $calculate): array {
            for ($attempt = 0; $attempt < 2; ++$attempt) {
                $context = $this->context($deck, $options);
                $existing = $this->snapshotRow($deck->id(), $context['options_hash']);
                $reason = $this->staleReason($existing, $context);
                if ($existing !== null && $reason === null) {
                    return [...$this->jsonObject($existing['result_json'] ?? null), 'snapshot' => $this->metadata(true, 'fresh', $existing, $context)];
                }
                // Refresh the fetch-joined collection, including removals, before a retry.
                if ($this->entityManager !== null && ($options['view'] ?? '') !== 'bracket') {
                    $this->entityManager->createQuery('SELECT d, dc, c FROM '.Deck::class.' d LEFT JOIN d.cards dc LEFT JOIN dc.card c WHERE d.id = :id')
                        ->setParameter('id', $deck->id())->setHint(\Doctrine\ORM\Query::HINT_REFRESH, true)->getResult();
                }
                $result = $this->performance?->measure('analysis.basic.calculate', $calculate) ?? $calculate();
                if ($this->context($deck, $options) !== $context) continue;
                $saved = $this->saveSnapshot($deck->id(), $context, $result, $existing);
                $this->communityCache?->invalidate(['community.home', 'community.decks', 'community.user.'.$deck->owner()->id()]);
                $result['snapshot'] = $this->metadata(false, $reason ?? 'missing', $saved, $context);
                return $result;
            }
            throw new \Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException(1, 'Deck changed during analysis. Please retry.');
        });
    }

    public function deckHash(Deck $deck): string
    {
        return $this->deckHasher->hash($deck);
    }

    /**
     * @param array<string,mixed> $options
     * @return array<string,mixed>
     */
    public function context(Deck $deck, array $options): array
    {
        $versions = $this->versionProvider->currentVersions();
        $deckHash = $this->deckHasher->hash($deck, $options);

        return [
            'deck_hash' => $deckHash,
            'options_hash' => $this->optionsHash($options),
            'analyzer_version' => self::ANALYZER_VERSION,
            'semantic_data_version' => $versions[DeckAnalysisDataVersionProvider::KEY_SEMANTIC],
            'mana_data_version' => $versions[DeckAnalysisDataVersionProvider::KEY_MANA],
            'combo_data_version' => $versions[DeckAnalysisDataVersionProvider::KEY_COMBO],
            'rules_version' => $versions[DeckAnalysisDataVersionProvider::KEY_RULES],
        ];
    }

    /**
     * @param array<string,mixed>|null $row
     * @param array<string,mixed> $context
     */
    private function staleReason(?array $row, array $context): ?string
    {
        if ($row === null) {
            return 'missing';
        }

        foreach ([
            'deck_hash' => 'deck_hash_changed',
            'options_hash' => 'options_changed',
            'analyzer_version' => 'analyzer_version_changed',
            'semantic_data_version' => 'semantic_data_changed',
            'mana_data_version' => 'mana_data_changed',
            'combo_data_version' => 'combo_data_changed',
            'rules_version' => 'rules_changed',
        ] as $field => $reason) {
            if ((string) ($row[$field] ?? '') !== (string) $context[$field]) {
                return $reason;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $context
     * @param array<string,mixed> $result
     * @param array<string,mixed>|null $existing
     * @return array<string,mixed>
     */
    private function saveSnapshot(string $deckId, array $context, array $result, ?array $existing): array
    {
        $id = is_string($existing['id'] ?? null) ? $existing['id'] : Uuid::v7()->toRfc4122();
        $payload = json_encode($result, JSON_THROW_ON_ERROR);
        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO deck_analysis_snapshot (
    id,
    deck_id,
    deck_hash,
    options_hash,
    analyzer_version,
    semantic_data_version,
    mana_data_version,
    combo_data_version,
    rules_version,
    result_json,
    calculated_at,
    created_at,
    updated_at
) VALUES (
    :id,
    :deck_id,
    :deck_hash,
    :options_hash,
    :analyzer_version,
    :semantic_data_version,
    :mana_data_version,
    :combo_data_version,
    :rules_version,
    :result_json::jsonb,
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (deck_id, options_hash) DO UPDATE SET
    deck_hash = EXCLUDED.deck_hash,
    analyzer_version = EXCLUDED.analyzer_version,
    semantic_data_version = EXCLUDED.semantic_data_version,
    mana_data_version = EXCLUDED.mana_data_version,
    combo_data_version = EXCLUDED.combo_data_version,
    rules_version = EXCLUDED.rules_version,
    result_json = EXCLUDED.result_json,
    calculated_at = EXCLUDED.calculated_at,
    updated_at = EXCLUDED.updated_at
SQL,
            [
                'id' => $id,
                'deck_id' => $deckId,
                ...$context,
                'result_json' => $payload,
            ],
        );

        return $this->snapshotRow($deckId, $context['options_hash']) ?? [
            'id' => $id,
            'calculated_at' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
            ...$context,
        ];
    }

    /**
     * @return array<string,mixed>|null
     */
    private function snapshotRow(string $deckId, string $optionsHash): ?array
    {
        $read = fn () => $this->connection->fetchAssociative(
            'SELECT * FROM deck_analysis_snapshot WHERE deck_id = :deck_id AND options_hash = :options_hash',
            [
                'deck_id' => $deckId,
                'options_hash' => $optionsHash,
            ],
        );

        $row = $this->performance?->measure('analysis.basic.snapshot_read', $read) ?? $read();

        return is_array($row) ? $row : null;
    }

    /**
     * @param array<string,mixed> $row
     * @param array<string,mixed> $context
     * @return array<string,mixed>
     */
    private function metadata(bool $hit, string $reason, array $row, array $context): array
    {
        return [
            'hit' => $hit,
            'reason' => $reason,
            'calculatedAt' => $this->dateString($row['calculated_at'] ?? null),
            'deckHash' => $context['deck_hash'],
            'optionsHash' => $context['options_hash'],
            'analyzerVersion' => $context['analyzer_version'],
            'semanticDataVersion' => $context['semantic_data_version'],
            'manaDataVersion' => $context['mana_data_version'],
            'comboDataVersion' => $context['combo_data_version'],
            'rulesVersion' => $context['rules_version'],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function jsonObject(mixed $value): array
    {
        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function dateString(mixed $value): ?string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format(\DateTimeInterface::ATOM);
        }

        if (!is_scalar($value) || trim((string) $value) === '') {
            return null;
        }

        return (new \DateTimeImmutable((string) $value))->format(\DateTimeInterface::ATOM);
    }

    /**
     * @param array<string,mixed> $options
     */
    private function optionsHash(array $options): string
    {
        ksort($options);

        return hash('sha256', json_encode($options, JSON_THROW_ON_ERROR));
    }
}
