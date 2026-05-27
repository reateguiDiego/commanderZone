<?php

namespace App\Domain\Room;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'room_waiting_log_entry')]
#[ORM\Index(columns: ['room_id', 'created_at'], name: 'idx_room_waiting_log_room_created')]
class RoomWaitingLogEntry
{
    public const TONE_DEFAULT = 'default';
    public const TONE_SUCCESS = 'success';
    private const ALLOWED_TONES = [
        self::TONE_DEFAULT,
        self::TONE_SUCCESS,
    ];

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Room::class, inversedBy: 'waitingLogEntries')]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Room $room;

    #[ORM\Column(type: 'string', length: 255)]
    private string $label;

    #[ORM\Column(type: 'string', length: 20)]
    private string $tone;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(Room $room, string $label, string $tone = self::TONE_DEFAULT)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->room = $room;
        $this->label = substr(trim($label), 0, 255);
        $this->tone = in_array($tone, self::ALLOWED_TONES, true) ? $tone : self::TONE_DEFAULT;
        $this->createdAt = new \DateTimeImmutable();
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'label' => $this->label,
            'tone' => $this->tone,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
        ];
    }
}
