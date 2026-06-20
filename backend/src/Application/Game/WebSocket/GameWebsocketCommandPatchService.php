<?php

namespace App\Application\Game\WebSocket;

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameProjectionService;
use App\Application\Game\Performance\GameplayMetricsInspector;
use App\Application\Game\Performance\GameplayMetricsRecorderInterface;
use App\Application\Game\Performance\GameplayNullMetricsRecorder;
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
        private ?GameplayMetricsRecorderInterface $metricsRecorder = null,
        private ?GameplayMetricsInspector $metricsInspector = null,
        private ?GameplayV2ContractFactory $contractsV2 = null,
        private ?GameplayV2Flags $flagsV2 = null,
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
        string $responseProtocol = 'legacy',
    ): array|GameWebsocketCommandResult {
        $metricsInspector = $this->metricsInspector();
        $metricsRecorder = $this->metricsRecorder();
        $startedAt = microtime(true);
        $usageStartedAt = $metricsInspector->usageSnapshot();
        $snapshotLoadMs = 0.0;
        $normalizeMs = 0.0;
        $commandApplyMs = 0.0;
        $persistMs = 0.0;
        $projectionMs = 0.0;
        $patchMs = 0.0;
        $snapshotBytesBefore = 0;
        $snapshotBytesAfter = 0;
        $patchBytes = 0;
        $numberOfPlayers = 0;
        $numberOfInstances = 0;
        $numberOfVisibleCards = 0;
        $resyncRequired = false;
        $duplicate = false;
        $status = 'rejected';

        if (trim($clientActionId) === '') {
            $message = $this->messages->rejectedCommand(
                $gameId,
                $messageId,
                $clientActionId,
                max(1, $baseVersion),
                'INVALID_COMMAND_MESSAGE',
                'clientActionId must be a non-empty string.',
            );
            $this->recordMetric(
                $metricsRecorder,
                $metricsInspector,
                [
                    'transport' => 'websocket',
                    'command.type' => $type,
                    'gameId' => $gameId,
                    'snapshot_load_ms' => $snapshotLoadMs,
                    'normalize_ms' => $normalizeMs,
                    'command_apply_ms' => $commandApplyMs,
                    'persist_ms' => $persistMs,
                    'projection_ms' => $projectionMs,
                    'patch_build_ms' => $patchMs,
                    'total_server_ms' => $this->elapsedMs($startedAt),
                    'snapshot_bytes_before' => $snapshotBytesBefore,
                    'snapshot_bytes_after' => $snapshotBytesAfter,
                    'patch_bytes' => $patchBytes,
                    'number_of_players' => $numberOfPlayers,
                    'number_of_instances' => $numberOfInstances,
                    'number_of_visible_cards' => $numberOfVisibleCards,
                    'resync_required' => false,
                    'clientActionId_duplicate' => false,
                    'status' => $status,
                ],
                $usageStartedAt,
            );

            return $message;
        }

        if ($baseVersion < 1) {
            $message = $this->messages->rejectedCommand(
                $gameId,
                $messageId,
                $clientActionId,
                1,
                'INVALID_COMMAND_MESSAGE',
                'baseVersion must be an integer greater than or equal to 1.',
            );
            $this->recordMetric(
                $metricsRecorder,
                $metricsInspector,
                [
                    'transport' => 'websocket',
                    'command.type' => $type,
                    'gameId' => $gameId,
                    'snapshot_load_ms' => $snapshotLoadMs,
                    'normalize_ms' => $normalizeMs,
                    'command_apply_ms' => $commandApplyMs,
                    'persist_ms' => $persistMs,
                    'projection_ms' => $projectionMs,
                    'patch_build_ms' => $patchMs,
                    'total_server_ms' => $this->elapsedMs($startedAt),
                    'snapshot_bytes_before' => $snapshotBytesBefore,
                    'snapshot_bytes_after' => $snapshotBytesAfter,
                    'patch_bytes' => $patchBytes,
                    'number_of_players' => $numberOfPlayers,
                    'number_of_instances' => $numberOfInstances,
                    'number_of_visible_cards' => $numberOfVisibleCards,
                    'resync_required' => false,
                    'clientActionId_duplicate' => false,
                    'status' => $status,
                ],
                $usageStartedAt,
            );

            return $message;
        }

        $manager = $this->manager();
        $phaseTimings = $this->emptyDebugPhaseTimings();
        $loadStartedAt = microtime(true);

        try {
            $game = $manager->getRepository(Game::class)->find($gameId);
            $actor = $manager->getRepository(User::class)->find($userId);
            $snapshotLoadMs = $this->elapsedMs($loadStartedAt);
            if (!$game instanceof Game || !$actor instanceof User) {
                $message = $this->messages->rejectedCommand(
                    $gameId,
                    $messageId,
                    $clientActionId,
                    $baseVersion,
                    'GAME_ACCESS_DENIED',
                    'Game access denied.',
                );
                $this->recordMetric(
                    $metricsRecorder,
                    $metricsInspector,
                    [
                        'transport' => 'websocket',
                        'command.type' => $type,
                        'gameId' => $gameId,
                        'snapshot_load_ms' => $snapshotLoadMs,
                        'normalize_ms' => $normalizeMs,
                        'command_apply_ms' => $commandApplyMs,
                        'persist_ms' => $persistMs,
                        'projection_ms' => $projectionMs,
                        'patch_build_ms' => $patchMs,
                        'total_server_ms' => $this->elapsedMs($startedAt),
                        'snapshot_bytes_before' => $snapshotBytesBefore,
                        'snapshot_bytes_after' => $snapshotBytesAfter,
                        'patch_bytes' => $patchBytes,
                        'number_of_players' => $numberOfPlayers,
                        'number_of_instances' => $numberOfInstances,
                        'number_of_visible_cards' => $numberOfVisibleCards,
                        'resync_required' => false,
                        'clientActionId_duplicate' => false,
                        'status' => $status,
                    ],
                    $usageStartedAt,
                );

                return $message;
            }

            $snapshotBytesBefore = $metricsInspector->jsonBytes($game->snapshot());
            $snapshotBytesAfter = $snapshotBytesBefore;
            $numberOfPlayers = $metricsInspector->countPlayers($game->snapshot());
            $numberOfInstances = $metricsInspector->countInstances($game->snapshot());

            if (!$game->canBeControlledBy($actor)) {
                $message = $this->messages->rejectedCommand(
                    $game->id(),
                    $messageId,
                    $clientActionId,
                    $this->snapshotVersion($game),
                    'GAME_ACCESS_DENIED',
                    'Game access denied.',
                );
                $this->recordMetric(
                    $metricsRecorder,
                    $metricsInspector,
                    [
                        'transport' => 'websocket',
                        'command.type' => $type,
                        'gameId' => $game->id(),
                        'snapshot_load_ms' => $snapshotLoadMs,
                        'normalize_ms' => $normalizeMs,
                        'command_apply_ms' => $commandApplyMs,
                        'persist_ms' => $persistMs,
                        'projection_ms' => $projectionMs,
                        'patch_build_ms' => $patchMs,
                        'total_server_ms' => $this->elapsedMs($startedAt),
                        'snapshot_bytes_before' => $snapshotBytesBefore,
                        'snapshot_bytes_after' => $snapshotBytesAfter,
                        'patch_bytes' => $patchBytes,
                        'number_of_players' => $numberOfPlayers,
                        'number_of_instances' => $numberOfInstances,
                        'number_of_visible_cards' => $numberOfVisibleCards,
                        'resync_required' => false,
                        'clientActionId_duplicate' => false,
                        'status' => $status,
                    ],
                    $usageStartedAt,
                );

                return $message;
            }

            $manager->beginTransaction();
            $manager->lock($game, LockMode::PESSIMISTIC_WRITE);
            $currentVersion = $this->snapshotVersion($game);
            if ($game->status() === Game::STATUS_FINISHED && !GameCommandHandler::isAllowedWhenFinished($type)) {
                $manager->rollback();

                $message = $this->messages->rejectedCommand(
                    $game->id(),
                    $messageId,
                    $clientActionId,
                    $currentVersion,
                    'COMMAND_REJECTED',
                    sprintf('Game is finished. Command not allowed: %s', $type),
                );
                $this->recordMetric(
                    $metricsRecorder,
                    $metricsInspector,
                    [
                        'transport' => 'websocket',
                        'command.type' => $type,
                        'gameId' => $game->id(),
                        'snapshot_load_ms' => $snapshotLoadMs,
                        'normalize_ms' => $normalizeMs,
                        'command_apply_ms' => $commandApplyMs,
                        'persist_ms' => $persistMs,
                        'projection_ms' => $projectionMs,
                        'patch_build_ms' => $patchMs,
                        'total_server_ms' => $this->elapsedMs($startedAt),
                        'snapshot_bytes_before' => $snapshotBytesBefore,
                        'snapshot_bytes_after' => $snapshotBytesAfter,
                        'patch_bytes' => $patchBytes,
                        'number_of_players' => $numberOfPlayers,
                        'number_of_instances' => $numberOfInstances,
                        'number_of_visible_cards' => $numberOfVisibleCards,
                        'resync_required' => false,
                        'clientActionId_duplicate' => false,
                        'status' => $status,
                    ],
                    $usageStartedAt,
                );

                return $message;
            }

            $existingEvent = $manager->getRepository(GameEvent::class)->findOneBy([
                'game' => $game,
                'clientActionId' => $clientActionId,
            ]);
            if ($existingEvent instanceof GameEvent) {
                $manager->rollback();
                $duplicate = true;
                $status = 'duplicate';
                $message = $this->messages->duplicateCommand($game->id(), $messageId, $clientActionId, $currentVersion);
                $this->recordMetric(
                    $metricsRecorder,
                    $metricsInspector,
                    [
                        'transport' => 'websocket',
                        'command.type' => $type,
                        'gameId' => $game->id(),
                        'snapshot_load_ms' => $snapshotLoadMs,
                        'normalize_ms' => $normalizeMs,
                        'command_apply_ms' => $commandApplyMs,
                        'persist_ms' => $persistMs,
                        'projection_ms' => $projectionMs,
                        'patch_build_ms' => $patchMs,
                        'total_server_ms' => $this->elapsedMs($startedAt),
                        'snapshot_bytes_before' => $snapshotBytesBefore,
                        'snapshot_bytes_after' => $snapshotBytesAfter,
                        'patch_bytes' => $patchBytes,
                        'number_of_players' => $numberOfPlayers,
                        'number_of_instances' => $numberOfInstances,
                        'number_of_visible_cards' => $numberOfVisibleCards,
                        'resync_required' => false,
                        'clientActionId_duplicate' => $duplicate,
                        'status' => $status,
                    ],
                    $usageStartedAt,
                );

                return $message;
            }

            if ($baseVersion !== $currentVersion) {
                $manager->rollback();
                $delta = max(0, $currentVersion - $baseVersion);
                $classification = $delta === 1 ? 'concurrent_write' : 'stale_client';
                $resyncRequired = true;
                $status = 'resync_required';
                $message = $this->messages->resyncRequiredCommand(
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
                $this->recordMetric(
                    $metricsRecorder,
                    $metricsInspector,
                    [
                        'transport' => 'websocket',
                        'command.type' => $type,
                        'gameId' => $game->id(),
                        'snapshot_load_ms' => $snapshotLoadMs,
                        'normalize_ms' => $normalizeMs,
                        'command_apply_ms' => $commandApplyMs,
                        'persist_ms' => $persistMs,
                        'projection_ms' => $projectionMs,
                        'patch_build_ms' => $patchMs,
                        'total_server_ms' => $this->elapsedMs($startedAt),
                        'snapshot_bytes_before' => $snapshotBytesBefore,
                        'snapshot_bytes_after' => $snapshotBytesAfter,
                        'patch_bytes' => $patchBytes,
                        'number_of_players' => $numberOfPlayers,
                        'number_of_instances' => $numberOfInstances,
                        'number_of_visible_cards' => $numberOfVisibleCards,
                        'resync_required' => $resyncRequired,
                        'clientActionId_duplicate' => $duplicate,
                        'status' => $status,
                    ],
                    $usageStartedAt,
                );

                return $message;
            }

            $previousSnapshot = $game->snapshot();
            $phaseTimings['load'] = $snapshotLoadMs;
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
                $handlerMetrics = $this->commands->consumeLastCommandMetrics() ?? [];
                $normalizeMs = (float) ($handlerMetrics['normalize_ms'] ?? 0.0);
                $commandApplyMs = (float) ($handlerMetrics['command_apply_ms'] ?? 0.0);
                $snapshotBytesAfter = (int) ($handlerMetrics['snapshot_bytes_after'] ?? $snapshotBytesBefore);
                $numberOfPlayers = (int) ($handlerMetrics['number_of_players'] ?? $numberOfPlayers);
                $numberOfInstances = (int) ($handlerMetrics['number_of_instances'] ?? $numberOfInstances);
                $message = $this->messages->rejectedCommand(
                    $game->id(),
                    $messageId,
                    $clientActionId,
                    $currentVersion,
                    'COMMAND_REJECTED',
                    $exception->getMessage(),
                );
                $this->recordMetric(
                    $metricsRecorder,
                    $metricsInspector,
                    [
                        'transport' => 'websocket',
                        'command.type' => $type,
                        'gameId' => $game->id(),
                        'snapshot_load_ms' => $snapshotLoadMs,
                        'normalize_ms' => $normalizeMs,
                        'command_apply_ms' => $commandApplyMs,
                        'persist_ms' => $persistMs,
                        'projection_ms' => $projectionMs,
                        'patch_build_ms' => $patchMs,
                        'total_server_ms' => $this->elapsedMs($startedAt),
                        'snapshot_bytes_before' => $snapshotBytesBefore,
                        'snapshot_bytes_after' => $snapshotBytesAfter,
                        'patch_bytes' => $patchBytes,
                        'number_of_players' => $numberOfPlayers,
                        'number_of_instances' => $numberOfInstances,
                        'number_of_visible_cards' => $numberOfVisibleCards,
                        'resync_required' => false,
                        'clientActionId_duplicate' => false,
                        'status' => $status,
                    ],
                    $usageStartedAt,
                );

                return $message;
            }
            $phaseTimings['apply'] = $this->elapsedMs($applyStartedAt);
            $handlerMetrics = $this->commands->consumeLastCommandMetrics() ?? [];
            $normalizeMs = (float) ($handlerMetrics['normalize_ms'] ?? 0.0);
            $commandApplyMs = (float) ($handlerMetrics['command_apply_ms'] ?? $phaseTimings['apply']);
            $snapshotBytesAfter = (int) ($handlerMetrics['snapshot_bytes_after'] ?? $metricsInspector->jsonBytes($game->snapshot()));
            $numberOfPlayers = (int) ($handlerMetrics['number_of_players'] ?? $numberOfPlayers);
            $numberOfInstances = (int) ($handlerMetrics['number_of_instances'] ?? $numberOfInstances);

            $persistStartedAt = microtime(true);
            $manager->persist($event);
            $manager->flush();
            $manager->commit();
            $phaseTimings['persist'] = $this->elapsedMs($persistStartedAt);
            $persistMs = $phaseTimings['persist'];

            $projected = $this->projectedResult(
                $game,
                $previousSnapshot,
                $game->snapshot(),
                $event,
                $this->eventPayload($type, $payload),
                $phaseTimings,
                $startedAt,
                $responseProtocol,
            );
            $projectionMs = (float) ($projected['projection_ms'] ?? 0.0);
            $patchMs = (float) ($projected['patch_ms'] ?? 0.0);
            $patchBytes = (int) ($projected['patch_bytes'] ?? 0);
            $numberOfVisibleCards = (int) ($projected['number_of_visible_cards'] ?? 0);
            $resyncRequired = (bool) ($projected['resync_required'] ?? false);
            $status = $resyncRequired ? 'resync_required' : 'applied';
            $this->recordMetric(
                $metricsRecorder,
                $metricsInspector,
                [
                    'transport' => 'websocket',
                    'command.type' => $type,
                    'gameId' => $game->id(),
                    'snapshot_load_ms' => $snapshotLoadMs,
                    'normalize_ms' => $normalizeMs,
                    'command_apply_ms' => $commandApplyMs,
                    'persist_ms' => $persistMs,
                    'projection_ms' => $projectionMs,
                    'patch_build_ms' => $patchMs,
                    'total_server_ms' => $this->elapsedMs($startedAt),
                    'snapshot_bytes_before' => $snapshotBytesBefore,
                    'snapshot_bytes_after' => $snapshotBytesAfter,
                    'patch_bytes' => $patchBytes,
                    'number_of_players' => $numberOfPlayers,
                    'number_of_instances' => $numberOfInstances,
                    'number_of_visible_cards' => $numberOfVisibleCards,
                    'resync_required' => $resyncRequired,
                    'clientActionId_duplicate' => $duplicate,
                    'status' => $status,
                ],
                $usageStartedAt,
            );

            return $projected['result'];
        } catch (UniqueConstraintViolationException) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }
            $resyncRequired = true;
            $status = 'conflict';
            $message = $this->messages->resyncRequiredCommand(
                $gameId,
                $messageId,
                $clientActionId,
                $baseVersion,
                'COMMAND_CONFLICT',
                'Command conflict. Please resync.',
            );
            $this->recordMetric(
                $metricsRecorder,
                $metricsInspector,
                [
                    'transport' => 'websocket',
                    'command.type' => $type,
                    'gameId' => $gameId,
                    'snapshot_load_ms' => $snapshotLoadMs,
                    'normalize_ms' => $normalizeMs,
                    'command_apply_ms' => $commandApplyMs,
                    'persist_ms' => $persistMs,
                    'projection_ms' => $projectionMs,
                    'patch_build_ms' => $patchMs,
                    'total_server_ms' => $this->elapsedMs($startedAt),
                    'snapshot_bytes_before' => $snapshotBytesBefore,
                    'snapshot_bytes_after' => $snapshotBytesAfter,
                    'patch_bytes' => $patchBytes,
                    'number_of_players' => $numberOfPlayers,
                    'number_of_instances' => $numberOfInstances,
                    'number_of_visible_cards' => $numberOfVisibleCards,
                    'resync_required' => $resyncRequired,
                    'clientActionId_duplicate' => $duplicate,
                    'status' => $status,
                ],
                $usageStartedAt,
            );

            return $message;
        } catch (DeadlockException|LockWaitTimeoutException) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }
            $resyncRequired = true;
            $status = 'conflict';
            $message = $this->messages->resyncRequiredCommand(
                $gameId,
                $messageId,
                $clientActionId,
                $baseVersion,
                'COMMAND_CONFLICT',
                'Game command conflict. Please resync.',
            );
            $this->recordMetric(
                $metricsRecorder,
                $metricsInspector,
                [
                    'transport' => 'websocket',
                    'command.type' => $type,
                    'gameId' => $gameId,
                    'snapshot_load_ms' => $snapshotLoadMs,
                    'normalize_ms' => $normalizeMs,
                    'command_apply_ms' => $commandApplyMs,
                    'persist_ms' => $persistMs,
                    'projection_ms' => $projectionMs,
                    'patch_build_ms' => $patchMs,
                    'total_server_ms' => $this->elapsedMs($startedAt),
                    'snapshot_bytes_before' => $snapshotBytesBefore,
                    'snapshot_bytes_after' => $snapshotBytesAfter,
                    'patch_bytes' => $patchBytes,
                    'number_of_players' => $numberOfPlayers,
                    'number_of_instances' => $numberOfInstances,
                    'number_of_visible_cards' => $numberOfVisibleCards,
                    'resync_required' => $resyncRequired,
                    'clientActionId_duplicate' => $duplicate,
                    'status' => $status,
                ],
                $usageStartedAt,
            );

            return $message;
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
        $snapshot = $this->commands->normalizeSnapshot($game->snapshot());
        foreach (($snapshot['players'][$playerId]['zones'][$zone] ?? []) as $card) {
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
        string $responseProtocol = 'legacy',
    ): array
    {
        $metricsInspector = $this->metricsInspector();
        $previousSnapshot = $this->commands->normalizeSnapshot($previousSnapshot);
        $nextSnapshot = $this->commands->normalizeSnapshot($nextSnapshot);
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
        $patchBytes = 0;
        $numberOfVisibleCards = 0;
        $resyncRequired = false;
        foreach ($viewers as $viewer) {
            $viewerProjectionStartedAt = microtime(true);
            $viewerCanUseOwnHiddenZones = $viewerCanUseOwnHiddenZonesByUserId[$viewer->id()] ?? true;
            $previousProjection = $this->projection->projectSnapshot($previousSnapshot, $viewer, $viewerCanUseOwnHiddenZones, $localizedLookup, $previousRulingsLookup);
            $nextProjection = $this->projection->projectSnapshot($nextSnapshot, $viewer, $viewerCanUseOwnHiddenZones, $localizedLookup, $nextRulingsLookup);
            $numberOfVisibleCards += $metricsInspector->countVisibleCards($nextProjection);
            $projectionMs += $this->elapsedMs($viewerProjectionStartedAt);
            $patchStartedAt = microtime(true);
            $messagesByUserId[$viewer->id()] = $this->patches->build($game->id(), $previousProjection, $nextProjection, $event, $eventPayload, $viewer->id());
            if ($responseProtocol === 'v2') {
                $messagesByUserId[$viewer->id()] = $this->translateMessagesToV2(
                    $messagesByUserId[$viewer->id()],
                    $game->id(),
                    $this->snapshotVersion($game),
                    $event->clientActionId(),
                    $viewer->id(),
                );
            }
            $patchMs += $this->elapsedMs($patchStartedAt);
            $patchBytes += $metricsInspector->patchBytesForMessages($messagesByUserId[$viewer->id()]);
            $messageList = array_is_list($messagesByUserId[$viewer->id()])
                ? $messagesByUserId[$viewer->id()]
                : [$messagesByUserId[$viewer->id()]];
            foreach ($messageList as $message) {
                if (($message['kind'] ?? null) === 'resync_required') {
                    $resyncRequired = true;
                }
            }
        }
        $phaseTimings['projection'] = round($projectionMs, 2);
        $phaseTimings['patch'] = round($patchMs, 2);
        $phaseTimings['total'] = $this->elapsedMs($startedAt);

        return [
            'result' => GameWebsocketCommandResult::forViewers(
                $messagesByUserId,
                $this->messages->resyncRequired($game->id(), $this->snapshotVersion($game), 'projection_unavailable', $event->clientActionId()),
                $this->normalizeDebugProfile($phaseTimings),
            ),
            'projection_ms' => $phaseTimings['projection'],
            'patch_ms' => $phaseTimings['patch'],
            'patch_bytes' => $patchBytes,
            'number_of_visible_cards' => $numberOfVisibleCards,
            'resync_required' => $resyncRequired,
        ];
    }

    /**
     * @param array<string,mixed>|list<array<string,mixed>> $messages
     * @return array<string,mixed>|list<array<string,mixed>>
     */
    private function translateMessagesToV2(
        array $messages,
        string $gameId,
        int $version,
        ?string $ackClientActionId,
        string $viewerId,
    ): array {
        if (!($this->flagsV2?->patchEnabled() ?? false) || !$this->contractsV2 instanceof GameplayV2ContractFactory) {
            return $messages;
        }

        $messageList = array_is_list($messages) ? $messages : [$messages];
        $translated = array_map(function (array $message) use ($gameId, $version, $ackClientActionId, $viewerId): array {
            if (($message['kind'] ?? null) !== 'game_patch' || !is_array($message['operations'] ?? null)) {
                return $message;
            }

            $patch = $this->contractsV2->patchForViewer(
                $gameId,
                $version,
                $viewerId,
                array_values($message['operations']),
                $ackClientActionId,
            );

            return [
                'kind' => 'patch.v2',
                ...$patch->toArray(),
            ];
        }, $messageList);

        return array_is_list($messages) ? $translated : $translated[0];
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

    private function metricsRecorder(): GameplayMetricsRecorderInterface
    {
        return $this->metricsRecorder ?? new GameplayNullMetricsRecorder();
    }

    private function metricsInspector(): GameplayMetricsInspector
    {
        return $this->metricsInspector ?? new GameplayMetricsInspector();
    }

    /**
     * @param array<string,mixed> $metric
     * @param array<string,int>|null $usageStartedAt
     */
    private function recordMetric(
        GameplayMetricsRecorderInterface $metricsRecorder,
        GameplayMetricsInspector $metricsInspector,
        array $metric,
        ?array $usageStartedAt,
    ): void {
        $metricsRecorder->record([
            ...$metric,
            'memory_peak_bytes' => $metricsInspector->memoryPeakBytes(),
            ...$metricsInspector->cpuDiffMs($usageStartedAt),
        ]);
    }
}
