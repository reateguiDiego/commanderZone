<?php

namespace App\Domain\Report;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'user_report')]
#[ORM\Index(name: 'idx_user_report_created', columns: ['created_at'])]
#[ORM\Index(name: 'idx_user_report_reported_user', columns: ['reported_user_id'])]
class UserReport
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'reporter_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private User $reporter;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'reported_user_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private User $reportedUser;

    #[ORM\Column(type: 'string', length: 255)]
    private string $reason;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(User $reporter, User $reportedUser, string $reason, ?\DateTimeImmutable $createdAt = null)
    {
        if ($reporter->id() === $reportedUser->id()) {
            throw new \InvalidArgumentException('A user cannot report themselves.');
        }

        $this->id = Uuid::v7()->toRfc4122();
        $this->reporter = $reporter;
        $this->reportedUser = $reportedUser;
        $this->reason = trim($reason);
        $this->createdAt = $createdAt ?? new \DateTimeImmutable();
    }

    /**
     * @return array{
     *   id: string,
     *   reporter: array{id: string, displayName: string, email: string},
     *   reportedUser: array{id: string, displayName: string, email: string},
     *   reason: string,
     *   createdAt: string
     * }
     */
    public function toAdminArray(): array
    {
        return [
            'id' => $this->id,
            'reporter' => [
                'id' => $this->reporter->id(),
                'displayName' => $this->reporter->displayName(),
                'email' => $this->reporter->email(),
            ],
            'reportedUser' => [
                'id' => $this->reportedUser->id(),
                'displayName' => $this->reportedUser->displayName(),
                'email' => $this->reportedUser->email(),
            ],
            'reason' => $this->reason,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
        ];
    }
}
