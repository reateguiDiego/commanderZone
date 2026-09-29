<?php

declare(strict_types=1);

namespace App\Domain\Report;

use App\Domain\Game\GameChatMessage;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game_moderation_evidence_chat_message')]
#[ORM\UniqueConstraint(name: 'uniq_game_moderation_evidence_chat_source', columns: ['snapshot_id', 'source_message_id'])]
class GameModerationEvidenceChatMessage
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: GameModerationEvidenceSnapshot::class, inversedBy: 'chatMessages')]
    #[ORM\JoinColumn(name: 'snapshot_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private GameModerationEvidenceSnapshot $snapshot;

    #[ORM\Column(name: 'source_message_id', type: 'string', length: 36)]
    private string $sourceMessageId;

    #[ORM\Column(name: 'actor_display_name', type: 'string', length: 120)]
    private string $actorDisplayName;

    #[ORM\Column(type: 'string', length: 800)]
    private string $body;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(GameModerationEvidenceSnapshot $snapshot, GameChatMessage $source)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->snapshot = $snapshot;
        // The source ID is retained solely by the unique constraint so a
        // retried worker cannot duplicate a row. It is never reviewer-facing.
        $this->sourceMessageId = $source->messageId();
        // The historical display name is evidence; the account identifier,
        // reaction data, and private-message target are not.
        $this->actorDisplayName = $source->actorDisplayName();
        $this->body = $source->body();
        $this->createdAt = $source->createdAt();
    }

    public function sourceMessageId(): string
    {
        return $this->sourceMessageId;
    }

    public function sortKey(): string
    {
        return $this->createdAt->format('U.u').'|'.$this->sourceMessageId;
    }

    /** @return array<string,mixed> */
    public function toAdminArray(): array
    {
        return [
            'time' => $this->createdAt->format('H:i'),
            'actorDisplayName' => $this->actorDisplayName,
            'body' => $this->body,
        ];
    }
}
