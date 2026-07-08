<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Uid\Uuid;

final class SpellbookSyncService
{
    public const SOURCE = 'spellbook';

    public function __construct(
        private readonly CommanderSpellbookClient $client,
        private readonly Connection $connection,
    ) {
    }

    /**
     * @param null|callable(string,array{seen:int,inserted:int,updated:int,failed:int}):void $progress
     * @return array{
     *   runId:string,
     *   status:string,
     *   itemsSeen:int,
     *   itemsInserted:int,
     *   itemsUpdated:int,
     *   itemsFailed:int,
     *   warnings:list<string>
     * }
     */
    public function sync(?callable $progress = null): array
    {
        $runId = Uuid::v7()->toRfc4122();
        $endpoints = $this->client->endpointNames();
        $this->markInterruptedRuns();
        $this->startRun($runId, $endpoints);

        $seen = 0;
        $inserted = 0;
        $updated = 0;
        $failed = 0;
        $warnings = [];

        try {
            foreach ($this->client->features() as $feature) {
                ++$seen;
                $result = $this->upsertFeature($feature, $warnings);
                $inserted += $result === 'inserted' ? 1 : 0;
                $updated += $result === 'updated' ? 1 : 0;
                $failed += $result === 'failed' ? 1 : 0;
            }
            $this->progress($runId, 'features', $seen, $inserted, $updated, $failed, $progress);

            foreach ($this->client->templates() as $template) {
                ++$seen;
                $result = $this->upsertTemplate($template, $warnings);
                $inserted += $result === 'inserted' ? 1 : 0;
                $updated += $result === 'updated' ? 1 : 0;
                $failed += $result === 'failed' ? 1 : 0;
            }
            $this->progress($runId, 'templates', $seen, $inserted, $updated, $failed, $progress);

            $featureIds = $this->featureIdsByExternalId();
            $templateIds = $this->templateIdsByExternalId();

            foreach ($this->client->variants() as $variant) {
                ++$seen;
                $result = $this->syncVariant($variant, $featureIds, $templateIds, $warnings);
                $inserted += $result['status'] === 'inserted' ? 1 : 0;
                $updated += $result['status'] === 'updated' ? 1 : 0;
                $failed += $result['failed'];

                if ($seen % 1000 === 0) {
                    $this->progress($runId, 'variants', $seen, $inserted, $updated, $failed, $progress);
                }
            }
            $this->progress($runId, 'variants', $seen, $inserted, $updated, $failed, $progress);

            $this->finishRun($runId, 'success', $seen, $inserted, $updated, $failed, $warnings, $endpoints);

            return [
                'runId' => $runId,
                'status' => 'success',
                'itemsSeen' => $seen,
                'itemsInserted' => $inserted,
                'itemsUpdated' => $updated,
                'itemsFailed' => $failed,
                'warnings' => $warnings,
            ];
        } catch (\Throwable $exception) {
            $this->finishRun($runId, 'failed', $seen, $inserted, $updated, $failed + 1, [$exception->getMessage()], $endpoints);

            throw $exception;
        }
    }

    private function markInterruptedRuns(): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
UPDATE external_sync_run
SET finished_at = NOW(),
    status = 'interrupted',
    error_summary = COALESCE(error_summary, 'Previous Spellbook sync did not finish.')
WHERE source = :source
  AND status = 'running'
SQL,
            ['source' => self::SOURCE],
        );
    }

    /**
     * @param null|callable(string,array{seen:int,inserted:int,updated:int,failed:int}):void $progress
     */
    private function progress(
        string $runId,
        string $endpoint,
        int $seen,
        int $inserted,
        int $updated,
        int $failed,
        ?callable $progress,
    ): void {
        $this->connection->executeStatement(
            <<<'SQL'
UPDATE external_sync_run
SET items_seen = :items_seen,
    items_inserted = :items_inserted,
    items_updated = :items_updated,
    items_failed = :items_failed,
    metadata = (metadata::jsonb || :metadata::jsonb)::json
WHERE id = :id
SQL,
            [
                'id' => $runId,
                'items_seen' => $seen,
                'items_inserted' => $inserted,
                'items_updated' => $updated,
                'items_failed' => $failed,
                'metadata' => $this->json(['current_endpoint' => $endpoint]),
            ],
        );

        if ($progress !== null) {
            $progress($endpoint, [
                'seen' => $seen,
                'inserted' => $inserted,
                'updated' => $updated,
                'failed' => $failed,
            ]);
        }
    }

    /**
     * @param array<string,mixed> $feature
     * @param list<string> $warnings
     */
    private function upsertFeature(array $feature, array &$warnings): string
    {
        $externalId = $this->externalId($feature['id'] ?? null);
        $name = $this->stringOrNull($feature['name'] ?? null);
        if ($externalId === null || $name === null) {
            $warnings[] = 'Spellbook feature skipped because id or name was missing.';

            return 'failed';
        }

        $row = [
            'external_id' => $externalId,
            'name' => $name,
            'normalized_name' => $this->normalizeName($name),
            'feature_type' => $this->featureType($name),
            'uncountable' => $this->boolValue($feature['uncountable'] ?? false),
            'status' => $this->stringOrNull($feature['status'] ?? null),
        ];
        $existing = $this->connection->fetchAssociative(
            'SELECT name, normalized_name, feature_type, uncountable, status FROM spellbook_feature WHERE external_id = :externalId',
            ['externalId' => $externalId],
        );

        if ($existing === false) {
            $this->connection->executeStatement(
                <<<'SQL'
INSERT INTO spellbook_feature (
    id,
    external_id,
    name,
    normalized_name,
    feature_type,
    uncountable,
    status
) VALUES (
    :id,
    :external_id,
    :name,
    :normalized_name,
    :feature_type,
    :uncountable,
    :status
)
SQL,
                ['id' => Uuid::v7()->toRfc4122(), ...$row],
                ['uncountable' => ParameterType::BOOLEAN],
            );

            return 'inserted';
        }

        if ($this->featureMatches($existing, $row)) {
            return 'skipped';
        }

        $this->connection->executeStatement(
            <<<'SQL'
UPDATE spellbook_feature
SET name = :name,
    normalized_name = :normalized_name,
    feature_type = :feature_type,
    uncountable = :uncountable,
    status = :status
WHERE external_id = :external_id
SQL,
            $row,
            ['uncountable' => ParameterType::BOOLEAN],
        );

        return 'updated';
    }

    /**
     * @param array<string,mixed> $template
     * @param list<string> $warnings
     */
    private function upsertTemplate(array $template, array &$warnings): string
    {
        $externalId = $this->externalId($template['id'] ?? null);
        $name = $this->stringOrNull($template['name'] ?? null);
        if ($externalId === null || $name === null) {
            $warnings[] = 'Spellbook template skipped because id or name was missing.';

            return 'failed';
        }

        $row = [
            'external_id' => $externalId,
            'name' => $name,
            'scryfall_query' => $this->stringOrNull($template['scryfallQuery'] ?? $template['scryfall_query'] ?? null),
            'scryfall_api' => $this->stringOrNull($template['scryfallApi'] ?? $template['scryfall_api'] ?? null),
        ];
        $existing = $this->connection->fetchAssociative(
            'SELECT name, scryfall_query, scryfall_api FROM spellbook_template WHERE external_id = :externalId',
            ['externalId' => $externalId],
        );

        if ($existing === false) {
            $this->connection->executeStatement(
                <<<'SQL'
INSERT INTO spellbook_template (
    id,
    external_id,
    name,
    scryfall_query,
    scryfall_api
) VALUES (
    :id,
    :external_id,
    :name,
    :scryfall_query,
    :scryfall_api
)
SQL,
                ['id' => Uuid::v7()->toRfc4122(), ...$row],
            );

            return 'inserted';
        }

        if ($this->templateMatches($existing, $row)) {
            return 'skipped';
        }

        $this->connection->executeStatement(
            <<<'SQL'
UPDATE spellbook_template
SET name = :name,
    scryfall_query = :scryfall_query,
    scryfall_api = :scryfall_api
WHERE external_id = :external_id
SQL,
            $row,
        );

        return 'updated';
    }

    /**
     * @param array<string,mixed> $variant
     * @param array<string,string> $featureIds
     * @param array<string,string> $templateIds
     * @param list<string> $warnings
     * @return array{status:string,failed:int}
     */
    private function syncVariant(array $variant, array $featureIds, array $templateIds, array &$warnings): array
    {
        $externalId = $this->externalId($variant['id'] ?? null);
        if ($externalId === null) {
            $warnings[] = 'Spellbook variant skipped because id was missing.';

            return ['status' => 'failed', 'failed' => 1];
        }

        if ($this->boolValue($variant['spoiler'] ?? false)) {
            return ['status' => 'skipped', 'failed' => 0];
        }

        $legalities = $variant['legalities'] ?? null;
        if (is_array($legalities)) {
            if (($legalities['commander'] ?? null) === false) {
                return ['status' => 'skipped', 'failed' => 0];
            }
        } else {
            $warnings[] = sprintf('Spellbook variant "%s" did not include legalities metadata.', $externalId);
        }

        $variantId = $this->variantIdForExternalId($externalId) ?? Uuid::v7()->toRfc4122();
        $sourceHash = $this->sourceHash($variant);
        $existingHash = $this->connection->fetchOne(
            'SELECT source_hash FROM spellbook_combo_variant WHERE external_id = :externalId',
            ['externalId' => $externalId],
        );
        if (is_string($existingHash) && hash_equals($existingHash, $sourceHash)) {
            return ['status' => 'skipped', 'failed' => 0];
        }

        $row = [
            'id' => $variantId,
            'external_id' => $externalId,
            'identity' => $this->json($this->identity($variant['identity'] ?? [])),
            'status' => $this->stringOrNull($variant['status'] ?? null),
            'popularity' => $this->intOrNull($variant['popularity'] ?? null),
            'bracket_tag' => $this->stringOrNull($variant['bracketTag'] ?? $variant['bracket_tag'] ?? null),
            'description' => $this->stringOrNull($variant['description'] ?? null),
            'mana_needed' => $this->stringOrNull($variant['manaNeeded'] ?? $variant['mana_needed'] ?? null),
            'mana_value_needed' => is_numeric($variant['manaValueNeeded'] ?? $variant['mana_value_needed'] ?? null)
                ? (string) (float) ($variant['manaValueNeeded'] ?? $variant['mana_value_needed'])
                : null,
            'easy_prerequisites' => $this->stringOrNull($variant['easyPrerequisites'] ?? $variant['easy_prerequisites'] ?? null),
            'notable_prerequisites' => $this->stringOrNull($variant['notablePrerequisites'] ?? $variant['notable_prerequisites'] ?? null),
            'variant_count' => $this->intOrNull($variant['variantCount'] ?? $variant['variant_count'] ?? null),
            'source_hash' => $sourceHash,
        ];

        return $this->connection->transactional(function () use ($row, $variant, $featureIds, $templateIds, &$warnings, $existingHash): array {
            $this->connection->executeStatement(
                <<<'SQL'
INSERT INTO spellbook_combo_variant (
    id,
    external_id,
    identity,
    status,
    popularity,
    bracket_tag,
    description,
    mana_needed,
    mana_value_needed,
    easy_prerequisites,
    notable_prerequisites,
    variant_count,
    source_hash,
    synced_at
) VALUES (
    :id,
    :external_id,
    :identity,
    :status,
    :popularity,
    :bracket_tag,
    :description,
    :mana_needed,
    :mana_value_needed,
    :easy_prerequisites,
    :notable_prerequisites,
    :variant_count,
    :source_hash,
    NOW()
)
ON CONFLICT (external_id) DO UPDATE SET
    identity = EXCLUDED.identity,
    status = EXCLUDED.status,
    popularity = EXCLUDED.popularity,
    bracket_tag = EXCLUDED.bracket_tag,
    description = EXCLUDED.description,
    mana_needed = EXCLUDED.mana_needed,
    mana_value_needed = EXCLUDED.mana_value_needed,
    easy_prerequisites = EXCLUDED.easy_prerequisites,
    notable_prerequisites = EXCLUDED.notable_prerequisites,
    variant_count = EXCLUDED.variant_count,
    source_hash = EXCLUDED.source_hash,
    synced_at = NOW()
SQL,
                $row,
            );

            $failed = 0;
            $variantWarnings = [];
            $this->replaceVariantRelations($row['id'], $variant, $featureIds, $templateIds, $variantWarnings, $failed);
            foreach ($variantWarnings as $warning) {
                $warnings[] = $warning;
            }

            return [
                'status' => is_string($existingHash) ? 'updated' : 'inserted',
                'failed' => $failed,
            ];
        });
    }

    /**
     * @param array<string,mixed> $variant
     * @param array<string,string> $featureIds
     * @param array<string,string> $templateIds
     * @param list<string> $warnings
     */
    private function replaceVariantRelations(string $variantId, array $variant, array $featureIds, array $templateIds, array &$warnings, int &$failed): void
    {
        $this->connection->executeStatement('DELETE FROM spellbook_combo_card WHERE combo_variant_id = :variantId', ['variantId' => $variantId]);
        $this->connection->executeStatement('DELETE FROM spellbook_combo_feature WHERE combo_variant_id = :variantId', ['variantId' => $variantId]);
        $this->connection->executeStatement('DELETE FROM spellbook_combo_requirement WHERE combo_variant_id = :variantId', ['variantId' => $variantId]);

        foreach ($this->listValue($variant['uses'] ?? []) as $use) {
            if (!is_array($use)) {
                continue;
            }

            $card = is_array($use['card'] ?? null) ? $use['card'] : [];
            $oracleId = $this->stringOrNull($card['oracleId'] ?? $card['oracle_id'] ?? null);
            $name = $this->stringOrNull($card['name'] ?? null);
            if ($oracleId === null) {
                ++$failed;
                $warnings[] = sprintf('Spellbook variant "%s" use skipped because oracleId was missing.', (string) ($variant['id'] ?? 'unknown'));
                continue;
            }

            $this->connection->executeStatement(
                <<<'SQL'
INSERT INTO spellbook_combo_card (
    id,
    combo_variant_id,
    oracle_id,
    name,
    quantity,
    zone_locations,
    must_be_commander,
    battlefield_card_state,
    graveyard_card_state,
    library_card_state,
    exile_card_state
) VALUES (
    :id,
    :combo_variant_id,
    :oracle_id,
    :name,
    :quantity,
    :zone_locations,
    :must_be_commander,
    :battlefield_card_state,
    :graveyard_card_state,
    :library_card_state,
    :exile_card_state
)
SQL,
                [
                    'id' => Uuid::v7()->toRfc4122(),
                    'combo_variant_id' => $variantId,
                    'oracle_id' => $oracleId,
                    'name' => $name ?? 'Unknown card',
                    'quantity' => $this->intOrNull($use['quantity'] ?? null) ?? 1,
                    'zone_locations' => $this->json($this->listValue($use['zoneLocations'] ?? $use['zone_locations'] ?? [])),
                    'must_be_commander' => $this->boolValue($use['mustBeCommander'] ?? $use['must_be_commander'] ?? false),
                    'battlefield_card_state' => $this->stringOrNull($use['battlefieldCardState'] ?? $use['battlefield_card_state'] ?? null),
                    'graveyard_card_state' => $this->stringOrNull($use['graveyardCardState'] ?? $use['graveyard_card_state'] ?? null),
                    'library_card_state' => $this->stringOrNull($use['libraryCardState'] ?? $use['library_card_state'] ?? null),
                    'exile_card_state' => $this->stringOrNull($use['exileCardState'] ?? $use['exile_card_state'] ?? null),
                ],
                ['must_be_commander' => ParameterType::BOOLEAN],
            );
        }

        foreach ($this->listValue($variant['produces'] ?? []) as $produce) {
            if (!is_array($produce)) {
                continue;
            }

            $feature = is_array($produce['feature'] ?? null) ? $produce['feature'] : [];
            $featureExternalId = $this->externalId($feature['id'] ?? null);
            $featureId = $featureExternalId !== null ? ($featureIds[$featureExternalId] ?? null) : null;
            if ($featureId === null) {
                ++$failed;
                $warnings[] = sprintf('Spellbook variant "%s" produce skipped because feature was not imported.', (string) ($variant['id'] ?? 'unknown'));
                continue;
            }

            $this->connection->executeStatement(
                <<<'SQL'
INSERT INTO spellbook_combo_feature (
    combo_variant_id,
    feature_id,
    quantity
) VALUES (
    :combo_variant_id,
    :feature_id,
    :quantity
)
ON CONFLICT (combo_variant_id, feature_id) DO UPDATE SET
    quantity = EXCLUDED.quantity
SQL,
                [
                    'combo_variant_id' => $variantId,
                    'feature_id' => $featureId,
                    'quantity' => $this->intOrNull($produce['quantity'] ?? null),
                ],
            );
        }

        foreach ($this->listValue($variant['requires'] ?? []) as $requirement) {
            if (!is_array($requirement)) {
                continue;
            }

            $template = is_array($requirement['template'] ?? null) ? $requirement['template'] : [];
            $templateExternalId = $this->externalId($template['id'] ?? null);
            $templateId = $templateExternalId !== null ? ($templateIds[$templateExternalId] ?? null) : null;
            if ($templateExternalId !== null && $templateId === null) {
                ++$failed;
                $warnings[] = sprintf('Spellbook variant "%s" requirement template "%s" was not imported.', (string) ($variant['id'] ?? 'unknown'), $templateExternalId);
            }

            $this->connection->executeStatement(
                <<<'SQL'
INSERT INTO spellbook_combo_requirement (
    id,
    combo_variant_id,
    template_id,
    quantity,
    zone_locations,
    must_be_commander,
    battlefield_card_state,
    graveyard_card_state,
    library_card_state,
    exile_card_state
) VALUES (
    :id,
    :combo_variant_id,
    :template_id,
    :quantity,
    :zone_locations,
    :must_be_commander,
    :battlefield_card_state,
    :graveyard_card_state,
    :library_card_state,
    :exile_card_state
)
SQL,
                [
                    'id' => Uuid::v7()->toRfc4122(),
                    'combo_variant_id' => $variantId,
                    'template_id' => $templateId,
                    'quantity' => $this->intOrNull($requirement['quantity'] ?? null) ?? 1,
                    'zone_locations' => $this->json($this->listValue($requirement['zoneLocations'] ?? $requirement['zone_locations'] ?? [])),
                    'must_be_commander' => $this->boolValue($requirement['mustBeCommander'] ?? $requirement['must_be_commander'] ?? false),
                    'battlefield_card_state' => $this->stringOrNull($requirement['battlefieldCardState'] ?? $requirement['battlefield_card_state'] ?? null),
                    'graveyard_card_state' => $this->stringOrNull($requirement['graveyardCardState'] ?? $requirement['graveyard_card_state'] ?? null),
                    'library_card_state' => $this->stringOrNull($requirement['libraryCardState'] ?? $requirement['library_card_state'] ?? null),
                    'exile_card_state' => $this->stringOrNull($requirement['exileCardState'] ?? $requirement['exile_card_state'] ?? null),
                ],
                ['must_be_commander' => ParameterType::BOOLEAN],
            );
        }
    }

    /**
     * @return array<string,string>
     */
    private function featureIdsByExternalId(): array
    {
        return $this->idsByExternalId('spellbook_feature');
    }

    /**
     * @return array<string,string>
     */
    private function templateIdsByExternalId(): array
    {
        return $this->idsByExternalId('spellbook_template');
    }

    /**
     * @return array<string,string>
     */
    private function idsByExternalId(string $table): array
    {
        $rows = $this->connection->fetchAllAssociative(sprintf('SELECT external_id, id FROM %s', $table));
        $ids = [];
        foreach ($rows as $row) {
            $ids[(string) $row['external_id']] = (string) $row['id'];
        }

        return $ids;
    }

    private function variantIdForExternalId(string $externalId): ?string
    {
        $id = $this->connection->fetchOne(
            'SELECT id FROM spellbook_combo_variant WHERE external_id = :externalId',
            ['externalId' => $externalId],
        );

        return is_string($id) && $id !== '' ? $id : null;
    }

    /**
     * @param list<string> $endpoints
     */
    private function startRun(string $runId, array $endpoints): void
    {
        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO external_sync_run (
    id,
    source,
    started_at,
    status,
    metadata
) VALUES (
    :id,
    :source,
    NOW(),
    'running',
    :metadata
)
SQL,
            [
                'id' => $runId,
                'source' => self::SOURCE,
                'metadata' => $this->json(['endpoints' => $endpoints]),
            ],
        );
    }

    /**
     * @param list<string> $warnings
     * @param list<string> $endpoints
     */
    private function finishRun(
        string $runId,
        string $status,
        int $itemsSeen,
        int $itemsInserted,
        int $itemsUpdated,
        int $itemsFailed,
        array $warnings,
        array $endpoints,
    ): void {
        $this->connection->executeStatement(
            <<<'SQL'
UPDATE external_sync_run
SET finished_at = NOW(),
    status = :status,
    items_seen = :items_seen,
    items_inserted = :items_inserted,
    items_updated = :items_updated,
    items_failed = :items_failed,
    error_summary = :error_summary,
    metadata = :metadata
WHERE id = :id
SQL,
            [
                'id' => $runId,
                'status' => $status,
                'items_seen' => $itemsSeen,
                'items_inserted' => $itemsInserted,
                'items_updated' => $itemsUpdated,
                'items_failed' => $itemsFailed,
                'error_summary' => $warnings === [] ? null : implode("\n", array_slice($warnings, 0, 10)),
                'metadata' => $this->json([
                    'endpoints' => $endpoints,
                    'warnings' => array_slice($warnings, 0, 100),
                ]),
            ],
        );
    }

    /**
     * @param array<string,mixed> $existing
     * @param array<string,mixed> $row
     */
    private function featureMatches(array $existing, array $row): bool
    {
        return (string) $existing['name'] === $row['name']
            && (string) $existing['normalized_name'] === $row['normalized_name']
            && $this->nullableEquals($existing['feature_type'] ?? null, $row['feature_type'])
            && $this->boolValue($existing['uncountable'] ?? false) === $row['uncountable']
            && $this->nullableEquals($existing['status'] ?? null, $row['status']);
    }

    /**
     * @param array<string,mixed> $existing
     * @param array<string,mixed> $row
     */
    private function templateMatches(array $existing, array $row): bool
    {
        return (string) $existing['name'] === $row['name']
            && $this->nullableEquals($existing['scryfall_query'] ?? null, $row['scryfall_query'])
            && $this->nullableEquals($existing['scryfall_api'] ?? null, $row['scryfall_api']);
    }

    private function nullableEquals(mixed $left, mixed $right): bool
    {
        return $this->stringOrNull($left) === $this->stringOrNull($right);
    }

    private function featureType(string $name): string
    {
        $normalized = mb_strtolower($name);

        if (str_contains($normalized, 'win the game')) {
            return 'win_game';
        }
        if (str_contains($normalized, 'infinite') && str_contains($normalized, 'mana')) {
            return 'infinite_mana';
        }
        if (str_contains($normalized, 'infinite') && str_contains($normalized, 'damage')) {
            return 'infinite_damage';
        }
        if (str_contains($normalized, 'infinite') && str_contains($normalized, 'tokens')) {
            return 'infinite_tokens';
        }
        if (str_contains($normalized, 'draw')) {
            return 'draw';
        }
        if (str_contains($normalized, 'mill')) {
            return 'mill';
        }
        if (str_contains($normalized, 'storm')) {
            return 'storm';
        }
        if (str_contains($normalized, 'lifegain') || str_contains($normalized, 'life gain')) {
            return 'lifegain';
        }
        if (str_contains($normalized, 'lifeloss') || str_contains($normalized, 'life loss')) {
            return 'lifeloss';
        }
        if (str_contains($normalized, "can't") || str_contains($normalized, 'cannot') || str_contains($normalized, 'prevent') || str_contains($normalized, 'lock')) {
            return 'lock';
        }

        return 'other';
    }

    private function sourceHash(array $variant): string
    {
        $data = [
            'id' => $variant['id'] ?? null,
            'identity' => $variant['identity'] ?? null,
            'status' => $variant['status'] ?? null,
            'popularity' => $variant['popularity'] ?? null,
            'bracketTag' => $variant['bracketTag'] ?? null,
            'description' => $variant['description'] ?? null,
            'manaNeeded' => $variant['manaNeeded'] ?? null,
            'manaValueNeeded' => $variant['manaValueNeeded'] ?? null,
            'easyPrerequisites' => $variant['easyPrerequisites'] ?? null,
            'notablePrerequisites' => $variant['notablePrerequisites'] ?? null,
            'variantCount' => $variant['variantCount'] ?? null,
            'uses' => $this->usesForHash($variant['uses'] ?? []),
            'produces' => $this->producesForHash($variant['produces'] ?? []),
            'requires' => $this->requirementsForHash($variant['requires'] ?? []),
        ];

        return hash('sha256', json_encode($this->normalizeForHash($data), JSON_THROW_ON_ERROR));
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function usesForHash(mixed $uses): array
    {
        $rows = [];
        foreach ($this->listValue($uses) as $use) {
            if (!is_array($use)) {
                continue;
            }

            $card = is_array($use['card'] ?? null) ? $use['card'] : [];
            $rows[] = [
                'oracleId' => $card['oracleId'] ?? $card['oracle_id'] ?? null,
                'name' => $card['name'] ?? null,
                'quantity' => $use['quantity'] ?? null,
                'zoneLocations' => $use['zoneLocations'] ?? $use['zone_locations'] ?? [],
                'mustBeCommander' => $use['mustBeCommander'] ?? $use['must_be_commander'] ?? false,
                'battlefieldCardState' => $use['battlefieldCardState'] ?? $use['battlefield_card_state'] ?? null,
                'graveyardCardState' => $use['graveyardCardState'] ?? $use['graveyard_card_state'] ?? null,
                'libraryCardState' => $use['libraryCardState'] ?? $use['library_card_state'] ?? null,
                'exileCardState' => $use['exileCardState'] ?? $use['exile_card_state'] ?? null,
            ];
        }

        return $rows;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function producesForHash(mixed $produces): array
    {
        $rows = [];
        foreach ($this->listValue($produces) as $produce) {
            if (!is_array($produce)) {
                continue;
            }

            $feature = is_array($produce['feature'] ?? null) ? $produce['feature'] : [];
            $rows[] = [
                'featureId' => $feature['id'] ?? null,
                'quantity' => $produce['quantity'] ?? null,
            ];
        }

        return $rows;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function requirementsForHash(mixed $requirements): array
    {
        $rows = [];
        foreach ($this->listValue($requirements) as $requirement) {
            if (!is_array($requirement)) {
                continue;
            }

            $template = is_array($requirement['template'] ?? null) ? $requirement['template'] : [];
            $rows[] = [
                'templateId' => $template['id'] ?? null,
                'quantity' => $requirement['quantity'] ?? null,
                'zoneLocations' => $requirement['zoneLocations'] ?? $requirement['zone_locations'] ?? [],
                'mustBeCommander' => $requirement['mustBeCommander'] ?? $requirement['must_be_commander'] ?? false,
                'battlefieldCardState' => $requirement['battlefieldCardState'] ?? $requirement['battlefield_card_state'] ?? null,
                'graveyardCardState' => $requirement['graveyardCardState'] ?? $requirement['graveyard_card_state'] ?? null,
                'libraryCardState' => $requirement['libraryCardState'] ?? $requirement['library_card_state'] ?? null,
                'exileCardState' => $requirement['exileCardState'] ?? $requirement['exile_card_state'] ?? null,
            ];
        }

        return $rows;
    }

    private function normalizeForHash(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        if (!array_is_list($value)) {
            ksort($value);
        }

        foreach ($value as $key => $item) {
            $value[$key] = $this->normalizeForHash($item);
        }

        return $value;
    }

    /**
     * @return list<string>
     */
    private function identity(mixed $value): array
    {
        if (is_array($value)) {
            $identity = array_values(array_filter(
                array_map(fn (mixed $item): ?string => $this->stringOrNull($item), $value),
                static fn (?string $item): bool => $item !== null,
            ));
            sort($identity, SORT_STRING);

            return $identity;
        }

        if (!is_scalar($value)) {
            return [];
        }

        $string = strtoupper(trim((string) $value));
        if ($string === '' || $string === 'C') {
            return $string === 'C' ? ['C'] : [];
        }

        $parts = preg_split('//u', $string, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $identity = array_values(array_unique(array_filter(
            $parts,
            static fn (string $part): bool => in_array($part, ['W', 'U', 'B', 'R', 'G', 'C'], true),
        )));
        sort($identity, SORT_STRING);

        return $identity;
    }

    /**
     * @return list<mixed>
     */
    private function listValue(mixed $value): array
    {
        return is_array($value) ? array_values($value) : [];
    }

    private function externalId(mixed $value): ?string
    {
        return $this->stringOrNull($value);
    }

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }

    private function intOrNull(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    private function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_int($value)) {
            return $value === 1;
        }

        if (!is_string($value)) {
            return false;
        }

        return in_array(mb_strtolower(trim($value)), ['1', 'true', 't', 'yes', 'y'], true);
    }

    private function normalizeName(string $name): string
    {
        return mb_strtolower(trim($name));
    }

    private function json(mixed $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR);
    }
}
