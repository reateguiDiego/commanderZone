<?php

namespace App\Application\Game\WebSocket;

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameActivityStreamService;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameEventStoreV2;
use App\Application\Game\GameplayStreamsFlags;
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
    private const VISUAL_POSITION_COMMANDS = ['card.position.changed', 'cards.position.changed'];
    private const VISUAL_POSITION_RATE_WINDOW_MS = 1_000;
    private const VISUAL_POSITION_RATE_LIMIT = 24;

    /**
     * @var \ArrayObject<string,list<float>>
     */
    private \ArrayObject $visualCommandBackpressure;

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
        private ?GameEventStoreV2 $eventStoreV2 = null,
        private ?GameActivityStreamService $activityStreams = null,
        private ?GameplayStreamsFlags $streamFlags = null,
    ) {
        $this->visualCommandBackpressure = new \ArrayObject();
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
        $previousLogEntries = [];

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
            if ($game instanceof Game && $this->shouldHydrateEventStore()) {
                $this->eventStoreV2?->hydrateGame($game);
            }
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

            if ($this->streamsEnabled() && in_array($type, ['chat.message', 'chat.reaction.toggled'], true)) {
                return $this->applyStreamChatCommand(
                    $manager,
                    $game,
                    $actor,
                    $type,
                    $payload,
                    $clientActionId,
                    $baseVersion,
                    $messageId,
                    $responseProtocol,
                    $phaseTimings,
                    $startedAt,
                    $snapshotLoadMs,
                    $snapshotBytesBefore,
                    $snapshotBytesAfter,
                    $numberOfPlayers,
                    $numberOfInstances,
                    $metricsRecorder,
                    $metricsInspector,
                    $usageStartedAt,
                );
            }

            $visualBackpressure = $this->visualCommandBackpressure($game->id(), $actor->id(), $type);
            if (($visualBackpressure['accepted'] ?? true) !== true) {
                $message = $this->messages->rejectedCommand(
                    $game->id(),
                    $messageId,
                    $clientActionId,
                    $this->snapshotVersion($game),
                    'VISUAL_COMMAND_RATE_LIMITED',
                    'Position updates are temporarily rate limited.',
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
                        'status' => 'visual_backpressure',
                        'coalesced_position_events' => $this->coalescedPositionEvents($type, $payload),
                        'dropped_ephemeral_events' => 0,
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

            if ($this->streamsEnabled() && $this->activityStreams instanceof GameActivityStreamService) {
                $previousLogEntries = $this->activityStreams->logEntries($game);
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
            $directPatchPayload = $this->commands->consumeLastDirectPatchPayload();
            $normalizeMs = (float) ($handlerMetrics['normalize_ms'] ?? 0.0);
            $commandApplyMs = (float) ($handlerMetrics['command_apply_ms'] ?? $phaseTimings['apply']);
            $snapshotBytesAfter = (int) ($handlerMetrics['snapshot_bytes_after'] ?? $metricsInspector->jsonBytes($game->snapshot()));
            $numberOfPlayers = (int) ($handlerMetrics['number_of_players'] ?? $numberOfPlayers);
            $numberOfInstances = (int) ($handlerMetrics['number_of_instances'] ?? $numberOfInstances);

            $persistStartedAt = microtime(true);
            $manager->persist($event);
            $appendedLogEntries = [];
            if ($this->streamsEnabled() && $this->activityStreams instanceof GameActivityStreamService) {
                $appendedLogEntries = $this->commands->consumePendingStreamLogEntries();
                $this->activityStreams->appendLogEntries(
                    $manager,
                    $game,
                    max(1, (int) ($game->snapshot()['version'] ?? 1)),
                    $appendedLogEntries,
                );
            }
            if ($game instanceof Game && $this->shouldHydrateEventStore()) {
                $this->eventStoreV2?->persistCompactSnapshotIfDue($manager, $game, $game->snapshot());
            }
            $manager->flush();
            $manager->commit();
            $phaseTimings['persist'] = $this->elapsedMs($persistStartedAt);
            $persistMs = $phaseTimings['persist'];

            $projected = is_array($directPatchPayload)
                ? $this->directPatchedResult(
                    $game,
                    $previousSnapshot,
                    $event,
                    $directPatchPayload,
                    $phaseTimings,
                    $startedAt,
                    $responseProtocol,
                )
                : $this->projectedResult(
                    $game,
                    $previousSnapshot,
                    $game->snapshot(),
                    $event,
                    $this->eventPayload($type, $payload),
                    $phaseTimings,
                    $startedAt,
                    $responseProtocol,
                    $appendedLogEntries,
                    $previousLogEntries,
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
                    'coalesced_position_events' => $this->coalescedPositionEvents($type, $payload),
                    'dropped_ephemeral_events' => 0,
                    'shadow_compare_enabled' => (bool) ($handlerMetrics['shadow_compare_enabled'] ?? false),
                    'shadow_compare_ms' => (float) ($handlerMetrics['shadow_compare_ms'] ?? 0.0),
                    'shadow_diverged' => (bool) ($handlerMetrics['shadow_diverged'] ?? false),
                    'shadow_divergence_count' => (int) ($handlerMetrics['shadow_divergence_count'] ?? 0),
                    'divergence_count' => (int) ($handlerMetrics['divergence_count'] ?? 0),
                    'shadow_fallback_count' => (int) ($handlerMetrics['shadow_fallback_count'] ?? 0),
                    'fallback_count' => (int) ($handlerMetrics['fallback_count'] ?? 0),
                    'shadow_runtime_error_count' => (int) ($handlerMetrics['shadow_runtime_error_count'] ?? 0),
                    'runtime_error_count' => (int) ($handlerMetrics['runtime_error_count'] ?? 0),
                    'shadow_patch_size_bytes' => (int) ($handlerMetrics['shadow_patch_size_bytes'] ?? 0),
                    'runtime_service_enabled' => (bool) ($this->flagsV2?->runtimeServiceEnabled() ?? false),
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
     * @param array<string,float> $phaseTimings
     * @param array<string,int>|null $usageStartedAt
     */
    private function applyStreamChatCommand(
        EntityManagerInterface $manager,
        Game $game,
        User $actor,
        string $type,
        array $payload,
        string $clientActionId,
        int $baseVersion,
        ?string $messageId,
        string $responseProtocol,
        array $phaseTimings,
        float $startedAt,
        float $snapshotLoadMs,
        int $snapshotBytesBefore,
        int $snapshotBytesAfter,
        int $numberOfPlayers,
        int $numberOfInstances,
        GameplayMetricsRecorderInterface $metricsRecorder,
        GameplayMetricsInspector $metricsInspector,
        ?array $usageStartedAt,
    ): array|GameWebsocketCommandResult {
        \assert($this->activityStreams instanceof GameActivityStreamService);

        $currentVersion = $this->snapshotVersion($game);
        $persistStartedAt = microtime(true);
        $manager->beginTransaction();
        try {
            if ($type === 'chat.message') {
                $message = trim((string) ($payload['message'] ?? ''));
                if ($message === '') {
                    throw new \InvalidArgumentException('Message is required.');
                }
                $targetPlayerId = $this->streamChatTargetPlayerId($game->snapshot(), $payload, $actor);
                $targetDisplayName = $targetPlayerId !== null ? $this->playerName($game->snapshot(), $targetPlayerId) : null;
                $record = $this->activityStreams->appendChatMessage(
                    $manager,
                    $game,
                    $actor,
                    $message,
                    $targetPlayerId,
                    $targetDisplayName,
                );
                $event = new GameEvent($game, 'chat.message', [
                    'private' => $targetPlayerId !== null,
                ], $actor, $clientActionId, $currentVersion);
                $chatMessage = $record->toArray();
                $messagesByUserId = [];
                foreach ($this->viewers($game) as $viewer) {
                    $ops = $this->streamChatVisibleToViewer($chatMessage, $viewer->id())
                        ? [[
                            'op' => 'chat.message.add',
                            'message' => $chatMessage,
                        ]]
                        : [];
                    $messagesByUserId[$viewer->id()] = $this->streamChatPatchMessage(
                        $game,
                        $event,
                        $ops,
                        $baseVersion,
                        $currentVersion,
                        $responseProtocol,
                        $viewer->id(),
                    );
                }
            } else {
                $record = $this->activityStreams->toggleReaction(
                    $manager,
                    $game,
                    $actor,
                    trim((string) ($payload['messageId'] ?? '')),
                    trim((string) ($payload['reaction'] ?? '')),
                );
                $event = new GameEvent($game, 'chat.reaction.toggled', [
                    'messageId' => $record->messageId(),
                    'reaction' => trim((string) ($payload['reaction'] ?? '')),
                ], $actor, $clientActionId, $currentVersion);
                $chatMessage = $record->toArray();
                $messagesByUserId = [];
                foreach ($this->viewers($game) as $viewer) {
                    $ops = $this->streamChatVisibleToViewer($chatMessage, $viewer->id())
                        ? [[
                            'op' => 'chat.reaction.set',
                            'messageId' => $record->messageId(),
                            'reactions' => $chatMessage['reactions'] ?? [],
                            'message' => $chatMessage,
                        ]]
                        : [];
                    $messagesByUserId[$viewer->id()] = $this->streamChatPatchMessage(
                        $game,
                        $event,
                        $ops,
                        $baseVersion,
                        $currentVersion,
                        $responseProtocol,
                        $viewer->id(),
                    );
                }
            }

            $manager->flush();
            $manager->commit();
        } catch (\InvalidArgumentException $exception) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }
            $this->recordMetric(
                $metricsRecorder,
                $metricsInspector,
                [
                    'transport' => 'websocket',
                    'command.type' => $type,
                    'gameId' => $game->id(),
                    'snapshot_load_ms' => $snapshotLoadMs,
                    'normalize_ms' => 0.0,
                    'command_apply_ms' => 0.0,
                    'persist_ms' => 0.0,
                    'projection_ms' => 0.0,
                    'patch_build_ms' => 0.0,
                    'total_server_ms' => $this->elapsedMs($startedAt),
                    'snapshot_bytes_before' => $snapshotBytesBefore,
                    'snapshot_bytes_after' => $snapshotBytesAfter,
                    'patch_bytes' => 0,
                    'number_of_players' => $numberOfPlayers,
                    'number_of_instances' => $numberOfInstances,
                    'number_of_visible_cards' => 0,
                    'resync_required' => false,
                    'clientActionId_duplicate' => false,
                    'status' => 'rejected',
                ],
                $usageStartedAt,
            );

            return $this->messages->rejectedCommand(
                $game->id(),
                $messageId,
                $clientActionId,
                $currentVersion,
                'COMMAND_REJECTED',
                $exception->getMessage(),
            );
        } catch (\Throwable $exception) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }

            throw $exception;
        }

        $persistMs = $this->elapsedMs($persistStartedAt);
        $phaseTimings['persist'] = $persistMs;
        $phaseTimings['projection'] = 0.0;
        $phaseTimings['patch'] = 0.0;
        $phaseTimings['total'] = $this->elapsedMs($startedAt);
        $patchBytes = 0;
        foreach ($messagesByUserId as $messages) {
            $patchBytes += $metricsInspector->patchBytesForMessages($messages);
        }
        $this->recordMetric(
            $metricsRecorder,
            $metricsInspector,
            [
                'transport' => 'websocket',
                'command.type' => $type,
                'gameId' => $game->id(),
                'snapshot_load_ms' => $snapshotLoadMs,
                'normalize_ms' => 0.0,
                'command_apply_ms' => 0.0,
                'persist_ms' => $persistMs,
                'projection_ms' => 0.0,
                'patch_build_ms' => 0.0,
                'total_server_ms' => $this->elapsedMs($startedAt),
                'snapshot_bytes_before' => $snapshotBytesBefore,
                'snapshot_bytes_after' => $snapshotBytesAfter,
                'patch_bytes' => $patchBytes,
                'number_of_players' => $numberOfPlayers,
                'number_of_instances' => $numberOfInstances,
                'number_of_visible_cards' => 0,
                'resync_required' => false,
                'clientActionId_duplicate' => false,
                'status' => 'applied',
            ],
            $usageStartedAt,
        );

        return GameWebsocketCommandResult::forViewerMessageLists(
            $messagesByUserId,
            [[
                'kind' => 'command_ack',
                'gameId' => $game->id(),
                'clientActionId' => $clientActionId,
                'status' => 'duplicate',
                'version' => $currentVersion,
            ]],
            $this->normalizeDebugProfile($phaseTimings),
        );
    }

    private function shouldHydrateEventStore(): bool
    {
        return ($this->flagsV2?->eventEnabled() ?? false) && $this->eventStoreV2?->enabled() === true;
    }

    private function streamsEnabled(): bool
    {
        return ($this->streamFlags?->enabled() ?? false) && $this->activityStreams instanceof GameActivityStreamService;
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $payload
     */
    private function streamChatTargetPlayerId(array $snapshot, array $payload, User $actor): ?string
    {
        $targetPlayerId = $payload['targetPlayerId'] ?? null;
        if ($targetPlayerId === null || $targetPlayerId === '' || $targetPlayerId === 'all') {
            return null;
        }
        if (!is_string($targetPlayerId) || !isset($snapshot['players'][$targetPlayerId])) {
            throw new \InvalidArgumentException('Chat target player not found.');
        }
        if ($targetPlayerId === $actor->id()) {
            throw new \InvalidArgumentException('Private chat target must be another player.');
        }

        return $targetPlayerId;
    }

    /**
     * @param array<string,mixed> $message
     */
    private function streamChatVisibleToViewer(array $message, string $viewerId): bool
    {
        $targetPlayerId = $message['targetPlayerId'] ?? null;
        if (!is_string($targetPlayerId) || $targetPlayerId === '') {
            return true;
        }

        return $targetPlayerId === $viewerId || ($message['userId'] ?? null) === $viewerId;
    }

    /**
     * @param list<array<string,mixed>> $ops
     *
     * @return list<array<string,mixed>>
     */
    private function streamChatPatchMessage(
        Game $game,
        GameEvent $event,
        array $ops,
        int $baseVersion,
        int $currentVersion,
        string $responseProtocol,
        string $viewerId,
    ): array {
        if ($responseProtocol === 'v2'
            && ($this->flagsV2?->patchEnabled() ?? false)
            && $this->contractsV2 instanceof GameplayV2ContractFactory) {
            return [[
                'kind' => 'patch.v2',
                ...$this->contractsV2->patchForViewer(
                    $game->id(),
                    $currentVersion,
                    $viewerId,
                    $ops,
                    $event->clientActionId(),
                )->toArray(),
            ]];
        }

        return [$this->messages->gamePatch(
            $game->id(),
            $baseVersion,
            $currentVersion,
            $ops,
            $event,
            $event->toArray()['payload'] ?? null,
        )];
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private function playerName(array $snapshot, string $playerId): string
    {
        $player = $snapshot['players'][$playerId] ?? null;
        $user = is_array($player['user'] ?? null) ? $player['user'] : [];
        $displayName = trim((string) ($user['displayName'] ?? ''));

        return $displayName !== '' ? $displayName : $playerId;
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

        if ($this->commands->usesV2CommandRouting($type)) {
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
        array $appendedLogEntries = [],
        array $previousLogEntries = [],
    ): array
    {
        $metricsInspector = $this->metricsInspector();
        if ($this->streamsEnabled()) {
            $previousSnapshot['eventLog'] = $previousLogEntries;
            $nextSnapshot['eventLog'] = array_values(array_slice([
                ...$previousLogEntries,
                ...$appendedLogEntries,
            ], -250));
        }
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
     * @param array<string,mixed> $directPatchPayload
     * @param array<string,float> $phaseTimings
     */
    private function directPatchedResult(
        Game $game,
        array $previousSnapshot,
        GameEvent $event,
        array $directPatchPayload,
        array $phaseTimings,
        float $startedAt,
        string $responseProtocol = 'legacy',
    ): array {
        $metricsInspector = $this->metricsInspector();
        $messagesByUserId = [];
        $patchStartedAt = microtime(true);
        $baseVersion = max(1, (int) ($previousSnapshot['version'] ?? 1));
        $version = max(1, (int) ($directPatchPayload['version'] ?? $this->snapshotVersion($game)));
        $ackClientActionId = is_string($directPatchPayload['ackClientActionId'] ?? null)
            ? $directPatchPayload['ackClientActionId']
            : $event->clientActionId();
        $currentSnapshot = $game->snapshot();
        foreach ($this->viewers($game) as $viewer) {
            $viewerPayload = $this->directPayloadForViewer($currentSnapshot, $viewer->id(), $directPatchPayload);
            $eventPayload = $viewerPayload['eventPayload'];
            $operations = $viewerPayload['operations'];
            $appendEventLog = $viewerPayload['appendEventLog'];
            $sanitizeEventLog = $viewerPayload['sanitizeEventLog'];
            $eventLogEntries = $viewerPayload['eventLogEntries'];
            if ($sanitizeEventLog && $eventLogEntries !== []) {
                $eventLogEntries = array_values(array_map([$this, 'sanitizePrivateCardLogEntry'], $eventLogEntries));
            }
            if ($appendEventLog && $eventLogEntries !== []) {
                $operations[] = [
                    'op' => 'eventLog.append',
                    'entries' => $eventLogEntries,
                ];
            }
            if ($responseProtocol === 'v2'
                && ($this->flagsV2?->patchEnabled() ?? false)
                && $this->contractsV2 instanceof GameplayV2ContractFactory) {
                $messagesByUserId[$viewer->id()] = [[
                    'kind' => 'patch.v2',
                    ...$this->contractsV2->patchForVisibility(
                        $game->id(),
                        $version,
                        sprintf('player:%s', $viewer->id()),
                        $operations,
                        $ackClientActionId,
                    )->toArray(),
                ]];
                continue;
            }

            $messagesByUserId[$viewer->id()] = $this->messages->gamePatch(
                $game->id(),
                $baseVersion,
                $version,
                $this->translateSemanticOperationsToLegacy($operations),
                $event,
                $eventPayload,
            );
        }
        $patchMs = $this->elapsedMs($patchStartedAt);
        $patchBytes = 0;
        foreach ($messagesByUserId as $message) {
            $patchBytes += $metricsInspector->patchBytesForMessages($message);
        }

        $phaseTimings['projection'] = 0.0;
        $phaseTimings['patch'] = round($patchMs, 2);
        $phaseTimings['total'] = $this->elapsedMs($startedAt);

        return [
            'result' => GameWebsocketCommandResult::forViewers(
                $messagesByUserId,
                $this->messages->resyncRequired($game->id(), $version, 'projection_unavailable', $event->clientActionId()),
                $this->normalizeDebugProfile($phaseTimings),
            ),
            'projection_ms' => 0.0,
            'patch_ms' => $phaseTimings['patch'],
            'patch_bytes' => $patchBytes,
            'number_of_visible_cards' => 0,
            'resync_required' => false,
        ];
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $directPatchPayload
     *
     * @return array{
     *   eventPayload: array<string,mixed>,
     *   operations: list<array<string,mixed>>,
     *   appendEventLog: bool,
     *   sanitizeEventLog: bool,
     *   eventLogEntries: list<array<string,mixed>>
     * }
     */
    private function directPayloadForViewer(array $snapshot, string $viewerId, array $directPatchPayload): array
    {
        $viewerMask = $this->viewerMask($snapshot, $viewerId);
        $viewerPayload = is_array($directPatchPayload['viewerPayloads'][$viewerId] ?? null)
            ? $directPatchPayload['viewerPayloads'][$viewerId]
            : [];

        $operations = is_array($directPatchPayload['operations'] ?? null)
            ? array_values($directPatchPayload['operations'])
            : [];
        $groupPayloads = is_array($directPatchPayload['groupPayloads'] ?? null)
            ? $directPatchPayload['groupPayloads']
            : [];
        foreach ($groupPayloads as $groupKey => $groupPayload) {
            if (!is_string($groupKey) || !str_starts_with($groupKey, 'group:') || !is_array($groupPayload)) {
                continue;
            }

            $groupMask = (int) substr($groupKey, strlen('group:'));
            if ($groupMask <= 0 || (($groupMask & $viewerMask) === 0)) {
                continue;
            }

            if (is_array($groupPayload['operations'] ?? null)) {
                $operations = [...$operations, ...array_values($groupPayload['operations'])];
            }
        }

        if (is_array($viewerPayload['operations'] ?? null)) {
            $operations = [...$operations, ...array_values($viewerPayload['operations'])];
        }

        return [
            'eventPayload' => is_array($viewerPayload['eventPayload'] ?? null)
                ? $viewerPayload['eventPayload']
                : (is_array($directPatchPayload['eventPayload'] ?? null) ? $directPatchPayload['eventPayload'] : []),
            'operations' => $operations,
            'appendEventLog' => array_key_exists('appendEventLog', $viewerPayload)
                ? (bool) $viewerPayload['appendEventLog']
                : (bool) ($directPatchPayload['appendEventLog'] ?? true),
            'sanitizeEventLog' => array_key_exists('sanitizeEventLog', $viewerPayload)
                ? (bool) $viewerPayload['sanitizeEventLog']
                : (bool) ($directPatchPayload['sanitizeEventLog'] ?? false),
            'eventLogEntries' => is_array($viewerPayload['eventLogEntries'] ?? null)
                ? array_values($viewerPayload['eventLogEntries'])
                : (is_array($directPatchPayload['eventLogEntries'] ?? null) ? array_values($directPatchPayload['eventLogEntries']) : []),
        ];
    }

    private function viewerMask(array $snapshot, string $viewerId): int
    {
        $viewerBits = is_array($snapshot['visibility']['viewerBits'] ?? null)
            ? $snapshot['visibility']['viewerBits']
            : [];

        return max(0, (int) ($viewerBits[$viewerId] ?? 0));
    }

    /**
     * @param list<array<string,mixed>> $operations
     *
     * @return list<array<string,mixed>>
     */
    private function translateSemanticOperationsToLegacy(array $operations): array
    {
        $translated = [];
        $zoneCountsByPlayer = [];

        foreach ($operations as $operation) {
            $op = is_string($operation['op'] ?? null) ? $operation['op'] : '';
            switch ($op) {
                case 'player.life.set':
                case 'turn.set':
                case 'eventLog.append':
                case 'player.counters.set':
                case 'game.counters.set':
                case 'card.move':
                case 'card.remove':
                case 'card.state.set':
                case 'card.position.set':
                case 'cards.position.set':
                case 'card.stats.set':
                case 'card.counters.set':
                case 'cards.state.set':
                case 'zone.visible.set':
                case 'arrow.remove':
                case 'attachment.remove':
                    $translated[] = $operation;
                    break;

                case 'dice.result':
                    break;

                case 'card.field.set':
                    $translated = [...$translated, ...$this->legacyOperationsForCardFieldSet($operation)];
                    break;

                case 'card.counters.patch':
                    $translated[] = [
                        'op' => 'card.counters.set',
                        'playerId' => (string) ($operation['playerId'] ?? ''),
                        'zone' => (string) ($operation['zone'] ?? ''),
                        'instanceId' => (string) ($operation['instanceId'] ?? ''),
                        'counters' => is_array($operation['counters'] ?? null) ? $operation['counters'] : [],
                    ];
                    break;

                case 'zone.cards.move':
                    $translated[] = $this->legacyCardMoveOperation($operation);
                    break;

                case 'zone.cards.batchMove':
                    foreach (array_values(array_filter($operation['moves'] ?? [], static fn (mixed $move): bool => is_array($move))) as $move) {
                        $translated[] = $this->legacyCardMoveOperation($move);
                    }
                    break;

                case 'zone.cards.remove':
                    foreach (array_values(array_filter($operation['instanceIds'] ?? [], static fn (mixed $id): bool => is_string($id) && trim($id) !== '')) as $instanceId) {
                        $translated[] = [
                            'op' => 'card.remove',
                            'playerId' => (string) ($operation['playerId'] ?? ''),
                            'zone' => (string) ($operation['zone'] ?? ''),
                            'instanceId' => $instanceId,
                        ];
                    }
                    break;

                case 'zone.count.set':
                    $playerId = (string) ($operation['playerId'] ?? '');
                    $zone = (string) ($operation['zone'] ?? '');
                    if ($playerId !== '' && $zone !== '') {
                        $zoneCountsByPlayer[$playerId] ??= [];
                        $zoneCountsByPlayer[$playerId][$zone] = max(0, (int) ($operation['count'] ?? 0));
                    }
                    break;

                case 'library.top.revealed':
                    $translated[] = [
                        'op' => 'zone.visible.set',
                        'playerId' => (string) ($operation['playerId'] ?? ''),
                        'zone' => 'library',
                        'cards' => array_values(array_filter($operation['cards'] ?? [], static fn (mixed $card): bool => is_array($card))),
                    ];
                    break;

                case 'relation.remove':
                    $kind = (string) ($operation['kind'] ?? '');
                    if ($kind === 'arrow' || $kind === 'attachment') {
                        $translated[] = [
                            'op' => $kind.'.remove',
                            'id' => (string) ($operation['id'] ?? ''),
                        ];
                    }
                    break;

                default:
                    $translated[] = $operation;
                    break;
            }
        }

        foreach ($zoneCountsByPlayer as $playerId => $counts) {
            $translated[] = [
                'op' => 'zone.counts.set',
                'playerId' => $playerId,
                'counts' => $counts,
            ];
        }

        return $translated;
    }

    /**
     * @param array<string,mixed> $operation
     *
     * @return list<array<string,mixed>>
     */
    private function legacyOperationsForCardFieldSet(array $operation): array
    {
        $legacy = [];
        $identity = [
            'playerId' => (string) ($operation['playerId'] ?? ''),
            'zone' => (string) ($operation['zone'] ?? ''),
            'instanceId' => (string) ($operation['instanceId'] ?? ''),
        ];

        $state = array_intersect_key($operation, array_flip(['tapped', 'rotation', 'faceDown', 'hidden', 'revealedTo', 'counters', 'dungeonMarker']));
        if ($state !== []) {
            $legacy[] = ['op' => 'card.state.set', ...$identity, ...$state];
        }

        if (array_key_exists('position', $operation)) {
            $legacy[] = [
                'op' => 'card.position.set',
                ...$identity,
                'position' => $operation['position'],
            ];
        }

        $stats = array_intersect_key($operation, array_flip(['power', 'toughness', 'loyalty', 'defense', 'saga']));
        if ($stats !== []) {
            $legacy[] = ['op' => 'card.stats.set', ...$identity, ...$stats];
        }

        return $legacy;
    }

    /**
     * @param array<string,mixed> $move
     *
     * @return array<string,mixed>
     */
    private function legacyCardMoveOperation(array $move): array
    {
        $legacy = [
            'op' => 'card.move',
            'instanceId' => (string) ($move['instanceId'] ?? ''),
            'from' => is_array($move['from'] ?? null) ? $move['from'] : [],
            'to' => is_array($move['to'] ?? null) ? $move['to'] : [],
        ];
        if (is_array($move['card'] ?? null)) {
            $legacy['card'] = $move['card'];
        }

        return $legacy;
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
     * @param array<string,mixed> $entry
     *
     * @return array<string,mixed>
     */
    private function sanitizePrivateCardLogEntry(array $entry): array
    {
        unset($entry['cardNames'], $entry['cardInstanceId'], $entry['cardPlayerId'], $entry['cardZone']);
        $entry['message'] = 'Updated a hidden card.';

        return $entry;
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
     * @return array{accepted:bool}
     */
    private function visualCommandBackpressure(string $gameId, string $actorId, string $type): array
    {
        if (!in_array($type, self::VISUAL_POSITION_COMMANDS, true)) {
            return ['accepted' => true];
        }

        $now = microtime(true) * 1000;
        $key = $gameId.'|'.$actorId.'|'.$type;
        $windowStart = $now - self::VISUAL_POSITION_RATE_WINDOW_MS;
        $timestamps = $this->visualCommandBackpressure[$key] ?? [];
        $timestamps = array_values(array_filter(
            is_array($timestamps) ? $timestamps : [],
            static fn (mixed $timestamp): bool => is_float($timestamp) && $timestamp >= $windowStart,
        ));

        if (count($timestamps) >= self::VISUAL_POSITION_RATE_LIMIT) {
            $this->visualCommandBackpressure[$key] = $timestamps;

            return ['accepted' => false];
        }

        $timestamps[] = $now;
        $this->visualCommandBackpressure[$key] = $timestamps;

        return ['accepted' => true];
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function coalescedPositionEvents(string $type, array $payload): int
    {
        if ($type === 'cards.position.changed') {
            $positions = $payload['positions'] ?? null;

            return is_array($positions) ? max(0, count($positions) - 1) : 0;
        }

        return 0;
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
        $ioWriteBytes = max(0, (int) ($metric['snapshot_bytes_after'] ?? 0) - (int) ($metric['snapshot_bytes_before'] ?? 0));
        $ioWriteOps = ((float) ($metric['persist_ms'] ?? 0.0)) > 0.0 ? 1 : 0;
        $metricsRecorder->record([
            'position.commands_per_drag' => in_array((string) ($metric['command.type'] ?? ''), self::VISUAL_POSITION_COMMANDS, true) ? 1 : 0,
            'actor.queue_depth' => 0,
            'coalesced_position_events' => 0,
            'dropped_ephemeral_events' => 0,
            'io.write_bytes' => $ioWriteBytes,
            'io.write_ops' => $ioWriteOps,
            ...$metric,
            'memory_peak_bytes' => $metricsInspector->memoryPeakBytes(),
            ...$metricsInspector->cpuDiffMs($usageStartedAt),
        ]);
    }
}
