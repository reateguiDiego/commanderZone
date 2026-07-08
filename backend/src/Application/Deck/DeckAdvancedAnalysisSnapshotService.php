<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;
use Doctrine\DBAL\Connection;
use Symfony\Component\Uid\Uuid;

final class DeckAdvancedAnalysisSnapshotService
{
    public function __construct(
        private readonly Connection $connection,
        private readonly DeckAnalysisDataVersionProvider $versionProvider,
        private readonly DeckAnalysisDeckHasher $deckHasher,
    ) {
    }

    /**
     * @return array<string,mixed>
     */
    public function analyze(
        Deck $deck,
        DeckAdvancedAnalysisCalculatorInterface $calculator,
        int $monteCarloRuns = DeckAdvancedAnalyzerVersion::DEFAULT_MONTE_CARLO_RUNS,
    ): array
    {
        $context = $this->context($deck, $monteCarloRuns);
        $snapshotContext = $context->snapshotColumns();
        $existing = $this->snapshotRow($deck->id());
        $staleReason = $this->staleReason($existing, $snapshotContext);

        if ($existing !== null && $staleReason === null) {
            $result = $this->jsonObject($existing['result_json'] ?? null);
            $result['snapshot'] = $this->metadata(true, 'fresh', $existing, $snapshotContext);

            return $result;
        }

        $result = $calculator->calculate($context);
        $saved = $this->saveSnapshot($deck->id(), $snapshotContext, $result, $existing);
        $result['snapshot'] = $this->metadata(false, $staleReason ?? 'missing', $saved, $snapshotContext);

        return $result;
    }

    public function deckHash(Deck $deck): string
    {
        return $this->deckHasher->hash($deck);
    }

    private function context(Deck $deck, int $monteCarloRuns): DeckAdvancedAnalysisContext
    {
        $deckHash = $this->deckHash($deck);
        $versions = $this->versionProvider->currentVersions();
        $runs = max(1, $monteCarloRuns);

        return new DeckAdvancedAnalysisContext(
            deck: $deck,
            deckHash: $deckHash,
            analyzerVersion: DeckAdvancedAnalyzerVersion::CURRENT,
            semanticDataVersion: $versions[DeckAnalysisDataVersionProvider::KEY_SEMANTIC],
            manaDataVersion: $versions[DeckAnalysisDataVersionProvider::KEY_MANA],
            comboDataVersion: $versions[DeckAnalysisDataVersionProvider::KEY_COMBO],
            rulesVersion: $versions[DeckAnalysisDataVersionProvider::KEY_RULES],
            monteCarloVersion: DeckAdvancedAnalyzerVersion::MONTE_CARLO,
            monteCarloRuns: $runs,
            monteCarloSeed: hash('sha256', implode('|', [
                $deckHash,
                DeckAdvancedAnalyzerVersion::CURRENT,
                DeckAdvancedAnalyzerVersion::MONTE_CARLO,
            ])),
        );
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

        if ((string) ($row['monte_carlo_version'] ?? '') !== $context['monte_carlo_version']) {
            return 'monte_carlo_version_changed';
        }

        if ((int) ($row['monte_carlo_runs'] ?? 0) !== $context['monte_carlo_runs']) {
            return 'monte_carlo_runs_changed';
        }

        if ((string) ($row['monte_carlo_seed'] ?? '') !== $context['monte_carlo_seed']) {
            return 'monte_carlo_version_changed';
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
INSERT INTO deck_advanced_analysis_snapshot (
    id,
    deck_id,
    deck_hash,
    analyzer_version,
    semantic_data_version,
    mana_data_version,
    combo_data_version,
    rules_version,
    monte_carlo_version,
    monte_carlo_runs,
    monte_carlo_seed,
    result_json,
    calculated_at,
    created_at,
    updated_at
) VALUES (
    :id,
    :deck_id,
    :deck_hash,
    :analyzer_version,
    :semantic_data_version,
    :mana_data_version,
    :combo_data_version,
    :rules_version,
    :monte_carlo_version,
    :monte_carlo_runs,
    :monte_carlo_seed,
    :result_json::jsonb,
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (deck_id) DO UPDATE SET
    deck_hash = EXCLUDED.deck_hash,
    analyzer_version = EXCLUDED.analyzer_version,
    semantic_data_version = EXCLUDED.semantic_data_version,
    mana_data_version = EXCLUDED.mana_data_version,
    combo_data_version = EXCLUDED.combo_data_version,
    rules_version = EXCLUDED.rules_version,
    monte_carlo_version = EXCLUDED.monte_carlo_version,
    monte_carlo_runs = EXCLUDED.monte_carlo_runs,
    monte_carlo_seed = EXCLUDED.monte_carlo_seed,
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

        return $this->snapshotRow($deckId) ?? [
            'id' => $id,
            'calculated_at' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
            ...$context,
        ];
    }

    /**
     * @return array<string,mixed>|null
     */
    private function snapshotRow(string $deckId): ?array
    {
        $row = $this->connection->fetchAssociative(
            'SELECT * FROM deck_advanced_analysis_snapshot WHERE deck_id = :deck_id',
            ['deck_id' => $deckId],
        );

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
            'analyzerVersion' => $context['analyzer_version'],
            'semanticDataVersion' => $context['semantic_data_version'],
            'manaDataVersion' => $context['mana_data_version'],
            'comboDataVersion' => $context['combo_data_version'],
            'rulesVersion' => $context['rules_version'],
            'monteCarloVersion' => $context['monte_carlo_version'],
            'monteCarloRuns' => $context['monte_carlo_runs'],
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

}
