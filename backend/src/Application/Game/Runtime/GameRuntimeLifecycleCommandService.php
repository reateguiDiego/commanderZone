<?php

namespace App\Application\Game\Runtime;

use App\Domain\Game\Game;
use App\Domain\User\User;

final readonly class GameRuntimeLifecycleCommandService
{
    public function __construct(private GameplayRuntimeGateway $runtime)
    {
    }

    public function isRuntimePrimary(string $commandType): bool
    {
        return $this->runtime->routeFor($commandType) === GameplayRuntimeRoute::RuntimePrimary;
    }

    public function concedeForLeave(Game $game, User $player, string $reason): GameRuntimeCommandResult
    {
        if (!$this->isRuntimePrimary('game.concede')) {
            throw new GameRuntimeGatewayException('The gameplay runtime is required to concede an active player before leaving.');
        }

        $clientActionId = sprintf('lifecycle:concede:%s:%s:%s', $reason, $game->id(), $player->id());
        $baseVersion = max(1, (int) ($game->snapshot()['version'] ?? 1));

        return $this->dispatchWithConflictRecovery(
            'game.concede',
            $game,
            $player,
            $baseVersion,
            $clientActionId,
            ['playerId' => $player->id(), 'reason' => $reason],
        );
    }

    /**
     * @param list<string> $connectedUserIds
     */
    public function recordDisconnectVote(
        Game $game,
        User $voter,
        string $targetPlayerId,
        string $vote,
        array $connectedUserIds,
    ): ?GameRuntimeCommandResult {
        if (!$this->isRuntimePrimary('disconnect.vote')) {
            return null;
        }

        $baseVersion = max(1, (int) ($game->snapshot()['version'] ?? 1));
        $identity = implode(':', [$game->id(), $baseVersion, $voter->id(), $targetPlayerId, $vote]);
        $clientActionId = 'lifecycle:disconnect:'.hash('sha256', $identity);

        return $this->dispatchWithConflictRecovery(
            'disconnect.vote',
            $game,
            $voter,
            $baseVersion,
            $clientActionId,
            [
                'targetPlayerId' => $targetPlayerId,
                'playerId' => $voter->id(),
                'vote' => $vote,
                'connectedUserIds' => array_values(array_unique($connectedUserIds)),
            ],
        );
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function dispatchWithConflictRecovery(
        string $type,
        Game $game,
        User $actor,
        int $baseVersion,
        string $clientActionId,
        array $payload,
    ): GameRuntimeCommandResult {
        try {
            return $this->dispatch($type, $game, $actor, $baseVersion, $clientActionId, $payload);
        } catch (GameRuntimeVersionConflictException $conflict) {
            // Exceptional-path retry only. Reusing the exact action id makes the
            // retry safe if the first request committed but its response was lost.
            return $this->dispatch($type, $game, $actor, $conflict->currentVersion, $clientActionId, $payload);
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function dispatch(
        string $type,
        Game $game,
        User $actor,
        int $baseVersion,
        string $clientActionId,
        array $payload,
    ): GameRuntimeCommandResult {
        return $this->runtime->dispatchPrimary(
            $type,
            $game->id(),
            $actor->id(),
            $baseVersion,
            $clientActionId,
            $payload,
        );
    }
}
