<?php

declare(strict_types=1);

namespace App\Domain\Report;

use App\Domain\Game\Game;
use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'user_report')]
#[ORM\Index(name: 'idx_user_report_pending_fifo', columns: ['status', 'created_at'])]
#[ORM\Index(name: 'idx_user_report_reporter_status', columns: ['reporter_id', 'status'])]
#[ORM\Index(name: 'idx_user_report_reported_user_status', columns: ['reported_user_id', 'status'])]
class UserReport
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'reporter_id', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?User $reporter;

    /** Historical sender label retained after a rename or account deletion. */
    #[ORM\Column(name: 'reporter_display_name', type: 'string', length: 120)]
    private string $reporterDisplayName;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'reported_user_id', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?User $reportedUser;

    /** Historical target label retained after a rename or account deletion. */
    #[ORM\Column(name: 'reported_user_display_name', type: 'string', length: 120)]
    private string $reportedUserDisplayName;

    #[ORM\ManyToOne(targetEntity: Game::class)]
    #[ORM\JoinColumn(name: 'game_id', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?Game $game = null;

    /** Stable source-game identity retained after the operational Game row is cleaned up. */
    #[ORM\Column(name: 'original_game_id', type: 'string', length: 36, nullable: true)]
    private ?string $originalGameId = null;

    /** Original persistent chat ID; not an FK because source chat is retained only until capture. */
    #[ORM\Column(name: 'message_id', type: 'string', length: 36, nullable: true)]
    private ?string $messageId = null;

    #[ORM\Column(type: 'string', length: 32, enumType: ReportSource::class)]
    private ReportSource $source;

    #[ORM\Column(type: 'string', length: 72, enumType: ReportCategory::class)]
    private ReportCategory $category;

    #[ORM\Column(type: 'text', nullable: true)]
    private ?string $comment;

    #[ORM\Column(type: 'string', length: 32, enumType: ReportState::class)]
    private ReportState $status;

    /** Allow-listed editable profile content copied asynchronously for profile reports only. */
    #[ORM\Column(name: 'reported_user_snapshot', type: 'json', nullable: true)]
    private ?array $reportedUserSnapshot = null;

    #[ORM\ManyToOne(targetEntity: GameModerationEvidenceSnapshot::class)]
    #[ORM\JoinColumn(name: 'game_evidence_snapshot_id', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?GameModerationEvidenceSnapshot $gameEvidenceSnapshot = null;

    #[ORM\Column(type: 'string', length: 32, enumType: ReportResolutionOutcome::class, nullable: true)]
    private ?ReportResolutionOutcome $resolutionOutcome = null;

    #[ORM\Column(type: 'text', nullable: true)]
    private ?string $resolutionNote = null;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'resolved_by_id', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?User $resolvedBy = null;

    #[ORM\Column(name: 'resolved_by_display_name', type: 'string', length: 120, nullable: true)]
    private ?string $resolvedByDisplayName = null;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $resolvedAt = null;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(
        User $reporter,
        User $reportedUser,
        ReportSource $source,
        ReportCategory $category,
        ?string $comment = null,
        ?Game $game = null,
        ?string $messageId = null,
        ?\DateTimeImmutable $createdAt = null,
    ) {
        if ($reporter->id() === $reportedUser->id()) {
            throw new \InvalidArgumentException('A user cannot report themselves.');
        }
        if (!$source->canBeSubmitted()) {
            throw new \InvalidArgumentException('Legacy reports cannot be submitted.');
        }

        $normalizedComment = self::normalizeLongText($comment);
        if ($category->requiresComment() && $normalizedComment === null) {
            throw new \InvalidArgumentException('A comment is required for this report category.');
        }
        if ($source->requiresGameEvidence() !== ($game instanceof Game)) {
            throw new \InvalidArgumentException('Game reports require a game and profile reports cannot include one.');
        }
        if (($source === ReportSource::CHAT_MESSAGE) !== (self::normalizeIdentifier($messageId) !== null)) {
            throw new \InvalidArgumentException('Chat-message reports require a message ID and other report sources cannot include one.');
        }

        $this->id = Uuid::v7()->toRfc4122();
        $this->reporter = $reporter;
        $this->reporterDisplayName = self::historicalDisplayName($reporter->displayName(), 'Unknown reporter');
        $this->reportedUser = $reportedUser;
        $this->reportedUserDisplayName = self::historicalDisplayName($reportedUser->displayName(), 'Unknown reported user');
        $this->source = $source;
        $this->category = $category;
        $this->comment = $normalizedComment;
        $this->game = $game;
        $this->originalGameId = $game?->id();
        $this->messageId = self::normalizeIdentifier($messageId);
        $this->status = ReportState::COLLECTING_EVIDENCE;
        $this->createdAt = $createdAt ?? new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
    }

    /** Builds a migrated report without fabricating historic evidence. */
    public static function legacy(User $reporter, User $reportedUser, string $comment, \DateTimeImmutable $createdAt): self
    {
        $report = new self(
            $reporter,
            $reportedUser,
            ReportSource::PROFILE,
            ReportCategory::OTHER_PROBLEM,
            $comment !== '' ? $comment : 'Legacy report',
            null,
            null,
            $createdAt,
        );
        $report->source = ReportSource::LEGACY;
        $report->status = ReportState::PENDING_REVIEW;

        return $report;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function reporter(): ?User
    {
        return $this->reporter;
    }

    public function reportedUser(): ?User
    {
        return $this->reportedUser;
    }

    public function source(): ReportSource
    {
        return $this->source;
    }

    public function category(): ReportCategory
    {
        return $this->category;
    }

    public function comment(): ?string
    {
        return $this->comment;
    }

    public function status(): ReportState
    {
        return $this->status;
    }

    public function game(): ?Game
    {
        return $this->game;
    }

    public function gameId(): ?string
    {
        return $this->originalGameId;
    }

    public function messageId(): ?string
    {
        return $this->messageId;
    }

    public function createdAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function resolvedAt(): ?\DateTimeImmutable
    {
        return $this->resolvedAt;
    }

    public function resolutionOutcome(): ?ReportResolutionOutcome
    {
        return $this->resolutionOutcome;
    }

    public function requiresGameEvidence(): bool
    {
        return $this->source->requiresGameEvidence();
    }

    public function requiresGameLog(): bool
    {
        return $this->source === ReportSource::GAME_PLAYER && $this->category->requiresGameLog();
    }

    public function requiresProfileEvidence(): bool
    {
        return $this->source === ReportSource::PROFILE;
    }

    public function isOpen(): bool
    {
        return $this->status !== ReportState::RESOLVED;
    }

    public function isPendingReview(): bool
    {
        return $this->status === ReportState::PENDING_REVIEW;
    }

    /** @param array<string,mixed> $snapshot */
    public function markProfileEvidenceCollected(array $snapshot): void
    {
        if ($this->status !== ReportState::COLLECTING_EVIDENCE) {
            return;
        }

        $this->reportedUserSnapshot = $snapshot;
        $this->markPendingReviewWhenEvidenceComplete();
        $this->touch();
    }

    public function markEvidenceCollected(GameModerationEvidenceSnapshot $snapshot): void
    {
        if ($this->status !== ReportState::COLLECTING_EVIDENCE) {
            return;
        }
        if (!$this->requiresGameEvidence()) {
            throw new \LogicException('Only game reports can receive game evidence.');
        }
        if ($this->originalGameId !== null && $snapshot->gameId() !== $this->originalGameId) {
            throw new \InvalidArgumentException('Evidence snapshot belongs to a different game.');
        }

        $this->gameEvidenceSnapshot = $snapshot;
        $this->markPendingReviewWhenEvidenceComplete();
        $this->touch();
    }

    public function resolve(ReportResolutionOutcome $outcome, ?string $note, User $reviewer, ?\DateTimeImmutable $resolvedAt = null): void
    {
        if ($this->status !== ReportState::PENDING_REVIEW) {
            throw new \LogicException('Only pending reports can be resolved.');
        }

        $this->resolutionOutcome = $outcome;
        $this->resolutionNote = self::normalizeLongText($note);
        $this->resolvedBy = $reviewer;
        $this->resolvedByDisplayName = self::historicalDisplayName($reviewer->displayName(), 'Unknown moderator');
        $this->resolvedAt = $resolvedAt ?? new \DateTimeImmutable();
        $this->status = ReportState::RESOLVED;
        $this->touch();
    }

    /** @return array<string,mixed>|null */
    public function reportedUserSnapshot(): ?array
    {
        return $this->reportedUserSnapshot;
    }

    public function gameEvidenceSnapshot(): ?GameModerationEvidenceSnapshot
    {
        return $this->gameEvidenceSnapshot;
    }

    /** @return array{id:string,source:string,category:string,status:string,createdAt:string} */
    public function toSubmissionArray(): array
    {
        return [
            'id' => $this->id,
            'source' => $this->source->value,
            'category' => $this->category->value,
            'status' => $this->status->value,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
        ];
    }

    /** Compact payload deliberately excludes profile/game evidence. @return array<string,mixed> */
    public function toAdminListArray(): array
    {
        return [
            'id' => $this->id,
            'reporter' => self::userSummary($this->reporter, $this->reporterDisplayName),
            'reportedUser' => self::userSummary($this->reportedUser, $this->reportedUserDisplayName),
            'source' => $this->source->value,
            'category' => $this->category->value,
            'status' => $this->status->value,
            'comment' => $this->comment,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
        ];
    }

    /** @return array<string,mixed> */
    public function toAdminDetailArray(): array
    {
        $gameEvidence = $this->gameEvidenceSnapshot?->toAdminArray();

        return [
            ...$this->toAdminListArray(),
            'resolution' => $this->resolutionOutcome === null ? null : [
                'outcome' => $this->resolutionOutcome->value,
                'note' => $this->resolutionNote,
                'reviewer' => self::userSummary($this->resolvedBy, $this->resolvedByDisplayName ?? 'Unknown moderator'),
                'reviewedAt' => $this->resolvedAt?->format(DATE_ATOM),
            ],
            'evidence' => [
                'reportedUserSnapshot' => $this->reportedUserSnapshot,
                'game' => $gameEvidence,
            ],
            'updatedAt' => $this->updatedAt->format(DATE_ATOM),
        ];
    }

    private function markPendingReviewWhenEvidenceComplete(): void
    {
        if ($this->status !== ReportState::COLLECTING_EVIDENCE) {
            return;
        }
        if ($this->requiresProfileEvidence() && $this->reportedUserSnapshot === null) {
            return;
        }
        if ($this->requiresGameEvidence() && $this->gameEvidenceSnapshot === null) {
            return;
        }

        $this->status = ReportState::PENDING_REVIEW;
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    private static function normalizeLongText(?string $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $normalized = trim($value);

        return $normalized === '' ? null : mb_substr($normalized, 0, 4000);
    }

    private static function normalizeIdentifier(?string $value): ?string
    {
        $normalized = is_string($value) ? trim($value) : '';

        return $normalized === '' ? null : mb_substr($normalized, 0, 36);
    }

    /** @return array{id:string|null,displayName:string} */
    private static function userSummary(?User $user, string $historicalDisplayName): array
    {
        return [
            // The ID remains an opaque UI action handle (for the moderation
            // drawer); it is never rendered as evidence. Names are frozen.
            'id' => $user?->id(),
            'displayName' => $historicalDisplayName,
        ];
    }

    private static function historicalDisplayName(string $value, string $fallback): string
    {
        $name = trim($value);

        return $name === '' ? $fallback : mb_substr($name, 0, 120);
    }
}
