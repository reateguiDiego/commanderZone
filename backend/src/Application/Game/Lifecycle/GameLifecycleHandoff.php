<?php

namespace App\Application\Game\Lifecycle;

final readonly class GameLifecycleHandoff
{
    public const PLAYER_CONCEDED = 'player.conceded';
    public const PLAYER_EXPELLED = 'player.expelled';
    public const GAME_FINISHED = 'game.finished';
    public const ALL_PLAYERS_DISCONNECTED = 'game.all_players_disconnected';
    public const ALL_DISCONNECTED_CANCELLED = 'game.all_disconnected_cancelled';

    private const TYPES = [
        self::PLAYER_CONCEDED,
        self::PLAYER_EXPELLED,
        self::GAME_FINISHED,
        self::ALL_PLAYERS_DISCONNECTED,
        self::ALL_DISCONNECTED_CANCELLED,
    ];

    public function __construct(
        public string $eventId,
        public string $gameId,
        public string $type,
        public int $version,
        public int $generation,
        public int $fencing,
        public \DateTimeImmutable $occurredAt,
        public ?string $clientActionId = null,
        public ?string $playerId = null,
        public ?string $playerReason = null,
        public ?string $winnerPlayerId = null,
        public ?string $finishReason = null,
    ) {
        if ($this->eventId === '' || $this->gameId === '') {
            throw new \InvalidArgumentException('eventId and gameId are required.');
        }
        if (!in_array($this->type, self::TYPES, true)) {
            throw new \InvalidArgumentException('Unsupported lifecycle handoff type.');
        }
        if ($this->version < 1 || $this->generation < 1 || $this->fencing < 0) {
            throw new \InvalidArgumentException('Invalid lifecycle cursor.');
        }
        if (in_array($this->type, [self::PLAYER_CONCEDED, self::PLAYER_EXPELLED], true) && $this->playerId === null) {
            throw new \InvalidArgumentException('playerId is required for player lifecycle facts.');
        }
        if ($this->type === self::GAME_FINISHED && ($this->finishReason === null || $this->finishReason === '')) {
            throw new \InvalidArgumentException('finishReason is required for game.finished.');
        }
    }

    /** @param array<string,mixed> $payload */
    public static function fromArray(array $payload): self
    {
        $occurredAt = is_string($payload['occurredAt'] ?? null) ? trim($payload['occurredAt']) : '';
        if ($occurredAt === '') {
            throw new \InvalidArgumentException('occurredAt is required.');
        }
        try {
            $date = new \DateTimeImmutable($occurredAt);
        } catch (\Throwable) {
            throw new \InvalidArgumentException('occurredAt must be a valid date-time.');
        }

        return new self(
            self::requiredString($payload, 'eventId'),
            self::requiredString($payload, 'gameId'),
            self::requiredString($payload, 'type'),
            self::requiredInt($payload, 'version'),
            self::requiredInt($payload, 'generation'),
            self::requiredInt($payload, 'fencing'),
            $date,
            self::optionalString($payload, 'clientActionId'),
            self::optionalString($payload, 'playerId'),
            self::optionalString($payload, 'playerReason'),
            self::optionalString($payload, 'winnerPlayerId'),
            self::optionalString($payload, 'finishReason'),
        );
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return array_filter([
            'eventId' => $this->eventId,
            'gameId' => $this->gameId,
            'type' => $this->type,
            'playerId' => $this->playerId,
            'playerReason' => $this->playerReason,
            'winnerPlayerId' => $this->winnerPlayerId,
            'finishReason' => $this->finishReason,
            'clientActionId' => $this->clientActionId,
            'version' => $this->version,
            'generation' => $this->generation,
            'fencing' => $this->fencing,
            'occurredAt' => $this->occurredAt->format(DATE_ATOM),
        ], static fn (mixed $value): bool => $value !== null && $value !== '');
    }

    /** @param array<string,mixed> $payload */
    private static function requiredString(array $payload, string $field): string
    {
        $value = is_string($payload[$field] ?? null) ? trim($payload[$field]) : '';
        if ($value === '') {
            throw new \InvalidArgumentException(sprintf('%s is required.', $field));
        }

        return $value;
    }

    /** @param array<string,mixed> $payload */
    private static function optionalString(array $payload, string $field): ?string
    {
        $value = is_string($payload[$field] ?? null) ? trim($payload[$field]) : '';

        return $value !== '' ? $value : null;
    }

    /** @param array<string,mixed> $payload */
    private static function requiredInt(array $payload, string $field): int
    {
        if (!is_int($payload[$field] ?? null)) {
            throw new \InvalidArgumentException(sprintf('%s must be an integer.', $field));
        }

        return $payload[$field];
    }
}

