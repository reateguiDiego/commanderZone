<?php

namespace App\Application\Game\WebSocket;

use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameProjectionService;
use App\Domain\Game\Game;
use App\Domain\Localization\LanguageCatalog;
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
        private ?GameWebsocketCardLocalizationResolver $cardLocalizationResolver = null,
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
        unset($previousSnapshot);
        $viewers = $this->viewers($game);
        $messagesByUserId = [];
        $message = $this->disconnectVotePatch($game->id(), $nextSnapshot, $event);
        foreach ($viewers as $viewer) {
            $messagesByUserId[$viewer->id()] = $message;
        }

        return GameWebsocketCommandResult::forViewers(
            $messagesByUserId,
            $message,
            [
                'disconnect.vote_route' => 1.0,
                'disconnect.snapshot_write_count' => 0.0,
                'disconnect.patch_bytes' => (float) strlen(json_encode($message, JSON_THROW_ON_ERROR)),
            ],
        );
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function disconnectVotePatch(string $gameId, array $snapshot, \App\Domain\Game\GameEvent $event): array
    {
        $version = max(1, (int) ($snapshot['version'] ?? $event->version()));
        $disconnectVote = is_array($snapshot['disconnectVote'] ?? null) ? $snapshot['disconnectVote'] : null;
        $ops = [[
            'op' => 'disconnect.vote.set',
            'disconnectVote' => $disconnectVote,
        ]];

        $payload = $event->payload();
        if (($payload['status'] ?? null) === GameDisconnectVoteService::STATUS_RESOLVED_EXPEL && is_string($payload['targetPlayerId'] ?? null)) {
            $targetPlayerId = $payload['targetPlayerId'];
            $player = is_array($snapshot['players'][$targetPlayerId] ?? null) ? $snapshot['players'][$targetPlayerId] : [];
            $ops[] = [
                'op' => 'player.status.set',
                'playerId' => $targetPlayerId,
                'status' => 'conceded',
                'concededAt' => is_string($player['concededAt'] ?? null) ? $player['concededAt'] : null,
            ];
            if (is_array($snapshot['turn'] ?? null)) {
                $ops[] = [
                    'op' => 'turn.set',
                    'turn' => $snapshot['turn'],
                ];
            }
        }

        $message = [
            'kind' => 'patch.v2',
            'gameId' => $gameId,
            'version' => $version,
            'visibility' => 'public',
            'ops' => $ops,
            'metrics' => [
                'disconnect.vote_route' => 1,
                'disconnect.snapshot_write_count' => 0,
                'disconnect.patch_bytes' => 0,
            ],
            'event' => $event->toArray(),
        ];
        $message['metrics']['disconnect.patch_bytes'] = strlen(json_encode($message, JSON_THROW_ON_ERROR));

        return $message;
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

    /**
     * @param list<User> $viewers
     *
     * @return array<string,array<string,array<string,mixed>>>|null
     */
    private function localizedLookup(array $previousSnapshot, array $nextSnapshot, array $viewers): ?array
    {
        $languages = [];
        foreach ($viewers as $viewer) {
            $language = LanguageCatalog::normalize($viewer->cardLanguage());
            if ($language === null || !LanguageCatalog::isSupported($language)) {
                continue;
            }

            $languages[$language] = true;
        }

        if ($languages === []) {
            return [];
        }

        if (!$this->cardLocalizationResolver instanceof GameWebsocketCardLocalizationResolver) {
            return null;
        }

        return $this->cardLocalizationResolver->buildLocalizedLookup(
            $previousSnapshot,
            $nextSnapshot,
            array_keys($languages),
        );
    }
}
