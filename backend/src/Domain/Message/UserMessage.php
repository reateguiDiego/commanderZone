<?php

namespace App\Domain\Message;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'user_message')]
#[ORM\Index(name: 'idx_user_message_recipient_created', columns: ['recipient_id', 'created_at'])]
#[ORM\Index(name: 'idx_user_message_recipient_read', columns: ['recipient_id', 'read_at'])]
class UserMessage
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'sender_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private User $sender;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'recipient_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private User $recipient;

    #[ORM\Column(type: 'string', length: 120)]
    private string $subject;

    #[ORM\Column(type: 'text')]
    private string $body;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $readAt = null;

    public function __construct(User $sender, User $recipient, string $subject, string $body)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->sender = $sender;
        $this->recipient = $recipient;
        $this->subject = trim($subject);
        $this->body = trim($body);
        $this->createdAt = new \DateTimeImmutable();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function recipient(): User
    {
        return $this->recipient;
    }

    public function markRead(?\DateTimeImmutable $readAt = null): void
    {
        if ($this->readAt !== null) {
            return;
        }

        $this->readAt = $readAt ?? new \DateTimeImmutable();
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'sender' => [
                'id' => $this->sender->id(),
                'displayName' => $this->sender->displayName(),
                'displayNameStyle' => $this->sender->displayNameStyle(),
                'avatar' => $this->sender->avatar(),
            ],
            'subject' => $this->subject,
            'body' => $this->body,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            'readAt' => $this->readAt?->format(DATE_ATOM),
        ];
    }
}
