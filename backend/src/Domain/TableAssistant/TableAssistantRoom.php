<?php

namespace App\Domain\TableAssistant;

use App\Domain\Room\Room;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'table_assistant_room')]
#[ORM\UniqueConstraint(name: 'uniq_table_assistant_room_room', columns: ['room_id'])]
class TableAssistantRoom
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\OneToOne(targetEntity: Room::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Room $room;

    #[ORM\Column(type: 'json')]
    private array $snapshot;

    #[ORM\Column(type: 'json')]
    private array $appliedActionIds = [];

    #[ORM\Column(type: 'integer')]
    private int $version = 1;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(Room $room, array $snapshot)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->room = $room;
        $this->snapshot = $snapshot;
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
        $this->syncSnapshotVersion();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function room(): Room
    {
        return $this->room;
    }

    public function snapshot(): array
    {
        return $this->snapshot;
    }

    public function version(): int
    {
        return $this->version;
    }

    public function hasAppliedAction(string $clientActionId): bool
    {
        return in_array($clientActionId, $this->appliedActionIds, true);
    }

    public function replaceSnapshot(array $snapshot, ?string $clientActionId = null): void
    {
        if ($clientActionId !== null && $this->hasAppliedAction($clientActionId)) {
            return;
        }

        $this->version++;
        $this->snapshot = $snapshot;
        $this->updatedAt = new \DateTimeImmutable();

        if ($clientActionId !== null) {
            $this->appliedActionIds[] = $clientActionId;
            $this->appliedActionIds = array_values(array_slice(array_unique($this->appliedActionIds), -200));
        }

        $this->syncSnapshotVersion();
    }

    public function toArray(): array
    {
        return [
            'id' => $this->room->id(),
            'tableAssistantId' => $this->id,
            'room' => $this->room->toArray(),
            'state' => $this->snapshot,
            'version' => $this->version,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            'updatedAt' => $this->updatedAt->format(DATE_ATOM),
        ];
    }

    private function syncSnapshotVersion(): void
    {
        $this->snapshot['id'] = $this->room->id();
        $this->snapshot['version'] = $this->version;
        $this->snapshot['updatedAt'] = $this->updatedAt->format(DATE_ATOM);
    }
}

