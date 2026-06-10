<?php

namespace App\Application\Game\WebSocket;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameProjectionService;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Localization\LanguageCatalog;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\DBAL\Exception\DeadlockException;
use Doctrine\DBAL\Exception\LockWaitTimeoutException;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\Persistence\ManagerRegistry;

final readonly class GameWebsocketCommandPatchService
{
    public function __construct(
        private GameCommandHandler $commands,
        private GameDisconnectVoteService $disconnectVotes,
        private GameWebsocketPatchBuilder $patches,
        private GameWebsocketMessageFactory $messages,
        private GameWebsocketRoomRegistry $rooms,
        private ManagerRegistry $managerRegistry,
        private GameProjectionService $projection,
        private ?GameWebsocketCardLocalizationResolver $cardLocalizationResolver = null,
    ) {
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array<string,mixed>|GameWebsocketCommandResult
     */
    public function apply(
        string $gameId,
        string $userId,
        string $type,
        array $payload,
        string $clientActionId,
        int $baseVersion,
        ?string $messageId = null,
    ): array|GameWebsocketCommandResult {
        if (trim($clientActionId) === '') {
            return $this->messages->rejectedCommand(
                $gameId,
                $messageId,
                $clientActionId,
                max(1, $baseVersion),
                'INVALID_COMMAND_MESSAGE',
                'clientActionId must be a non-empty string.',
            );
        }

        if ($baseVersion < 1) {
            return $this->messages->rejectedCommand(
                $gameId,
                $messageId,
                $clientActionId,
                1,
                'INVALID_COMMAND_MESSAGE',
                'baseVersion must be an integer greater than or equal to 1.',
            );
        }

        $manager = $this->manager();
        $startedAt = microtime(true);
        $phaseTimings = $this->emptyDebugPhaseTimings();
        $loadStartedAt = microtime(true);

        try {
            $game = $manager->getRepository(Game::class)->find($gameId);
            $actor = $manager->getRepository(User::class)->find($userId);
            if (!$game instanceof Game || !$actor instanceof User) {
                return $this->messages->rejectedCommand(
                    $gameId,
                    $messageId,
                    $clientActionId,
                    $baseVersion,
                    'GAME_ACCESS_DENIED',
                    'Game access denied.',
                );
            }

            if (!$game->canBeControlledBy($actor)) {
                return $this->messages->rejectedCommand(
                    $game->id(),
                    $messageId,
                    $clientActionId,
                    $this->snapshotVersion($game),
                    'GAME_ACCESS_DENIED',
                    'Game access denied.',
                );
            }

            $manager->beginTransaction();
            $manager->lock($game, LockMode::PESSIMISTIC_WRITE);
            $currentVersion = $this->snapshotVersion($game);
            if ($game->status() === Game::STATUS_FINISHED && !GameCommandHandler::isAllowedWhenFinished($type)) {
                $manager->rollback();

                return $this->messages->rejectedCommand(
                    $game->id(),
                    $messageId,
                    $clientActionId,
                    $currentVersion,
                    'COMMAND_REJECTED',
                    sprintf('Game is finished. Command not allowed: %s', $type),
                );
            }

            $existingEvent = $manager->getRepository(GameEvent::class)->findOneBy([
                'game' => $game,
                'clientActionId' => $clientActionId,
            ]);
            if ($existingEvent instanceof GameEvent) {
                $manager->rollback();

                return $this->messages->duplicateCommand($game->id(), $messageId, $clientActionId, $currentVersion);
            }

            if ($baseVersion !== $currentVersion) {
                $manager->rollback();
                $delta = max(0, $currentVersion - $baseVersion);
                $classification = $delta === 1 ? 'concurrent_write' : 'stale_client';

                return $this->messages->resyncRequiredCommand(
                    $game->id(),
                    $messageId,
                    $clientActionId,
                    $currentVersion,
                    'BASE_VERSION_MISMATCH',
                    'Command baseVersion does not match the current game version.',
                    [
                        'commandBaseVersion' => $baseVersion,
                        'currentVersion' => $currentVersion,
                        'delta' => $delta,
                        'classification' => $classification,
                    ],
                );
            }

            $previousSnapshot = $game->snapshot();
            $phaseTimings['load'] = $this->elapsedMs($loadStartedAt);
            $applyStartedAt = microtime(true);
            try {
                if ($type === GameDisconnectVoteService::COMMAND_TYPE) {
                    $recorded = $this->disconnectVotes->recordVote(
                        $game,
                        $actor,
                        (string) ($payload['targetPlayerId'] ?? ''),
                        (string) ($payload['vote'] ?? ''),
                        $this->rooms->connectedUserIdsForGame($game->id()),
                    );
                    $event = $recorded['event'];
                } else {
                    $handlerPayload = $this->handlerPayload($game, $type, $payload);
                    $event = $this->commands->apply($game, $type, $handlerPayload, $actor, $clientActionId);
                }
            } catch (\InvalidArgumentException $exception) {
                $manager->rollback();

                return $this->messages->rejectedCommand(
                    $game->id(),
                    $messageId,
                    $clientActionId,
                    $currentVersion,
                    'COMMAND_REJECTED',
                    $exception->getMessage(),
                );
            }
            $phaseTimings['apply'] = $this->elapsedMs($applyStartedAt);

            $persistStartedAt = microtime(true);
            $manager->persist($event);
            $manager->flush();
            $manager->commit();
            $phaseTimings['persist'] = $this->elapsedMs($persistStartedAt);

            return $this->projectedResult(
                $game,
                $previousSnapshot,
                $game->snapshot(),
                $event,
                $this->eventPayload($type, $payload),
                $phaseTimings,
                $startedAt,
            );
        } catch (UniqueConstraintViolationException) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }

            return $this->messages->resyncRequiredCommand(
                $gameId,
                $messageId,
                $clientActionId,
                $baseVersion,
                'COMMAND_CONFLICT',
                'Command conflict. Please resync.',
            );
        } catch (DeadlockException|LockWaitTimeoutException) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }

            return $this->messages->resyncRequiredCommand(
                $gameId,
                $messageId,
                $clientActionId,
                $baseVersion,
                'COMMAND_CONFLICT',
                'Game command conflict. Please resync.',
            );
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
            throw new \RuntimeException('Game WebSocket commands require Doctrine ORM entity manager.');
        }

        return $manager;
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array<string,mixed>
     */
    private function handlerPayload(Game $game, string $type, array $payload): array
    {
        if ($type !== 'zone.changed' || isset($payload['cards'])) {
            return $payload;
        }

        $playerId = is_string($payload['playerId'] ?? null) ? $payload['playerId'] : '';
        $zone = is_string($payload['zone'] ?? null) ? $payload['zone'] : '';
        $instanceIds = $payload['instanceIds'] ?? null;
        if ($playerId === '' || $zone === '' || !is_array($instanceIds)) {
            return $payload;
        }

        $cardsById = [];
        foreach (($game->snapshot()['players'][$playerId]['zones'][$zone] ?? []) as $card) {
            if (is_array($card) && is_string($card['instanceId'] ?? null)) {
                $cardsById[$card['instanceId']] = $card;
            }
        }

        $cards = [];
        foreach ($instanceIds as $instanceId) {
            if (!is_string($instanceId) || !isset($cardsById[$instanceId])) {
                return $payload;
            }

            $cards[] = $cardsById[$instanceId];
        }

        return [
            ...$payload,
            'cards' => $cards,
        ];
    }

    /**
     * @param array<string,mixed> $clientPayload
     *
     * @return array<string,mixed>|null
     */
    private function eventPayload(string $type, array $clientPayload): ?array
    {
        if ($type !== 'zone.changed') {
            return null;
        }

        $instanceIds = $clientPayload['instanceIds'] ?? null;
        if (!is_array($instanceIds)) {
            return null;
        }

        return [
            'playerId' => $clientPayload['playerId'] ?? null,
            'zone' => $clientPayload['zone'] ?? null,
            'instanceIds' => array_values(array_filter($instanceIds, static fn (mixed $id): bool => is_string($id) && trim($id) !== '')),
        ];
    }

    /**
     * @param array<string,mixed>      $previousSnapshot
     * @param array<string,mixed>      $nextSnapshot
     * @param array<string,mixed>|null $eventPayload
     * @param array<string,float>      $phaseTimings
     */
    private function projectedResult(
        Game $game,
        array $previousSnapshot,
        array $nextSnapshot,
        GameEvent $event,
        ?array $eventPayload,
        array $phaseTimings,
        float $startedAt,
    ): GameWebsocketCommandResult
    {
        $viewers = $this->viewers($game);
        $viewerCanUseOwnHiddenZonesByUserId = [];
        foreach ($viewers as $viewer) {
            $viewerCanUseOwnHiddenZonesByUserId[$viewer->id()] = $game->room()->hasPlayer($viewer);
        }

        $localizationStartedAt = microtime(true);
        $localizedLookup = $this->localizedLookup($previousSnapshot, $nextSnapshot, $viewers);
        $phaseTimings['localization'] = $this->elapsedMs($localizationStartedAt);
        $projectionStartedAt = microtime(true);
        $previousRulingsLookup = $this->projection->rulingsLookupForViewers($previousSnapshot, $viewers, $viewerCanUseOwnHiddenZonesByUserId);
        $nextRulingsLookup = $this->projection->rulingsLookupForViewers($nextSnapshot, $viewers, $viewerCanUseOwnHiddenZonesByUserId);
        $messagesByUserId = [];
        $projectionMs = $this->elapsedMs($projectionStartedAt);
        $patchMs = 0.0;
        foreach ($viewers as $viewer) {
            $viewerProjectionStartedAt = microtime(true);
            $viewerCanUseOwnHiddenZones = $viewerCanUseOwnHiddenZonesByUserId[$viewer->id()] ?? true;
            $previousProjection = $this->projection->projectSnapshot($previousSnapshot, $viewer, $viewerCanUseOwnHiddenZones, $localizedLookup, $previousRulingsLookup);
            $nextProjection = $this->projection->projectSnapshot($nextSnapshot, $viewer, $viewerCanUseOwnHiddenZones, $localizedLookup, $nextRulingsLookup);
            $projectionMs += $this->elapsedMs($viewerProjectionStartedAt);
            $patchStartedAt = microtime(true);
            $messagesByUserId[$viewer->id()] = $this->patches->build($game->id(), $previousProjection, $nextProjection, $event, $eventPayload, $viewer->id());
            $patchMs += $this->elapsedMs($patchStartedAt);
        }
        $phaseTimings['projection'] = round($projectionMs, 2);
        $phaseTimings['patch'] = round($patchMs, 2);
        $phaseTimings['total'] = $this->elapsedMs($startedAt);

        return GameWebsocketCommandResult::forViewers(
            $messagesByUserId,
            $this->messages->resyncRequired($game->id(), $this->snapshotVersion($game), 'projection_unavailable', $event->clientActionId()),
            $this->normalizeDebugProfile($phaseTimings),
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

    private function snapshotVersion(Game $game): int
    {
        return max(1, (int) ($game->snapshot()['version'] ?? 1));
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

    /**
     * @return array{load: float, apply: float, persist: float, localization: float, projection: float, patch: float, total: float}
     */
    private function emptyDebugPhaseTimings(): array
    {
        return [
            'load' => 0.0,
            'apply' => 0.0,
            'persist' => 0.0,
            'localization' => 0.0,
            'projection' => 0.0,
            'patch' => 0.0,
            'total' => 0.0,
        ];
    }

    private function elapsedMs(float $startedAt): float
    {
        return round(max(0, (microtime(true) - $startedAt) * 1000), 2);
    }

    /**
     * @param array<string,float> $phaseTimings
     *
     * @return array<string,float>
     */
    private function normalizeDebugProfile(array $phaseTimings): array
    {
        $normalized = [];
        foreach ($this->emptyDebugPhaseTimings() as $phase => $defaultValue) {
            $value = $phaseTimings[$phase] ?? $defaultValue;
            $normalized[$phase] = round(max(0, (float) $value), 2);
        }

        return $normalized;
    }
}
