<?php

declare(strict_types=1);

namespace App\Domain\Report;

use App\Domain\Game\GameChatMessage;
use App\Domain\Game\GameLogEntry;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game_moderation_evidence_snapshot')]
#[ORM\UniqueConstraint(name: 'uniq_game_moderation_evidence_game', columns: ['game_id'])]
class GameModerationEvidenceSnapshot
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    /** The original game ID remains after game cleanup. */
    #[ORM\Column(name: 'game_id', type: 'string', length: 36)]
    private string $gameId;

    #[ORM\Column(type: 'string', length: 20, enumType: GameModerationEvidenceStatus::class)]
    private GameModerationEvidenceStatus $status = GameModerationEvidenceStatus::CAPTURING;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $capturedAt = null;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    /** @var Collection<int, GameModerationEvidenceChatMessage> */
    #[ORM\OneToMany(mappedBy: 'snapshot', targetEntity: GameModerationEvidenceChatMessage::class, cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $chatMessages;

    /** @var Collection<int, GameModerationEvidenceLogEntry> */
    #[ORM\OneToMany(mappedBy: 'snapshot', targetEntity: GameModerationEvidenceLogEntry::class, cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $logEntries;

    public function __construct(string $gameId)
    {
        $gameId = trim($gameId);
        if ($gameId === '') {
            throw new \InvalidArgumentException('A game ID is required for moderation evidence.');
        }

        $this->id = Uuid::v7()->toRfc4122();
        $this->gameId = $gameId;
        $this->createdAt = new \DateTimeImmutable();
        $this->chatMessages = new ArrayCollection();
        $this->logEntries = new ArrayCollection();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function gameId(): string
    {
        return $this->gameId;
    }

    public function status(): GameModerationEvidenceStatus
    {
        return $this->status;
    }

    public function isComplete(): bool
    {
        return $this->status === GameModerationEvidenceStatus::COMPLETE;
    }

    public function addChatMessage(GameChatMessage $source): bool
    {
        if ($source->game()->id() !== $this->gameId || $this->hasChatMessage($source->messageId())) {
            return false;
        }

        $this->chatMessages->add($this->captureChatMessage($source));

        return true;
    }

    public function addLogEntry(GameLogEntry $source): bool
    {
        $sourceId = trim($source->id());
        if ($sourceId === '' || $this->hasLogEntry($sourceId)) {
            return false;
        }

        $this->logEntries->add($this->captureLogEntry($source));

        return true;
    }

    /**
     * Creates a bounded worker batch row without growing this aggregate's
     * inverse collection. The worker persists the returned entity directly;
     * source-ID uniqueness in storage makes a retried claim idempotent.
     */
    public function captureChatMessage(GameChatMessage $source): GameModerationEvidenceChatMessage
    {
        if ($source->game()->id() !== $this->gameId) {
            throw new \InvalidArgumentException('Chat evidence must belong to the snapshot game.');
        }

        return new GameModerationEvidenceChatMessage($this, $source);
    }

    /**
     * See captureChatMessage(): this is deliberately not added to the inverse
     * collection so a large source remains bounded to one worker batch.
     */
    public function captureLogEntry(GameLogEntry $source): GameModerationEvidenceLogEntry
    {
        if (trim($source->id()) === '') {
            throw new \InvalidArgumentException('A game-log source ID is required for moderation evidence.');
        }

        return new GameModerationEvidenceLogEntry($this, $source);
    }

    public function complete(?\DateTimeImmutable $capturedAt = null): void
    {
        if ($this->status === GameModerationEvidenceStatus::COMPLETE) {
            return;
        }

        $this->capturedAt = $capturedAt ?? new \DateTimeImmutable();
        $this->status = GameModerationEvidenceStatus::COMPLETE;
    }

    public function fail(): void
    {
        if ($this->status !== GameModerationEvidenceStatus::COMPLETE) {
            $this->status = GameModerationEvidenceStatus::FAILED;
        }
    }

    /** @return array<string,mixed> */
    public function toAdminArray(): array
    {
        $chatMessages = $this->chatMessages->toArray();
        usort($chatMessages, static fn (GameModerationEvidenceChatMessage $left, GameModerationEvidenceChatMessage $right): int => $left->sortKey() <=> $right->sortKey());
        $logEntries = $this->logEntries->toArray();
        usort($logEntries, static fn (GameModerationEvidenceLogEntry $left, GameModerationEvidenceLogEntry $right): int => $left->sortKey() <=> $right->sortKey());

        return [
            'capturedAt' => $this->capturedAt?->format(DATE_ATOM),
            'chat' => array_map(static fn (GameModerationEvidenceChatMessage $message): array => $message->toAdminArray(), $chatMessages),
            'gameLog' => array_map(static fn (GameModerationEvidenceLogEntry $entry): array => $entry->toAdminArray(), $logEntries),
        ];
    }

    private function hasChatMessage(string $sourceMessageId): bool
    {
        foreach ($this->chatMessages as $message) {
            if ($message instanceof GameModerationEvidenceChatMessage && $message->sourceMessageId() === $sourceMessageId) {
                return true;
            }
        }

        return false;
    }

    private function hasLogEntry(string $sourceLogEntryId): bool
    {
        foreach ($this->logEntries as $entry) {
            if ($entry instanceof GameModerationEvidenceLogEntry && $entry->sourceLogEntryId() === $sourceLogEntryId) {
                return true;
            }
        }

        return false;
    }
}
