<?php

namespace App\Application\Game\WebSocket;

use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameProjectionService;
use App\Domain\Game\Game;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\Persistence\ManagerRegistry;

final readonly class GameWebsocketDisconnectVoteOrchestrator
{
    public function __construct(
        private GameDisconnectVoteService $disconnectVotes,
        private GameWebsocketPatchBuilder $patches,
        private GameWebsocketMessageFactory $messages,
        private GameWebsocketRoomRegistry $rooms,
        private ManagerRegistry $managerRegistry,
        private GameProjectionService $projection,
    ) {
    }

    public function handlePresenceTransition(string $gameId, string $targetUserId, string $status): ?GameWebsocketCommandResult
    {
        if (
            $status === 'offline'
            && !$this->rooms->isUserOfflineBeyondGrace($gameId, $targetUserId, GameDisconnectVoteService::OFFLINE_GRACE_SECONDS)
        ) {
            return null;
        }

        return $this->mutateGame($gameId, function (Game $game) use ($status, $targetUserId): ?array {
            return $status === 'online'
                ? $this->disconnectVotes->cancelOnReconnect($game, $targetUserId)
                : $this->disconnectVotes->openVoteIfEligible($game, $targetUserId, $this->rooms->connectedUserIdsForGame($game->id()));
        });
    }

    public function resolveTimeout(string $gameId): ?GameWebsocketCommandResult
    {
        return $this->mutateGame($gameId, function (Game $game): ?array {
            $connectedUserIds = $this->rooms->connectedUserIdsForGame($game->id());
            $resolved = $this->disconnectVotes->resolveOnTimeout($game, $connectedUserIds);
            if ($resolved !== null) {
                return $resolved;
            }

            $players = $game->snapshot()['players'] ?? null;
            if (!is_array($players)) {
                return null;
            }

            foreach ($players as $playerId => $player) {
                if (
                    !is_string($playerId)
                    || !is_array($player)
                    || ($player['status'] ?? 'active') === 'conceded'
                    || in_array($playerId, $connectedUserIds, true)
                    || !$this->rooms->isUserOfflineBeyondGrace($game->id(), $playerId, GameDisconnectVoteService::OFFLINE_GRACE_SECONDS)
                ) {
                    continue;
                }

                $reopened = $this->disconnectVotes->openVoteIfEligible($game, $playerId, $connectedUserIds);
                if ($reopened !== null) {
                    return $reopened;
                }
            }

            return null;
        });
    }

    /**
     * @param callable(Game): (?array{event:\App\Domain\Game\GameEvent,snapshot:array<string,mixed>}) $mutation
     */
    private function mutateGame(string $gameId, callable $mutation): ?GameWebsocketCommandResult
    {
        $manager = $this->manager();
        try {
            $game = $manager->getRepository(Game::class)->find($gameId);
            if (!$game instanceof Game) {
                return null;
            }

            $manager->beginTransaction();
            $manager->lock($game, LockMode::PESSIMISTIC_WRITE);
            $previousSnapshot = $game->snapshot();
            $recorded = $mutation($game);
            if ($recorded === null) {
                $manager->rollback();

                return null;
            }

            $event = $recorded['event'];
            $manager->persist($event);
            $manager->flush();
            $manager->commit();

            return $this->projectedResult($game, $previousSnapshot, $game->snapshot(), $event);
        } catch (\InvalidArgumentException) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }

            return null;
        } catch (\Throwable $exception) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }

            throw $exception;
        } finally {
            $manager->clear();
        }
    }

    private function manager(): EntityManagerInterface
    {
        $manager = $this->managerRegistry->getManagerForClass(Game::class)
            ?? $this->managerRegistry->getManager();
        if (!$manager instanceof EntityManagerInterface) {
            throw new \RuntimeException('Disconnect vote orchestration requires Doctrine ORM entity manager.');
        }

        return $manager;
    }

    private function projectedResult(
        Game $game,
        array $previousSnapshot,
        array $nextSnapshot,
        \App\Domain\Game\GameEvent $event,
    ): GameWebsocketCommandResult {
        $messagesByUserId = [];
        foreach ($this->viewers($game) as $viewer) {
            $viewerCanUseOwnHiddenZones = $game->room()->hasPlayer($viewer);
            $previousProjection = $this->projection->projectSnapshot($previousSnapshot, $viewer, $viewerCanUseOwnHiddenZones);
            $nextProjection = $this->projection->projectSnapshot($nextSnapshot, $viewer, $viewerCanUseOwnHiddenZones);
            $messagesByUserId[$viewer->id()] = $this->patches->build($game->id(), $previousProjection, $nextProjection, $event, null, $viewer->id());
        }

        return GameWebsocketCommandResult::forViewers(
            $messagesByUserId,
            $this->messages->resyncRequired($game->id(), max(1, (int) ($nextSnapshot['version'] ?? 1)), 'projection_unavailable', $event->clientActionId()),
        );
    }

    /**
     * @return list<User>
     */
    private function viewers(Game $game): array
    {
        $viewers = [$game->room()->owner()->id() => $game->room()->owner()];
        foreach ($game->room()->orderedPlayers() as $roomPlayer) {
            if ($roomPlayer instanceof RoomPlayer) {
                $viewers[$roomPlayer->user()->id()] = $roomPlayer->user();
            }
        }

        return array_values($viewers);
    }
}
