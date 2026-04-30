<?php

namespace App\Domain\Game;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game_event')]
#[ORM\UniqueConstraint(name: 'uniq_game_event_client_action', columns: ['game_id', 'client_action_id'])]
class GameEvent
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Game::class, inversedBy: 'events')]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Game $game;

    #[ORM\Column(type: 'string', length: 80)]
    private string $type;

    #[ORM\Column(type: 'json')]
    private array $payload;

    #[ORM\Column(type: 'string', length: 120, nullable: true)]
    private ?string $clientActionId = null;

    #[ORM\ManyToOne(targetEntity: User::class)]
    private ?User $createdBy;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(Game $game, string $type, array $payload, ?User $createdBy, ?string $clientActionId = null)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->game = $game;
        $this->type = $type;
        $this->payload = $payload;
        $this->clientActionId = $clientActionId;
        $this->createdBy = $createdBy;
        $this->createdAt = new \DateTimeImmutable();
    }

    public function clientActionId(): ?string
    {
        return $this->clientActionId;
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'payload' => $this->payload,
            'clientActionId' => $this->clientActionId,
            'createdBy' => $this->createdBy?->id(),
            'createdAt' => $this->createdAt->format(DATE_ATOM),
        ];
    }
}
