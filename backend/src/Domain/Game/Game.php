<?php

namespace App\Domain\Game;

use App\Domain\Room\Room;
use App\Domain\User\User;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game')]
class Game
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_FINISHED = 'finished';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Room::class)]
    #[ORM\JoinColumn(nullable: false)]
    private Room $room;

    #[ORM\Column(type: 'string', length: 40)]
    private string $status = self::STATUS_ACTIVE;

    #[ORM\Column(type: 'json')]
    private array $snapshot;

    #[ORM\OneToMany(mappedBy: 'game', targetEntity: GameEvent::class, cascade: ['persist'], orphanRemoval: false)]
    private Collection $events;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(Room $room, array $snapshot)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->room = $room;
        $this->snapshot = $snapshot;
        $this->events = new ArrayCollection();
        $this->createdAt = new \DateTimeImmutable();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function snapshot(): array
    {
        return $this->snapshot;
    }

    public function room(): Room
    {
        return $this->room;
    }

    public function status(): string
    {
        return $this->status;
    }

    public function canBeAccessedBy(User $user): bool
    {
        return $this->room->owner()->id() === $user->id() || $this->room->hasPlayer($user);
    }

    public function replaceSnapshot(array $snapshot): void
    {
        $this->snapshot = $snapshot;
    }

    public function finish(): void
    {
        $this->status = self::STATUS_FINISHED;
    }

    public function addEvent(GameEvent $event): void
    {
        $this->events->add($event);
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'snapshot' => $this->snapshot,
        ];
    }
}
