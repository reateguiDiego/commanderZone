<?php

namespace App\Domain\Game;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game_log_entry')]
#[ORM\Index(name: 'idx_game_log_game_version', columns: ['game_id', 'version'])]
#[ORM\Index(name: 'idx_game_log_game_created_at', columns: ['game_id', 'created_at'])]
class GameLogEntry
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Game::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Game $game;

    #[ORM\Column(type: 'integer')]
    private int $version;

    #[ORM\Column(type: 'string', length: 80)]
    private string $type;

    #[ORM\Column(type: 'string', length: 1000)]
    private string $text;

    #[ORM\Column(type: 'json')]
    private array $metadata;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    /**
     * @param array<string,mixed> $metadata
     */
    public function __construct(Game $game, int $version, string $type, string $text, array $metadata = [], ?\DateTimeImmutable $createdAt = null)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->game = $game;
        $this->version = max(1, $version);
        $this->type = $type;
        $this->text = mb_substr($text, 0, 1000);
        $this->metadata = $metadata;
        $this->createdAt = $createdAt ?? new \DateTimeImmutable();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function version(): int
    {
        return $this->version;
    }

    public function createdAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'message' => $this->text,
            'version' => $this->version,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            ...$this->metadata,
        ];
    }

    /**
     * @return array<string,mixed>
     */
    public function toEventArray(): array
    {
        return [
            'id' => $this->id,
            'version' => $this->version,
            'type' => $this->type,
            'message' => $this->text,
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            ...$this->metadata,
        ];
    }
}
