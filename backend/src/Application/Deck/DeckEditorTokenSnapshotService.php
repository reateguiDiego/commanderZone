<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;
use Doctrine\DBAL\Connection;
use Symfony\Component\Uid\Uuid;

final class DeckEditorTokenSnapshotService
{
    private const PAYLOAD_VERSION = 'deck_editor_tokens_v2';

    public function __construct(
        private readonly Connection $connection,
        private readonly DeckAnalysisDeckHasher $deckHasher,
    ) {
    }

    /**
     * @param callable():array<string,mixed> $calculator
     * @return array<string,mixed>
     */
    public function tokens(Deck $deck, string $cardLanguage, string $tokenDataVersion, callable $calculator): array
    {
        $context = $this->context($deck, $cardLanguage, $tokenDataVersion);
        $existing = $this->snapshotRow($deck->id(), $context['card_language']);
        $staleReason = $this->staleReason($existing, $context);

        if ($existing !== null && $staleReason === null) {
            $result = $this->jsonObject($existing['result_json'] ?? null);
            $result['snapshot'] = $this->metadata(true, 'fresh', $existing, $context);

            return $result;
        }

        $result = $calculator();
        $saved = $this->saveSnapshot($deck->id(), $context, $result, $existing);
        $result['snapshot'] = $this->metadata(false, $staleReason ?? 'missing', $saved, $context);

        return $result;
    }

    /**
     * @return array<string,mixed>
     */
    private function context(Deck $deck, string $cardLanguage, string $tokenDataVersion): array
    {
        return [
            'deck_hash' => $this->deckHasher->hash($deck),
            'card_language' => trim($cardLanguage) !== '' ? $cardLanguage : 'en',
            'payload_version' => self::PAYLOAD_VERSION,
            'token_data_version' => $tokenDataVersion,
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
            'card_language' => 'card_language_changed',
            'payload_version' => 'payload_version_changed',
            'token_data_version' => 'token_data_changed',
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
INSERT INTO deck_editor_token_snapshot (
    id,
    deck_id,
    deck_hash,
    card_language,
    payload_version,
    token_data_version,
    result_json,
    calculated_at,
    created_at,
    updated_at
    ) VALUES (
    :id,
    :deck_id,
    :deck_hash,
    :card_language,
    :payload_version,
    :token_data_version,
    CAST(:result_json AS JSONB),
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (deck_id, card_language) DO UPDATE SET
    deck_hash = EXCLUDED.deck_hash,
    payload_version = EXCLUDED.payload_version,
    token_data_version = EXCLUDED.token_data_version,
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

        return $this->snapshotRow($deckId, $context['card_language']) ?? [
            'id' => $id,
            'calculated_at' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
            ...$context,
        ];
    }

    /**
     * @return array<string,mixed>|null
     */
    private function snapshotRow(string $deckId, string $cardLanguage): ?array
    {
        $row = $this->connection->fetchAssociative(
            'SELECT * FROM deck_editor_token_snapshot WHERE deck_id = :deck_id AND card_language = :card_language',
            [
                'deck_id' => $deckId,
                'card_language' => $cardLanguage,
            ],
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
            'cardLanguage' => $context['card_language'],
            'payloadVersion' => $context['payload_version'],
            'tokenDataVersion' => $context['token_data_version'],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function jsonObject(mixed $value): array
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
