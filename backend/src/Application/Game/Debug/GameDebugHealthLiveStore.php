<?php

namespace App\Application\Game\Debug;

final class GameDebugHealthLiveStore
{
    /**
     * @var array<string,array<string,mixed>>
     */
    private array $states = [];

    /**
     * @var array<string,\DateTimeImmutable>
     */
    private array $lastUpdatedAt = [];

    /**
     * @var array<string,array<string,\Closure(array<string,mixed>):void>>
     */
    private array $subscribers = [];

    public function __construct(private readonly GameDebugHealthAggregator $aggregator)
    {
    }

    public function isObserved(string $gameId): bool
    {
        return ($this->subscribers[$gameId] ?? []) !== [];
    }

    /**
     * @param \Closure(array<string,mixed>):void $subscriber
     */
    public function subscribe(string $gameId, \Closure $subscriber): string
    {
        $subscriberId = bin2hex(random_bytes(8));
        $firstSubscriber = !$this->isObserved($gameId);
        if ($firstSubscriber) {
            $this->states[$gameId] = $this->aggregator->normalize([]);
        }

        $this->subscribers[$gameId][$subscriberId] = $subscriber;
        $subscriber($this->reportForGame($gameId));

        return $subscriberId;
    }

    public function unsubscribe(string $gameId, string $subscriberId): void
    {
        unset($this->subscribers[$gameId][$subscriberId]);
        if (($this->subscribers[$gameId] ?? []) === []) {
            unset($this->subscribers[$gameId], $this->states[$gameId], $this->lastUpdatedAt[$gameId]);
        }
    }

    /**
     * @return array<string,mixed>
     */
    public function reportForGame(string $gameId): array
    {
        $generatedAt = new \DateTimeImmutable();
        $updatedAt = $this->lastUpdatedAt[$gameId] ?? $generatedAt;

        return [
            'gameId' => $gameId,
            'enabled' => $this->isObserved($gameId),
            'health' => $this->aggregator->normalize($this->states[$gameId] ?? []),
            'generatedAt' => $generatedAt->format(DATE_ATOM),
            'updatedAt' => $updatedAt->format(DATE_ATOM),
        ];
    }

    public function recordConnectionSnapshot(string $gameId, string $userId, string $displayName, string $status, int $totalConnections, int $userConnections, ?string $changedAt = null): void
    {
        $this->mutate($gameId, fn (array $state): array => $this->aggregator->recordConnectionSnapshot(
            $state,
            $userId,
            $displayName,
            $status,
            $totalConnections,
            $userConnections,
            $changedAt,
        ));
    }

    /**
     * @param array<string,mixed> $message
     */
    public function recordOutboundMessage(string $gameId, array $message, ?string $channel = null): void
    {
        $this->mutate(
            $gameId,
            fn (array $state): array => $this->aggregator->recordOutboundMessage($state, $message, $channel),
            publish: !$this->isGameplayKeepaliveMessage($message),
        );
    }

    /**
     * @param array<string,mixed> $message
     */
    public function recordIncomingMessage(string $gameId, array $message, int $characters): void
    {
        $this->mutate(
            $gameId,
            fn (array $state): array => $this->aggregator->recordIncomingMessage($state, $message, $characters),
            publish: !$this->isGameplayKeepaliveMessage($message),
        );
    }

    /**
     * @param array<string,mixed>       $incoming
     * @param list<array<string,mixed>> $outgoing
     */
    public function recordActionExchange(string $gameId, array $incoming, array $outgoing, float $durationMs): void
    {
        $this->mutate($gameId, fn (array $state): array => $this->aggregator->recordActionExchange($state, $incoming, $outgoing, $durationMs));
    }

    /**
     * @param array<string,mixed>|null $meta
     */
    public function recordIncomingValidationError(string $gameId, string $code, string $message, ?array $meta = null): void
    {
        $this->mutate($gameId, fn (array $state): array => $this->aggregator->recordIncomingValidationError($state, $code, $message, $meta));
    }

    public function recordReplayResult(string $gameId, string $userId, int $lastSeenVersion, int $currentVersion, ?int $replayedCount, string $result): void
    {
        $this->mutate($gameId, fn (array $state): array => $this->aggregator->recordReplayResult(
            $state,
            $userId,
            $lastSeenVersion,
            $currentVersion,
            $replayedCount,
            $result,
        ));
    }

    /**
     * @param \Closure(array<string,mixed>):array<string,mixed> $mutator
     */
    private function mutate(string $gameId, \Closure $mutator, bool $publish = true): void
    {
        if (!$this->isObserved($gameId)) {
            return;
        }

        $this->states[$gameId] = $this->aggregator->normalize($mutator($this->states[$gameId] ?? []));
        $this->lastUpdatedAt[$gameId] = new \DateTimeImmutable();
        if (!$publish) {
            return;
        }

        $this->publish($gameId);
    }

    /**
     * @param array<string,mixed> $message
     */
    private function isGameplayKeepaliveMessage(array $message): bool
    {
        $kind = $message['kind'] ?? null;

        return $kind === 'ping' || $kind === 'pong';
    }

    private function publish(string $gameId): void
    {
        $report = $this->reportForGame($gameId);
        foreach ($this->subscribers[$gameId] ?? [] as $subscriberId => $subscriber) {
            try {
                $subscriber($report);
            } catch (\Throwable) {
                $this->unsubscribe($gameId, $subscriberId);
            }
        }
    }
}
