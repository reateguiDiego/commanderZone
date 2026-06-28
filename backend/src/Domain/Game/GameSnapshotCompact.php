<?php

namespace App\Domain\Game;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game_snapshot_compact')]
#[ORM\UniqueConstraint(name: 'uniq_game_snapshot_compact_version', columns: ['game_id', 'version'])]
#[ORM\Index(name: 'idx_game_snapshot_compact_created_at', columns: ['game_id', 'created_at'])]
class GameSnapshotCompact
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Game::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Game $game;

    #[ORM\Column(type: 'integer')]
    private int $version;

    #[ORM\Column(type: 'json')]
    private array $snapshot;

    #[ORM\Column(type: 'string', length: 64)]
    private string $checksum;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(Game $game, int $version, array $snapshot, string $checksum)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->game = $game;
        $this->version = max(1, $version);
        $this->snapshot = $snapshot;
        $this->checksum = $checksum;
        $this->createdAt = new \DateTimeImmutable();
    }

    public function game(): Game
    {
        return $this->game;
    }

    public function version(): int
    {
        return $this->version;
    }

    /**
     * @return array<string,mixed>
     */
    public function snapshot(): array
    {
        return $this->snapshot;
    }

    public function checksum(): string
    {
        return $this->checksum;
    }

    public function createdAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }
}
