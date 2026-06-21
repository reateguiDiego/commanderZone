<?php

namespace App\Domain\Game;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game_chat_message')]
#[ORM\Index(name: 'idx_game_chat_game_created_at', columns: ['game_id', 'created_at'])]
#[ORM\Index(name: 'idx_game_chat_game_message', columns: ['game_id', 'message_id'])]
class GameChatMessage
{
    #[ORM\Id]
    #[ORM\Column(name: 'message_id', type: 'string', length: 36)]
    private string $messageId;

    #[ORM\ManyToOne(targetEntity: Game::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Game $game;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'actor_id', nullable: false, onDelete: 'CASCADE')]
    private User $actor;

    #[ORM\Column(type: 'string', length: 800)]
    private string $body;

    #[ORM\Column(type: 'json')]
    private array $reactions = [];

    #[ORM\Column(type: 'string', length: 36, nullable: true)]
    private ?string $targetPlayerId = null;

    #[ORM\Column(type: 'string', length: 120, nullable: true)]
    private ?string $targetDisplayName = null;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    /**
     * @param array<string,list<array{userId:string,displayName:string,createdAt:string}>> $reactions
     */
    public function __construct(
        Game $game,
        User $actor,
        string $body,
        ?string $targetPlayerId = null,
        ?string $targetDisplayName = null,
        array $reactions = [],
    ) {
        $this->messageId = Uuid::v7()->toRfc4122();
        $this->game = $game;
        $this->actor = $actor;
        $this->body = mb_substr(trim($body), 0, 800);
        $this->targetPlayerId = $targetPlayerId;
        $this->targetDisplayName = $targetDisplayName;
        $this->reactions = $reactions;
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
    }

    public function messageId(): string
    {
        return $this->messageId;
    }

    public function game(): Game
    {
        return $this->game;
    }

    public function actor(): User
    {
        return $this->actor;
    }

    public function body(): string
    {
        return $this->body;
    }

    /**
     * @return array<string,list<array{userId:string,displayName:string,createdAt:string}>>
     */
    public function reactions(): array
    {
        return $this->reactions;
    }

    /**
     * @param array<string,list<array{userId:string,displayName:string,createdAt:string}>> $reactions
     */
    public function replaceReactions(array $reactions): void
    {
        $this->reactions = $reactions;
        $this->updatedAt = new \DateTimeImmutable();
    }

    public function targetPlayerId(): ?string
    {
        return $this->targetPlayerId;
    }

    public function targetDisplayName(): ?string
    {
        return $this->targetDisplayName;
    }

    public function createdAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function updatedAt(): \DateTimeImmutable
    {
        return $this->updatedAt;
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        $data = [
            'id' => $this->messageId,
            'userId' => $this->actor->id(),
            'displayName' => $this->actor->displayName(),
            'message' => $this->body,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            'reactions' => $this->reactions,
        ];

        if ($this->targetPlayerId !== null && $this->targetPlayerId !== '') {
            $data['targetPlayerId'] = $this->targetPlayerId;
            $data['targetDisplayName'] = $this->targetDisplayName;
        }

        return $data;
    }

    /**
     * @return array<string,mixed>
     */
    public function toEventArray(): array
    {
        return [
            'id' => $this->messageId,
            'type' => 'chat.message',
            'createdBy' => $this->actor->id(),
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            'payload' => [
                'private' => $this->targetPlayerId !== null && $this->targetPlayerId !== '',
            ],
        ];
    }
}
