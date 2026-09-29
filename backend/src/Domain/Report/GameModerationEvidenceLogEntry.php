<?php

declare(strict_types=1);

namespace App\Domain\Report;

use App\Domain\Game\GameLogEntry;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game_moderation_evidence_log_entry')]
#[ORM\UniqueConstraint(name: 'uniq_game_moderation_evidence_log_source', columns: ['snapshot_id', 'source_log_entry_id'])]
class GameModerationEvidenceLogEntry
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: GameModerationEvidenceSnapshot::class, inversedBy: 'logEntries')]
    #[ORM\JoinColumn(name: 'snapshot_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private GameModerationEvidenceSnapshot $snapshot;

    #[ORM\Column(name: 'source_log_entry_id', type: 'string', length: 36)]
    private string $sourceLogEntryId;

    #[ORM\Column(type: 'integer')]
    private int $version;

    #[ORM\Column(name: 'actor_display_name', type: 'string', length: 120, nullable: true)]
    private ?string $actorDisplayName;

    #[ORM\Column(type: 'string', length: 1000)]
    private string $text;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(GameModerationEvidenceSnapshot $snapshot, GameLogEntry $source)
    {
        $record = $source->metadata();
        // Canonical entity fields take precedence over metadata keys from a
        // historical stream row.
        $record['message'] = $source->message();
        $this->id = Uuid::v7()->toRfc4122();
        $this->snapshot = $snapshot;
        // The source ID/version are retained only to make a retried worker
        // idempotent and to preserve event order. They are never exposed to a
        // reviewer.
        $this->sourceLogEntryId = $source->id();
        $this->version = $source->version();
        // Do not copy a source event's arbitrary type/payload/metadata into
        // moderation evidence. The human-readable action is all a reviewer
        // needs, with only user-facing subject labels appended when needed.
        $this->text = self::actionFrom($record);
        $this->actorDisplayName = self::actorDisplayNameFrom($record);
        $this->createdAt = $source->createdAt();
    }

    public function sourceLogEntryId(): string
    {
        return $this->sourceLogEntryId;
    }

    public function sortKey(): string
    {
        return sprintf('%010d|%s|%s', $this->version, $this->createdAt->format('U.u'), $this->sourceLogEntryId);
    }

    /** @return array<string,mixed> */
    public function toAdminArray(): array
    {
        return [
            'time' => $this->createdAt->format('H:i:s'),
            'actorDisplayName' => $this->actorDisplayName,
            'action' => $this->text,
        ];
    }

    /** @param array<string,mixed> $record */
    private static function actorDisplayNameFrom(array $record): ?string
    {
        $displayName = self::stringValue($record['displayName'] ?? null);

        return $displayName === '' ? null : mb_substr($displayName, 0, 120);
    }

    /** @param array<string,mixed> $record */
    private static function actionFrom(array $record): string
    {
        $action = self::stringValue($record['message'] ?? null);
        $action = preg_replace('/\s+/u', ' ', $action) ?? $action;
        $action = self::replaceReferencedPlayerIds($action, $record);

        $subjects = self::subjectLabelsFrom($record);
        foreach ($subjects as $subject) {
            if (!self::contains($action, $subject)) {
                $action .= sprintf(' · %s', $subject);
            }
        }

        // A persisted game log occasionally contains a technical identifier
        // in its display text. It is neither moderation evidence nor useful
        // to a reviewer, so redact it rather than retaining it in the action.
        $action = preg_replace(
            '/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu',
            '[referencia]',
            $action,
        ) ?? $action;

        return mb_substr($action, 0, 1000);
    }

    /** @param array<string,mixed> $record */
    private static function replaceReferencedPlayerIds(string $action, array $record): string
    {
        $players = self::referencedPlayers($record);
        foreach ($players as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player)) {
                continue;
            }
            $displayName = self::stringValue($player['displayName'] ?? null);
            if ($playerId !== '' && $displayName !== '') {
                $action = str_replace($playerId, $displayName, $action);
            }
        }

        return $action;
    }

    /**
     * @param array<string,mixed> $record
     *
     * @return list<string>
     */
    private static function subjectLabelsFrom(array $record): array
    {
        $subjects = [];
        // `cardNames` can represent a complete hidden-zone batch. The
        // action text already names a single public card when that matters;
        // never promote arbitrary metadata into reviewer evidence.
        $subject = $record['subject'] ?? null;
        $playerId = is_array($subject) ? self::stringValue($subject['playerId'] ?? null) : '';
        $players = self::referencedPlayers($record);
        $player = $playerId !== '' && is_array($players[$playerId] ?? null) ? $players[$playerId] : null;
        $playerName = is_array($player) ? self::stringValue($player['displayName'] ?? null) : '';
        if ($playerName !== '') {
            $subjects[] = mb_substr($playerName, 0, 120);
        }

        return array_values(array_unique($subjects));
    }

    private static function contains(string $value, string $needle): bool
    {
        return mb_stripos($value, $needle) !== false;
    }

    /** @param array<string,mixed> $record @return array<string,mixed> */
    private static function referencedPlayers(array $record): array
    {
        $references = is_array($record['refs'] ?? null) ? $record['refs'] : [];

        return is_array($references['players'] ?? null) ? $references['players'] : [];
    }

    private static function stringValue(mixed $value): string
    {
        return is_string($value) ? trim($value) : '';
    }
}
