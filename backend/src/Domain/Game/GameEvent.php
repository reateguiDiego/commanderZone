<?php

namespace App\Domain\Game;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'game_event')]
#[ORM\UniqueConstraint(name: 'uniq_game_event_client_action', columns: ['game_id', 'client_action_id'])]
#[ORM\UniqueConstraint(name: 'uniq_game_event_version', columns: ['game_id', 'version'])]
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

    #[ORM\Column(type: 'integer')]
    private int $version;

    #[ORM\Column(type: 'string', length: 120, nullable: true)]
    private ?string $clientActionId = null;

    #[ORM\ManyToOne(targetEntity: User::class)]
    private ?User $createdBy;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    /**
     * Non-persisted payload used for immediate responses and patches.
     *
     * @var array<string,mixed>|null
     */
    private ?array $publicPayload = null;

    public function __construct(Game $game, string $type, array $payload, ?User $createdBy, ?string $clientActionId = null, ?int $version = null)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->game = $game;
        $this->type = $type;
        $this->payload = $payload;
        $this->version = $version ?? max(1, (int) ($game->snapshot()['version'] ?? 1));
        $this->clientActionId = $clientActionId;
        $this->createdBy = $createdBy;
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function type(): string
    {
        return $this->type;
    }

    /**
     * @return array<string,mixed>
     */
    public function payload(): array
    {
        return $this->payload;
    }

    public function replacePayload(array $payload): void
    {
        $this->payload = $payload;
        $this->updatedAt = new \DateTimeImmutable();
    }

    public function version(): int
    {
        return $this->version;
    }

    public function createdBy(): ?User
    {
        return $this->createdBy;
    }

    public function createdAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function withPublicPayload(array $payload): self
    {
        $this->publicPayload = $payload;

        return $this;
    }

    public function clientActionId(): ?string
    {
        return $this->clientActionId;
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'version' => $this->version,
            'type' => $this->type,
            'payload' => $this->publicPayload(),
            'clientActionId' => $this->clientActionId,
            'createdBy' => $this->createdBy?->id(),
            'createdAt' => $this->createdAt->format(DATE_ATOM),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function publicPayload(): array
    {
        if ($this->publicPayload !== null) {
            return $this->publicPayload;
        }

        $public = $this->payload['public'] ?? null;

        return is_array($public) ? $public : $this->payload;
    }
}
