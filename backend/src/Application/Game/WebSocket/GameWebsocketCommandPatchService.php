<?php

namespace App\Application\Game\WebSocket;

use App\Application\Game\Compact\CardStaticBundle;
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
use App\Application\Game\Runtime\GameRuntimeGatewayException;
use App\Application\Game\Runtime\GameplayCommandCatalog;
use App\Application\Game\Runtime\GameplayRuntimeGateway;
use App\Application\Game\Runtime\GameplayRuntimePatchContractException;
use App\Application\Game\Runtime\GameplayRuntimeRoute;
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
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

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
        private ?GameplayRuntimeGateway $runtimeGateway = null,
        #[Autowire('%gameplay_emergency_legacy_fallback_enabled%')]
        private bool $emergencyLegacyFallbackEnabled = false,
        private ?LoggerInterface $logger = null,
    ) {
        $this->visualCommandBackpressure = new \ArrayObject();
    }

    /**
     * @param array<string,mixed> $payload
     * @param list<string>        $ticketPermissions
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
        ?string $ticketPlayerId = null,
        array $ticketPermissions = [],
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
        $runtimeShadowExecuted = false;
        $runtimeShadowDivergence = false;
        $runtimeShadowError = false;
        $runtimeShadowCompareMs = 0.0;
        $runtimeShadowResult = null;

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

        $runtimeFinalEmergencyFallback = false;
        $runtimeFinalResult = $this->runtimeFinalPathResult(
            $gameId,
            $userId,
            $type,
            $payload,
            $clientActionId,
            $baseVersion,
            $messageId,
            $responseProtocol,
            $ticketPlayerId,
            $ticketPermissions,
            $startedAt,
            $usageStartedAt,
            $metricsRecorder,
            $metricsInspector,
            $runtimeFinalEmergencyFallback,
        );
        if ($runtimeFinalResult !== null) {
            return $runtimeFinalResult;
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

            $runtimeCommandType = $this->runtimeCommandType($type);
            $runtimeRoute = $this->runtimeGateway?->routeFor($runtimeCommandType) ?? GameplayRuntimeRoute::LegacyOnly;
            if ($runtimeFinalEmergencyFallback) {
                $runtimeRoute = GameplayRuntimeRoute::LegacyOnly;
            }
            $runtimeLifecycleError = $runtimeRoute === GameplayRuntimeRoute::RuntimePrimary
                ? $this->runtimeLifecycleTransitionError(
                    $game,
                    $runtimeCommandType,
                    $payload,
                    $actor,
                    $this->runtimeLifecycleEvents($manager, $game, $runtimeCommandType),
                )
                : null;
            if ($runtimeLifecycleError !== null) {
                $manager->rollback();
                $message = $this->messages->rejectedCommand(
                    $game->id(),
                    $messageId,
                    $clientActionId,
                    $this->lifecycleEffectiveVersion($game, $currentVersion),
                    'INVALID_COMMAND_MESSAGE',
                    $runtimeLifecycleError,
                );
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
                        'snapshot_bytes_after' => $snapshotBytesBefore,
                        'patch_bytes' => 0,
                        'number_of_players' => $numberOfPlayers,
                        'number_of_instances' => $numberOfInstances,
                        'number_of_visible_cards' => 0,
                        'resync_required' => false,
                        'clientActionId_duplicate' => false,
                        'status' => 'invalid_runtime_lifecycle_transition',
                        'gameplay.runtime_route' => 1,
                        'gameplay.runtime_fallback_count' => 0,
                        'gameplay.runtime_error_count' => 0,
                        'gameplay.runtime_patch_contract_error' => 0,
                    ],
                    $usageStartedAt,
                );

                return $message;
            }
            if ($baseVersion !== $currentVersion && $runtimeRoute !== GameplayRuntimeRoute::RuntimePrimary) {
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

            if ($runtimeRoute === GameplayRuntimeRoute::RuntimePrimary) {
                $runtimeStartedAt = microtime(true);
                $manager->rollback();
                try {
                    $runtimeCommand = $this->runtimeCommand($game, $type, $payload, $actor);
                    $runtimeResult = $this->runtimeGateway->dispatchPrimary(
                        $runtimeCommand['type'],
                        $game->id(),
                        $actor->id(),
                        $baseVersion,
                        $clientActionId,
                        $game->snapshot(),
                        $runtimeCommand['payload'],
                    );
                    $runtimeMetrics = $this->numericRuntimeMetrics($runtimeResult->metrics);
                    $phaseTimings['load'] = $snapshotLoadMs;
                    $phaseTimings['apply'] = $this->elapsedMs($runtimeStartedAt);
                    $phaseTimings['gameplay.runtime_route'] = 1;
                    $phaseTimings['gameplay.runtime_fallback_count'] = 0;
                    $phaseTimings['gameplay.runtime_error_count'] = 0;
                    $phaseTimings['gameplay.runtime_patch_contract_error'] = 0;
                    $phaseTimings = [
                        ...$phaseTimings,
                        ...$runtimeMetrics,
                    ];
                    $this->enrichRuntimePersistedEvent(
                        $manager,
                        $game,
                        $clientActionId,
                        $runtimeCommand['type'],
                        $runtimeCommand['payload'],
                    );
                    $runtimeProjected = $this->runtimePatchedResult(
                        $game,
                        $runtimeResult->patches,
                        $currentVersion,
                        $clientActionId,
                        $runtimeCommand['type'],
                        $runtimeCommand['payload'],
                        $phaseTimings,
                        $startedAt,
                    );
                    if ($type === 'game.close') {
                        $game->finish();
                        $manager->flush();
                    }
                    $patchBytes = (int) ($runtimeProjected['patch_bytes'] ?? 0);
                    $this->recordMetric(
                        $metricsRecorder,
                        $metricsInspector,
                        [
                            'transport' => 'websocket',
                            'command.type' => $type,
                            'gameId' => $game->id(),
                            'snapshot_load_ms' => $snapshotLoadMs,
                            'normalize_ms' => 0.0,
                            'command_apply_ms' => $phaseTimings['apply'],
                            'persist_ms' => 0.0,
                            'projection_ms' => 0.0,
                            'patch_build_ms' => (float) ($runtimeProjected['patch_ms'] ?? 0.0),
                            'total_server_ms' => $this->elapsedMs($startedAt),
                            'snapshot_bytes_before' => $snapshotBytesBefore,
                            'snapshot_bytes_after' => $snapshotBytesBefore,
                            'patch_bytes' => $patchBytes,
                            'number_of_players' => $numberOfPlayers,
                            'number_of_instances' => $numberOfInstances,
                            'number_of_visible_cards' => 0,
                            'resync_required' => false,
                            'clientActionId_duplicate' => false,
                            'status' => 'runtime_applied',
                            'gameplay.runtime_route' => 1,
                            'gameplay.runtime_fallback_count' => 0,
                            'gameplay.runtime_error_count' => 0,
                            'gameplay.runtime_patch_contract_error' => 0,
                            'command.legacy_fallback_count' => 0,
                            ...$runtimeMetrics,
                        ],
                        $usageStartedAt,
                    );

                    return $runtimeProjected['result'];
                } catch (\InvalidArgumentException $exception) {
                    $message = $this->messages->rejectedCommand(
                        $game->id(),
                        $messageId,
                        $clientActionId,
                        $currentVersion,
                        'INVALID_COMMAND_MESSAGE',
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
                            'normalize_ms' => 0.0,
                            'command_apply_ms' => 0.0,
                            'persist_ms' => 0.0,
                            'projection_ms' => 0.0,
                            'patch_build_ms' => 0.0,
                            'total_server_ms' => $this->elapsedMs($startedAt),
                            'snapshot_bytes_before' => $snapshotBytesBefore,
                            'snapshot_bytes_after' => $snapshotBytesBefore,
                            'patch_bytes' => 0,
                            'number_of_players' => $numberOfPlayers,
                            'number_of_instances' => $numberOfInstances,
                            'number_of_visible_cards' => 0,
                            'resync_required' => false,
                            'clientActionId_duplicate' => false,
                            'status' => 'invalid_runtime_payload',
                            'gameplay.runtime_route' => 1,
                            'gameplay.runtime_fallback_count' => 0,
                            'gameplay.runtime_error_count' => 0,
                            'gameplay.runtime_patch_contract_error' => 0,
                        ],
                        $usageStartedAt,
                    );

                    return $message;
                } catch (GameplayRuntimePatchContractException $exception) {
                    if ($baseVersion !== $currentVersion) {
                        return $this->messages->resyncRequiredCommand(
                            $game->id(),
                            $messageId,
                            $clientActionId,
                            $currentVersion,
                            'RUNTIME_PATCH_CONTRACT_ERROR',
                            'Runtime patch contract failed after the legacy snapshot version diverged.',
                        );
                    }
                    if (!$this->emergencyLegacyFallbackEnabled) {
                        $this->recordRuntimeFailureMetric(
                            $metricsRecorder,
                            $metricsInspector,
                            $usageStartedAt,
                            $type,
                            $game->id(),
                            $snapshotLoadMs,
                            $snapshotBytesBefore,
                            $numberOfPlayers,
                            $numberOfInstances,
                            true,
                        );

                        return $this->runtimeFailureMessage($game->id(), $messageId, $clientActionId, $currentVersion, true);
                    }
                    $manager->beginTransaction();
                    $manager->lock($game, LockMode::PESSIMISTIC_WRITE);
                    $this->recordRuntimeFallbackMetric(
                        $metricsRecorder,
                        $metricsInspector,
                        $usageStartedAt,
                        $type,
                        $game->id(),
                        $snapshotLoadMs,
                        $snapshotBytesBefore,
                        $numberOfPlayers,
                        $numberOfInstances,
                        true,
                    );
                } catch (GameRuntimeGatewayException) {
                    if ($baseVersion !== $currentVersion) {
                        return $this->messages->resyncRequiredCommand(
                            $game->id(),
                            $messageId,
                            $clientActionId,
                            $currentVersion,
                            'RUNTIME_UNAVAILABLE_AFTER_VERSION_DIVERGENCE',
                            'Runtime command could not be applied and legacy fallback is unsafe after version divergence.',
                        );
                    }
                    if (!$this->emergencyLegacyFallbackEnabled) {
                        $this->recordRuntimeFailureMetric(
                            $metricsRecorder,
                            $metricsInspector,
                            $usageStartedAt,
                            $type,
                            $game->id(),
                            $snapshotLoadMs,
                            $snapshotBytesBefore,
                            $numberOfPlayers,
                            $numberOfInstances,
                            false,
                        );

                        return $this->runtimeFailureMessage($game->id(), $messageId, $clientActionId, $currentVersion, false);
                    }
                    $manager->beginTransaction();
                    $manager->lock($game, LockMode::PESSIMISTIC_WRITE);
                    $this->recordRuntimeFallbackMetric(
                        $metricsRecorder,
                        $metricsInspector,
                        $usageStartedAt,
                        $type,
                        $game->id(),
                        $snapshotLoadMs,
                        $snapshotBytesBefore,
                        $numberOfPlayers,
                        $numberOfInstances,
                        false,
                    );
                }
            } elseif ($runtimeRoute === GameplayRuntimeRoute::Shadow) {
                $shadowStartedAt = microtime(true);
                try {
                    $runtimeCommand = $this->runtimeCommand($game, $type, $payload, $actor);
                    $runtimeShadowResult = $this->runtimeGateway?->dispatchShadow(
                        $runtimeCommand['type'],
                        $game->id(),
                        $actor->id(),
                        $currentVersion,
                        $clientActionId,
                        $game->snapshot(),
                        $runtimeCommand['payload'],
                    );
                    $runtimeShadowExecuted = $runtimeShadowResult !== null;
                } catch (\InvalidArgumentException|GameRuntimeGatewayException|GameplayRuntimePatchContractException) {
                    $runtimeShadowExecuted = true;
                    $runtimeShadowError = true;
                    // Shadow mode must never affect the authoritative legacy path.
                } finally {
                    $runtimeShadowCompareMs = $this->elapsedMs($shadowStartedAt);
                }
            }

            if ($this->streamsEnabled() && $this->activityStreams instanceof GameActivityStreamService) {
                $previousLogEntries = $this->activityStreams->logEntries($game);
            }

            $previousSnapshot = $game->snapshot();
            $phaseTimings['load'] = $snapshotLoadMs;
            $applyStartedAt = microtime(true);
            $disconnectVoteDirectPatchPayload = null;
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
                    $disconnectVoteDirectPatchPayload = $this->disconnectVoteDirectPatchPayload($recorded['snapshot'], $event, $clientActionId);
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
            if ($runtimeShadowResult instanceof \App\Application\Game\Runtime\GameRuntimeCommandResult) {
                $runtimeShadowDivergence = !$this->runtimeShadowMatchesLegacyEvent($runtimeShadowResult, $event);
            } elseif ($runtimeShadowError) {
                $runtimeShadowDivergence = true;
            }
            $handlerMetrics = $this->commands->consumeLastCommandMetrics() ?? [];
            $directPatchPayload = $disconnectVoteDirectPatchPayload ?? $this->commands->consumeLastDirectPatchPayload();
            if ($type === GameDisconnectVoteService::COMMAND_TYPE) {
                $phaseTimings['disconnect.vote_route'] = 1.0;
                $phaseTimings['disconnect.snapshot_write_count'] = 0.0;
            }
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
                    'gameplay.runtime_shadow_executed' => $runtimeShadowExecuted ? 1 : 0,
                    'gameplay.runtime_shadow_divergence' => $runtimeShadowDivergence ? 1 : 0,
                    'gameplay.runtime_shadow_compare_ms' => $runtimeShadowCompareMs,
                    'gameplay.runtime_shadow_error_count' => $runtimeShadowError ? 1 : 0,
                    'divergence_count' => (int) ($handlerMetrics['divergence_count'] ?? 0),
                    'shadow_fallback_count' => (int) ($handlerMetrics['shadow_fallback_count'] ?? 0),
                    'fallback_count' => (int) ($handlerMetrics['fallback_count'] ?? 0),
                    'shadow_runtime_error_count' => (int) ($handlerMetrics['shadow_runtime_error_count'] ?? 0),
                    'runtime_error_count' => (int) ($handlerMetrics['runtime_error_count'] ?? 0),
                    'shadow_patch_size_bytes' => (int) ($handlerMetrics['shadow_patch_size_bytes'] ?? 0),
                    'runtime_service_enabled' => (bool) ($this->flagsV2?->runtimeServiceEnabled() ?? false),
                    'disconnect.vote_route' => $type === GameDisconnectVoteService::COMMAND_TYPE ? 1 : 0,
                    'disconnect.snapshot_write_count' => 0,
                    'disconnect.patch_bytes' => $type === GameDisconnectVoteService::COMMAND_TYPE ? $patchBytes : 0,
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
     * @param list<string>        $ticketPermissions
     * @param array<string,int>|null $usageStartedAt
     */
    private function runtimeFinalPathResult(
        string $gameId,
        string $userId,
        string $type,
        array $payload,
        string $clientActionId,
        int $baseVersion,
        ?string $messageId,
        string $responseProtocol,
        ?string $ticketPlayerId,
        array $ticketPermissions,
        float $startedAt,
        ?array $usageStartedAt,
        GameplayMetricsRecorderInterface $metricsRecorder,
        GameplayMetricsInspector $metricsInspector,
        bool &$emergencyFallback,
    ): array|GameWebsocketCommandResult|null {
        $runtimeCommandType = $this->runtimeCommandType($type);
        if (($this->runtimeGateway?->routeFor($runtimeCommandType) ?? GameplayRuntimeRoute::LegacyOnly) !== GameplayRuntimeRoute::RuntimePrimary) {
            return null;
        }
        if ($responseProtocol !== 'v2' || !($this->flagsV2?->patchEnabled() ?? false)) {
            return null;
        }
        if ($ticketPlayerId === null && $ticketPermissions === []) {
            return null;
        }

        $playerId = trim((string) $ticketPlayerId);
        $permissionError = $this->runtimeFinalPermissionError($gameId, $userId, $playerId, $ticketPermissions);
        if ($permissionError !== null) {
            $this->recordRuntimeFinalMetric(
                $metricsRecorder,
                $metricsInspector,
                $usageStartedAt,
                $type,
                $gameId,
                $this->elapsedMs($startedAt),
                0.0,
                0,
                'runtime_permission_denied',
                [],
            );

            return $this->messages->rejectedCommand(
                $gameId,
                $messageId,
                $clientActionId,
                $baseVersion,
                'GAME_ACCESS_DENIED',
                $permissionError,
            );
        }

        try {
            $runtimeStartedAt = microtime(true);
            $runtimeCommand = $this->runtimeCommandFromTicket($type, $payload, $playerId);
            $runtimeResult = $this->runtimeGateway->dispatchPrimary(
                $runtimeCommand['type'],
                $gameId,
                $playerId,
                $baseVersion,
                $clientActionId,
                [],
                $runtimeCommand['payload'],
            );
            $runtimeMetrics = $this->numericRuntimeMetrics($runtimeResult->metrics);
            $patched = $this->runtimeFinalPatchedResult(
                $gameId,
                $runtimeResult->patches,
                $baseVersion,
                $clientActionId,
                [
                    'load' => 0.0,
                    'apply' => $this->elapsedMs($runtimeStartedAt),
                    'gameplay.runtime_route' => 1.0,
                    ...array_map(static fn (int|float $value): float => (float) $value, $runtimeMetrics),
                ],
                $startedAt,
            );
            $this->recordRuntimeFinalMetric(
                $metricsRecorder,
                $metricsInspector,
                $usageStartedAt,
                $type,
                $gameId,
                $this->elapsedMs($startedAt),
                (float) $patched['patch_ms'],
                (int) $patched['patch_bytes'],
                'runtime_applied',
                $runtimeMetrics,
            );

            return $patched['result'];
        } catch (\InvalidArgumentException $exception) {
            $this->recordRuntimeFinalMetric(
                $metricsRecorder,
                $metricsInspector,
                $usageStartedAt,
                $type,
                $gameId,
                $this->elapsedMs($startedAt),
                0.0,
                0,
                'invalid_runtime_payload',
                [],
            );

            return $this->messages->rejectedCommand(
                $gameId,
                $messageId,
                $clientActionId,
                $baseVersion,
                'INVALID_COMMAND_MESSAGE',
                $exception->getMessage(),
            );
        } catch (GameplayRuntimePatchContractException $exception) {
            return $this->runtimeFinalFailureResult(
                $exception,
                $gameId,
                $type,
                $messageId,
                $clientActionId,
                $baseVersion,
                true,
                $startedAt,
                $usageStartedAt,
                $metricsRecorder,
                $metricsInspector,
                $emergencyFallback,
            );
        } catch (GameRuntimeGatewayException $exception) {
            return $this->runtimeFinalFailureResult(
                $exception,
                $gameId,
                $type,
                $messageId,
                $clientActionId,
                $baseVersion,
                false,
                $startedAt,
                $usageStartedAt,
                $metricsRecorder,
                $metricsInspector,
                $emergencyFallback,
            );
        }
    }

    /**
     * @param list<string> $ticketPermissions
     */
    private function runtimeFinalPermissionError(string $gameId, string $userId, string $playerId, array $ticketPermissions): ?string
    {
        if (trim($gameId) === '' || trim($userId) === '' || $playerId === '') {
            return 'Runtime command ticket claims are incomplete.';
        }
        if (!in_array('command', $ticketPermissions, true)) {
            return 'Runtime command permission is required.';
        }

        return null;
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array{type:string,payload:array<string,mixed>}
     */
    private function runtimeCommandFromTicket(string $type, array $payload, string $playerId): array
    {
        return $this->runtimeCommandPayload($type, $payload, $playerId);
    }

    /**
     * @param list<array<string,mixed>> $patches
     * @param array<string,float>       $phaseTimings
     *
     * @return array{result: GameWebsocketCommandResult, patch_ms: float, patch_bytes: int}
     */
    private function runtimeFinalPatchedResult(
        string $gameId,
        array $patches,
        int $baseVersion,
        string $ackClientActionId,
        array $phaseTimings,
        float $startedAt,
    ): array {
        $metricsInspector = $this->metricsInspector();
        $messagesByUserId = [];
        $patchStartedAt = microtime(true);
        $version = $baseVersion + 1;
        foreach ($patches as $patch) {
            $version = max($version, (int) ($patch['version'] ?? $version));
        }

        foreach ($this->rooms->peersForGame($gameId) as $peer) {
            $viewerOps = [];
            foreach ($patches as $patch) {
                $visibility = is_string($patch['visibility'] ?? null) ? $patch['visibility'] : 'public';
                if (!$this->runtimeFinalPatchVisibleToPeer($visibility, $peer)) {
                    continue;
                }
                foreach (array_values(array_filter($patch['ops'] ?? [], static fn (mixed $op): bool => is_array($op))) as $op) {
                    $viewerOps[] = $op;
                }
            }
            $messagesByUserId[$peer->userId] = [[
                'kind' => 'patch.v2',
                'gameId' => $gameId,
                'version' => $version,
                'visibility' => sprintf('player:%s', $peer->effectivePlayerId()),
                'ops' => $viewerOps,
                'ackClientActionId' => $ackClientActionId,
            ]];
        }

        $patchMs = $this->elapsedMs($patchStartedAt);
        $patchBytes = 0;
        foreach ($messagesByUserId as $messages) {
            $patchBytes += $metricsInspector->patchBytesForMessages($messages);
        }
        $phaseTimings['projection'] = 0.0;
        $phaseTimings['patch'] = round($patchMs, 2);
        $phaseTimings['total'] = $this->elapsedMs($startedAt);

        return [
            'result' => GameWebsocketCommandResult::forViewerMessageLists(
                $messagesByUserId,
                [[
                    'kind' => 'patch.v2',
                    'gameId' => $gameId,
                    'version' => $version,
                    'visibility' => 'public',
                    'ops' => [],
                    'ackClientActionId' => $ackClientActionId,
                ]],
                $this->normalizeDebugProfile($phaseTimings),
            ),
            'patch_ms' => $phaseTimings['patch'],
            'patch_bytes' => $patchBytes,
        ];
    }

    private function runtimeFinalPatchVisibleToPeer(string $visibility, GameWebsocketPeer $peer): bool
    {
        if ($visibility === 'public') {
            return true;
        }
        if ($visibility === sprintf('player:%s', $peer->effectivePlayerId())
            || $visibility === sprintf('player:%s', $peer->userId)) {
            return true;
        }
        if (!str_starts_with($visibility, 'group:')) {
            return false;
        }

        $groupMask = (int) substr($visibility, strlen('group:'));

        return $groupMask > 0 && ($groupMask & $peer->viewerMask) !== 0;
    }

    /**
     * @param array<string,int>|null $usageStartedAt
     * @param array<string,int|float> $runtimeMetrics
     */
    private function recordRuntimeFinalMetric(
        GameplayMetricsRecorderInterface $metricsRecorder,
        GameplayMetricsInspector $metricsInspector,
        ?array $usageStartedAt,
        string $type,
        string $gameId,
        float $totalServerMs,
        float $patchMs,
        int $patchBytes,
        string $status,
        array $runtimeMetrics,
    ): void {
        $this->recordMetric(
            $metricsRecorder,
            $metricsInspector,
            [
                'transport' => 'websocket',
                'command.type' => $type,
                'gameId' => $gameId,
                'snapshot_load_ms' => 0.0,
                'normalize_ms' => 0.0,
                'command_apply_ms' => (float) ($runtimeMetrics['lifecycle.apply_ms'] ?? $runtimeMetrics['actor.command_latency_ms'] ?? 0.0),
                'persist_ms' => 0.0,
                'projection_ms' => 0.0,
                'patch_build_ms' => $patchMs,
                'total_server_ms' => $totalServerMs,
                'snapshot_bytes_before' => 0,
                'snapshot_bytes_after' => 0,
                'patch_bytes' => $patchBytes,
                'number_of_players' => 0,
                'number_of_instances' => 0,
                'number_of_visible_cards' => 0,
                'resync_required' => false,
                'clientActionId_duplicate' => false,
                'status' => $status,
                'gameplay.runtime_route' => 1,
                'gameplay.runtime_fallback_count' => 0,
                'gameplay.runtime_error_count' => 0,
                'gameplay.runtime_patch_contract_error' => 0,
                'command.legacy_fallback_count' => 0,
                ...$runtimeMetrics,
                ...$this->runtimeHotPathCounters(),
            ],
            $usageStartedAt,
        );
    }

    /**
     * @param array<string,int>|null $usageStartedAt
     */
    private function runtimeFinalFailureResult(
        GameRuntimeGatewayException $exception,
        string $gameId,
        string $type,
        ?string $messageId,
        string $clientActionId,
        int $baseVersion,
        bool $patchContractError,
        float $startedAt,
        ?array $usageStartedAt,
        GameplayMetricsRecorderInterface $metricsRecorder,
        GameplayMetricsInspector $metricsInspector,
        bool &$emergencyFallback,
    ): array|GameWebsocketCommandResult|null {
        if ($this->emergencyLegacyFallbackEnabled) {
            $emergencyFallback = true;
            $this->logger?->error('Emergency legacy gameplay fallback activated.', [
                'gameId' => $gameId,
                'command.type' => $type,
                'clientActionId' => $clientActionId,
                'exception' => $exception,
                'alert' => 'runtime_emergency_legacy_fallback',
            ]);
            $this->recordRuntimeFallbackMetric(
                $metricsRecorder,
                $metricsInspector,
                $usageStartedAt,
                $type,
                $gameId,
                0.0,
                0,
                0,
                0,
                $patchContractError,
            );

            return null;
        }

        $this->logger?->error('Runtime gameplay command failed without emergency fallback.', [
            'gameId' => $gameId,
            'command.type' => $type,
            'clientActionId' => $clientActionId,
            'exception' => $exception,
            'alert' => 'runtime_command_failed_no_legacy_fallback',
        ]);
        $this->recordRuntimeFailureMetric(
            $metricsRecorder,
            $metricsInspector,
            $usageStartedAt,
            $type,
            $gameId,
            0.0,
            0,
            0,
            0,
            $patchContractError,
            $this->elapsedMs($startedAt),
        );

        return $this->runtimeFailureMessage($gameId, $messageId, $clientActionId, $baseVersion, $patchContractError);
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
                    'chat.message_route' => $type === 'chat.message' ? 1 : 0,
                    'chat.reaction_route' => $type === 'chat.reaction.toggled' ? 1 : 0,
                    'chat.snapshot_write_count' => 0,
                    'chat.patch_bytes' => 0,
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
        $phaseTimings['chat.message_route'] = $type === 'chat.message' ? 1.0 : 0.0;
        $phaseTimings['chat.reaction_route'] = $type === 'chat.reaction.toggled' ? 1.0 : 0.0;
        $phaseTimings['chat.snapshot_write_count'] = 0.0;
        $phaseTimings['chat.patch_bytes'] = (float) $patchBytes;
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
                'chat.message_route' => $type === 'chat.message' ? 1 : 0,
                'chat.reaction_route' => $type === 'chat.reaction.toggled' ? 1 : 0,
                'chat.snapshot_write_count' => 0,
                'chat.patch_bytes' => $patchBytes,
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
            && (($this->flagsV2?->patchEnabled() ?? false) || ($this->flagsV2?->enabled() ?? false))
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
     * @param array<string,mixed> $payload
     *
     * @return array<string,mixed>
     */
    private function runtimeCommandType(string $type): string
    {
        return GameplayCommandCatalog::canonicalType($type);
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function disconnectVoteDirectPatchPayload(array $snapshot, GameEvent $event, string $clientActionId): array
    {
        $disconnectVote = is_array($snapshot['disconnectVote'] ?? null) ? $snapshot['disconnectVote'] : null;
        $operations = [[
            'op' => 'disconnect.vote.set',
            'disconnectVote' => $disconnectVote,
        ]];
        $payload = $event->payload();
        if (($payload['status'] ?? null) === GameDisconnectVoteService::STATUS_RESOLVED_EXPEL && is_string($payload['targetPlayerId'] ?? null)) {
            $targetPlayerId = $payload['targetPlayerId'];
            $player = is_array($snapshot['players'][$targetPlayerId] ?? null) ? $snapshot['players'][$targetPlayerId] : [];
            $operations[] = [
                'op' => 'player.status.set',
                'playerId' => $targetPlayerId,
                'status' => 'conceded',
                'concededAt' => is_string($player['concededAt'] ?? null) ? $player['concededAt'] : null,
            ];
            if (is_array($snapshot['turn'] ?? null)) {
                $operations[] = [
                    'op' => 'turn.set',
                    'turn' => $snapshot['turn'],
                ];
            }
        }

        return [
            'version' => max(1, (int) ($snapshot['version'] ?? $event->version())),
            'ackClientActionId' => $clientActionId,
            'operations' => $operations,
            'eventPayload' => $event->toArray()['payload'] ?? [],
            'appendEventLog' => false,
        ];
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array{type:string,payload:array<string,mixed>}
     */
    private function runtimeCommand(Game $game, string $type, array $payload, User $actor): array
    {
        if ($type === 'game.close' && $game->room()->owner()->id() !== $actor->id()) {
            throw new \InvalidArgumentException('Only the room owner can close the game.');
        }

        return $this->runtimeCommandPayload($type, $payload, $actor->id());
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array{type:string,payload:array<string,mixed>}
     */
    private function runtimeCommandPayload(string $type, array $payload, string $defaultPlayerId): array
    {
        $runtimePayload = $payload;
        if (!is_string($runtimePayload['playerId'] ?? null) || trim((string) $runtimePayload['playerId']) === '') {
            $runtimePayload['playerId'] = $defaultPlayerId;
        }
        if (in_array($type, ['library.reveal_top', 'library.reveal', 'card.revealed'], true) && !isset($runtimePayload['viewers']) && isset($runtimePayload['to'])) {
            $runtimePayload['viewers'] = $runtimePayload['to'];
        }
        if ($type === 'zone.changed') {
            if (isset($runtimePayload['cards'])) {
                throw new \InvalidArgumentException('zone.changed runtime path accepts instanceIds only.');
            }

            $playerId = is_string($runtimePayload['playerId'] ?? null) ? trim($runtimePayload['playerId']) : '';
            $zone = is_string($runtimePayload['zone'] ?? null) ? trim($runtimePayload['zone']) : '';
            $instanceIds = $runtimePayload['instanceIds'] ?? null;
            if ($playerId === '' || $zone === '' || !is_array($instanceIds)) {
                throw new \InvalidArgumentException('zone.changed runtime path requires playerId, zone and instanceIds.');
            }

            $normalizedIds = array_values(array_filter($instanceIds, static fn (mixed $id): bool => is_string($id) && trim($id) !== ''));
            if (count($normalizedIds) !== count($instanceIds)) {
                throw new \InvalidArgumentException('zone.changed runtime path only accepts non-empty instanceIds.');
            }

            return [
                'type' => 'zone.reorderedByIds',
                'payload' => [
                    'playerId' => $playerId,
                    'zone' => $zone,
                    'instanceIds' => $normalizedIds,
                ],
            ];
        }

        return [
            'type' => $this->runtimeCommandType($type),
            'payload' => $runtimePayload,
        ];
    }

    /**
     * @param array<string,mixed> $metrics
     *
     * @return array<string,int|float>
     */
    private function numericRuntimeMetrics(array $metrics): array
    {
        $numeric = [];
        foreach ($metrics as $key => $value) {
            if (!is_string($key) || (!is_int($value) && !is_float($value))) {
                continue;
            }
            $numeric[$key] = $value;
        }

        return $numeric;
    }

    private function runtimeShadowMatchesLegacyEvent(
        \App\Application\Game\Runtime\GameRuntimeCommandResult $runtimeResult,
        GameEvent $legacyEvent,
    ): bool {
        $runtimeType = $runtimeResult->event['type'] ?? null;

        return is_string($runtimeType)
            && $this->runtimeCommandType($runtimeType) === $this->runtimeCommandType($legacyEvent->type());
    }

    /**
     * @param array<string,int>|null $usageStartedAt
     */
    private function recordRuntimeFallbackMetric(
        GameplayMetricsRecorderInterface $metricsRecorder,
        GameplayMetricsInspector $metricsInspector,
        ?array $usageStartedAt,
        string $type,
        string $gameId,
        float $snapshotLoadMs,
        int $snapshotBytesBefore,
        int $numberOfPlayers,
        int $numberOfInstances,
        bool $patchContractError,
    ): void {
        $this->logger?->error('Emergency legacy gameplay fallback metric recorded.', [
            'gameId' => $gameId,
            'command.type' => $type,
            'alert' => 'runtime_emergency_legacy_fallback',
            'patchContractError' => $patchContractError,
        ]);
        $this->recordMetric(
            $metricsRecorder,
            $metricsInspector,
            [
                'transport' => 'websocket',
                'command.type' => $type,
                'gameId' => $gameId,
                'snapshot_load_ms' => $snapshotLoadMs,
                'normalize_ms' => 0.0,
                'command_apply_ms' => 0.0,
                'persist_ms' => 0.0,
                'projection_ms' => 0.0,
                'patch_build_ms' => 0.0,
                'total_server_ms' => 0.0,
                'snapshot_bytes_before' => $snapshotBytesBefore,
                'snapshot_bytes_after' => $snapshotBytesBefore,
                'patch_bytes' => 0,
                'number_of_players' => $numberOfPlayers,
                'number_of_instances' => $numberOfInstances,
                'number_of_visible_cards' => 0,
                'resync_required' => false,
                'clientActionId_duplicate' => false,
                'status' => 'runtime_fallback',
                'gameplay.runtime_route' => 1,
                'gameplay.runtime_fallback_count' => 1,
                'gameplay.runtime_error_count' => $patchContractError ? 0 : 1,
                'gameplay.runtime_patch_contract_error' => $patchContractError ? 1 : 0,
                'command.legacy_fallback_count' => 1,
                ...$this->runtimeHotPathCounters(
                    legacyHandlerCount: 1,
                    emergencyFallbackCount: 1,
                    snapshotLoadCount: $snapshotBytesBefore > 0 ? 1 : 0,
                    dbLockCount: $snapshotBytesBefore > 0 ? 1 : 0,
                ),
            ],
            $usageStartedAt,
        );
    }

    /**
     * @param array<string,int>|null $usageStartedAt
     */
    private function recordRuntimeFailureMetric(
        GameplayMetricsRecorderInterface $metricsRecorder,
        GameplayMetricsInspector $metricsInspector,
        ?array $usageStartedAt,
        string $type,
        string $gameId,
        float $snapshotLoadMs,
        int $snapshotBytesBefore,
        int $numberOfPlayers,
        int $numberOfInstances,
        bool $patchContractError,
        float $totalServerMs = 0.0,
    ): void {
        $this->recordMetric(
            $metricsRecorder,
            $metricsInspector,
            [
                'transport' => 'websocket',
                'command.type' => $type,
                'gameId' => $gameId,
                'snapshot_load_ms' => $snapshotLoadMs,
                'normalize_ms' => 0.0,
                'command_apply_ms' => 0.0,
                'persist_ms' => 0.0,
                'projection_ms' => 0.0,
                'patch_build_ms' => 0.0,
                'total_server_ms' => $totalServerMs,
                'snapshot_bytes_before' => $snapshotBytesBefore,
                'snapshot_bytes_after' => $snapshotBytesBefore,
                'patch_bytes' => 0,
                'number_of_players' => $numberOfPlayers,
                'number_of_instances' => $numberOfInstances,
                'number_of_visible_cards' => 0,
                'resync_required' => false,
                'clientActionId_duplicate' => false,
                'status' => $patchContractError ? 'runtime_patch_contract_failed' : 'runtime_failed',
                'gameplay.runtime_route' => 1,
                'gameplay.runtime_fallback_count' => 0,
                'gameplay.runtime_error_count' => $patchContractError ? 0 : 1,
                'gameplay.runtime_patch_contract_error' => $patchContractError ? 1 : 0,
                'command.legacy_fallback_count' => 0,
                ...$this->runtimeHotPathCounters(snapshotLoadCount: $snapshotBytesBefore > 0 ? 1 : 0),
            ],
            $usageStartedAt,
        );
    }

    private function runtimeFailureMessage(
        string $gameId,
        ?string $messageId,
        string $clientActionId,
        int $version,
        bool $patchContractError,
    ): array {
        return $this->messages->rejectedCommand(
            $gameId,
            $messageId,
            $clientActionId,
            $version,
            $patchContractError ? 'RUNTIME_PATCH_CONTRACT_ERROR' : 'RUNTIME_UNAVAILABLE',
            $patchContractError
                ? 'Runtime patch contract failed. Legacy fallback is disabled.'
                : 'Runtime command failed. Legacy fallback is disabled.',
        );
    }

    /**
     * @return array<string,int>
     */
    private function runtimeHotPathCounters(
        int $snapshotLoadCount = 0,
        int $snapshotWriteCount = 0,
        int $dbLockCount = 0,
        int $legacyHandlerCount = 0,
        int $previousNextProjectionCount = 0,
        int $emergencyFallbackCount = 0,
    ): array {
        return [
            'runtime.snapshot_load_count' => $snapshotLoadCount,
            'runtime.snapshot_write_count' => $snapshotWriteCount,
            'runtime.db_lock_count' => $dbLockCount,
            'runtime.legacy_handler_count' => $legacyHandlerCount,
            'runtime.previous_next_projection_count' => $previousNextProjectionCount,
            'runtime.emergency_fallback_count' => $emergencyFallbackCount,
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
     * @param list<array<string,mixed>> $patches
     * @param array<string,float>       $phaseTimings
     */
    private function runtimePatchedResult(
        Game $game,
        array $patches,
        int $baseVersion,
        string $ackClientActionId,
        string $runtimeCommandType,
        array $runtimeCommandPayload,
        array $phaseTimings,
        float $startedAt,
    ): array {
        $metricsInspector = $this->metricsInspector();
        $messagesByUserId = [];
        $patchStartedAt = microtime(true);
        $snapshot = $game->snapshot();
        $baseStaticCardsByCardKey = [
            ...$this->staticCardsByCardKey($snapshot),
            ...$this->runtimePayloadStaticCardsByCardKey($runtimeCommandType, $runtimeCommandPayload),
        ];
        $version = $baseVersion + 1;
        foreach ($patches as $patch) {
            $version = max($version, (int) ($patch['version'] ?? $version));
        }

        foreach ($this->viewers($game) as $viewer) {
            $viewerOps = [];
            $staticCardsByCardKey = $this->localizedRuntimeStaticCardsByCardKey($snapshot, $baseStaticCardsByCardKey, $viewer);
            $viewerLanguage = LanguageCatalog::normalize($viewer->cardLanguage()) ?? LanguageCatalog::DEFAULT_LANGUAGE;
            foreach ($patches as $patch) {
                $visibility = is_string($patch['visibility'] ?? null) ? $patch['visibility'] : 'public';
                if (!$this->runtimePatchVisibleToViewer($snapshot, $visibility, $viewer->id())) {
                    continue;
                }
                foreach (array_values(array_filter($patch['ops'] ?? [], static fn (mixed $op): bool => is_array($op))) as $op) {
                    $viewerOps[] = $this->hydrateRuntimeStaticCards($op, $staticCardsByCardKey, $viewerLanguage);
                }
            }
            $messagesByUserId[$viewer->id()] = [[
                'kind' => 'patch.v2',
                'gameId' => $game->id(),
                'version' => $version,
                'visibility' => sprintf('player:%s', $viewer->id()),
                'ops' => $viewerOps,
                'ackClientActionId' => $ackClientActionId,
            ]];
        }

        $patchMs = $this->elapsedMs($patchStartedAt);
        $patchBytes = 0;
        foreach ($messagesByUserId as $messages) {
            $patchBytes += $metricsInspector->patchBytesForMessages($messages);
        }
        $phaseTimings['projection'] = 0.0;
        $phaseTimings['patch'] = round($patchMs, 2);
        $phaseTimings['total'] = $this->elapsedMs($startedAt);

        return [
            'result' => GameWebsocketCommandResult::forViewerMessageLists(
                $messagesByUserId,
                [[
                    'kind' => 'patch.v2',
                    'gameId' => $game->id(),
                    'version' => $version,
                    'visibility' => 'public',
                    'ops' => [],
                    'ackClientActionId' => $ackClientActionId,
                ]],
                $this->normalizeDebugProfile($phaseTimings),
            ),
            'patch_ms' => $phaseTimings['patch'],
            'patch_bytes' => $patchBytes,
        ];
    }

    /**
     * Runtime events are persisted by the Go actor with compact instance identity only. For token templates,
     * Symfony still has the original command payload, so it stores a sanitized static bundle for replay/bootstrap.
     *
     * @param array<string,mixed> $runtimeCommandPayload
     */
    private function enrichRuntimePersistedEvent(
        EntityManagerInterface $manager,
        Game $game,
        string $clientActionId,
        string $runtimeCommandType,
        array $runtimeCommandPayload,
    ): void {
        $staticCards = $this->runtimePayloadStaticCardsByCardKey($runtimeCommandType, $runtimeCommandPayload);
        if ($staticCards === []) {
            return;
        }

        $event = $manager->getRepository(GameEvent::class)->findOneBy([
            'game' => $game,
            'clientActionId' => $clientActionId,
        ]);
        if (!$event instanceof GameEvent) {
            return;
        }

        $payload = $event->payload();
        $payload['staticCards'] = [
            ...(is_array($payload['staticCards'] ?? null) ? $payload['staticCards'] : []),
            ...array_map(
                fn (array $staticCard): array => $this->compactRuntimeStaticCard($staticCard, 'public'),
                $staticCards,
            ),
        ];
        $event->replacePayload($payload);
        $manager->flush();
    }

    /**
     * @param array<string,mixed> $payload
     * @param list<GameEvent> $events
     */
    private function runtimeLifecycleTransitionError(Game $game, string $type, array $payload, User $actor, array $events): ?string
    {
        if ($type === 'game.concede') {
            $playerId = is_string($payload['playerId'] ?? null) && trim($payload['playerId']) !== ''
                ? trim($payload['playerId'])
                : $actor->id();
            $snapshotPlayer = $game->snapshot()['players'][$playerId] ?? null;
            if (is_array($snapshotPlayer) && ($snapshotPlayer['status'] ?? null) === 'conceded') {
                return 'Player already conceded.';
            }
            foreach ($events as $event) {
                if (!$event instanceof GameEvent || $event->type() !== 'game.concede') {
                    continue;
                }
                $eventPayload = $this->runtimeLifecycleEventPayload($event);
                $eventPlayerId = is_string($eventPayload['playerId'] ?? null) && trim($eventPayload['playerId']) !== ''
                    ? trim($eventPayload['playerId'])
                    : $event->createdBy()?->id();
                if ($eventPlayerId === $playerId) {
                    return 'Player already conceded.';
                }
            }
        }

        if ($type === 'game.close') {
            if ($game->status() === Game::STATUS_FINISHED || ($game->snapshot()['gamePhase'] ?? null) === 'FINISHED') {
                return 'Game is already closed.';
            }
            foreach ($events as $event) {
                if ($event instanceof GameEvent && $event->type() === 'game.close') {
                    return 'Game is already closed.';
                }
            }
        }

        return null;
    }

    /**
     * @return list<GameEvent>
     */
    private function runtimeLifecycleEvents(EntityManagerInterface $manager, Game $game, string $type): array
    {
        if (!in_array($type, ['game.concede', 'game.close'], true)) {
            return [];
        }

        return array_values(array_filter(
            $manager->getRepository(GameEvent::class)->findBy([
                'game' => $game,
                'type' => $type,
            ]),
            static fn (mixed $event): bool => $event instanceof GameEvent,
        ));
    }

    private function lifecycleEffectiveVersion(Game $game, int $snapshotVersion): int
    {
        $version = $snapshotVersion;
        foreach ($game->events() as $event) {
            if ($event instanceof GameEvent) {
                $version = max($version, $event->version());
            }
        }

        return $version;
    }

    /**
     * @return array<string,mixed>
     */
    private function runtimeLifecycleEventPayload(GameEvent $event): array
    {
        $payload = $event->payload();

        return is_array($payload['public'] ?? null) ? $payload['public'] : $payload;
    }

    /**
     * @param array<string,mixed>               $op
     * @param array<string,array<string,mixed>> $staticCardsByCardKey
     *
     * @return array<string,mixed>
     */
    private function hydrateRuntimeStaticCards(array $op, array $staticCardsByCardKey, string $viewerLanguage): array
    {
        $opName = is_string($op['op'] ?? null) ? $op['op'] : '';
        if (in_array($opName, ['zone.cards.add', 'library.top.revealed', 'library.top.viewed', 'library.revealed.set'], true)) {
            $cards = array_values(array_filter($op['cards'] ?? [], static fn (mixed $card): bool => is_array($card)));
            $viewerVisibility = $this->viewerVisibilityForZone((string) ($op['zone'] ?? 'library'));
            $op['cards'] = $this->cardsWithRuntimeIdentity($cards, $staticCardsByCardKey, $viewerVisibility, $viewerLanguage);
            $staticCards = $this->staticCardsForCards($cards, $staticCardsByCardKey, $viewerVisibility, $viewerLanguage);
            if ($staticCards !== []) {
                $op['staticCards'] = $staticCards;
            }

            return $op;
        }

        if ($opName === 'zone.cards.move') {
            $viewerVisibility = $this->viewerVisibilityForZone((string) ($op['to']['zone'] ?? 'battlefield'));
            if (is_array($op['card'] ?? null)) {
                $op['card'] = $this->cardWithRuntimeIdentity($op['card'], $staticCardsByCardKey, $viewerVisibility, $viewerLanguage);
            }
            $staticCard = $this->staticCardForCard($op['card'] ?? null, $staticCardsByCardKey, $viewerVisibility, $viewerLanguage);
            if ($staticCard !== null) {
                $op['staticCard'] = $staticCard;
            }

            return $op;
        }

        if ($opName === 'zone.cards.batchMove') {
            $moves = array_values(array_filter($op['moves'] ?? [], static fn (mixed $move): bool => is_array($move)));
            foreach ($moves as $index => $move) {
                $viewerVisibility = $this->viewerVisibilityForZone((string) ($move['to']['zone'] ?? 'battlefield'));
                if (is_array($move['card'] ?? null)) {
                    $moves[$index]['card'] = $this->cardWithRuntimeIdentity($move['card'], $staticCardsByCardKey, $viewerVisibility, $viewerLanguage);
                }
                $staticCard = $this->staticCardForCard($moves[$index]['card'] ?? null, $staticCardsByCardKey, $viewerVisibility, $viewerLanguage);
                if ($staticCard !== null) {
                    $moves[$index]['staticCard'] = $staticCard;
                }
            }
            $op['moves'] = $moves;

            return $op;
        }

        return $op;
    }

    /**
     * @param array<string,mixed>               $snapshot
     * @param array<string,array<string,mixed>> $staticCardsByCardKey
     *
     * @return array<string,array<string,mixed>>
     */
    private function localizedRuntimeStaticCardsByCardKey(array $snapshot, array $staticCardsByCardKey, User $viewer): array
    {
        $language = LanguageCatalog::normalize($viewer->cardLanguage()) ?? LanguageCatalog::DEFAULT_LANGUAGE;
        $localizedStaticCards = [];
        foreach ($staticCardsByCardKey as $cardKey => $staticCard) {
            $localizedStaticCards[$cardKey] = [
                ...$staticCard,
                'language' => $language,
            ];
        }

        if ($language === null || !LanguageCatalog::isSupported($language) || $staticCardsByCardKey === []) {
            return $localizedStaticCards;
        }

        if (!$this->cardLocalizationResolver instanceof GameWebsocketCardLocalizationResolver) {
            return $localizedStaticCards;
        }

        $localizedLookup = $this->cardLocalizationResolver->buildLocalizedLookupForScryfallIds(
            $this->runtimeStaticCardScryfallIds($staticCardsByCardKey),
            [$language],
        );
        $localizedCards = is_array($localizedLookup[$language] ?? null) ? $localizedLookup[$language] : [];
        if ($localizedCards === []) {
            return $localizedStaticCards;
        }

        foreach ($localizedStaticCards as $cardKey => $staticCard) {
            $scryfallId = is_string($staticCard['scryfallId'] ?? null) ? trim($staticCard['scryfallId']) : '';
            $localized = $scryfallId !== '' && is_array($localizedCards[$scryfallId] ?? null) ? $localizedCards[$scryfallId] : null;
            if ($localized !== null) {
                $localizedStaticCards[$cardKey] = $this->applyLocalizedRuntimeStaticCard($staticCard, $localized);
            }
        }

        return $localizedStaticCards;
    }

    /**
     * @param array<string,array<string,mixed>> $staticCardsByCardKey
     *
     * @return list<string>
     */
    private function runtimeStaticCardScryfallIds(array $staticCardsByCardKey): array
    {
        $ids = [];
        foreach ($staticCardsByCardKey as $staticCard) {
            $scryfallId = is_string($staticCard['scryfallId'] ?? null) ? trim($staticCard['scryfallId']) : '';
            if ($scryfallId !== '') {
                $ids[$scryfallId] = true;
            }
        }

        return array_keys($ids);
    }

    /**
     * @param array<string,mixed> $staticCard
     * @param array<string,mixed> $localized
     *
     * @return array<string,mixed>
     */
    private function applyLocalizedRuntimeStaticCard(array $staticCard, array $localized): array
    {
        if (is_array($localized['imageUris'] ?? null) && $localized['imageUris'] !== []) {
            $staticCard['imageUris'] = $localized['imageUris'];
        }

        if (is_array($staticCard['cardFaces'] ?? null) && is_array($localized['cardFaces'] ?? null)) {
            $staticCard['cardFaces'] = $this->mergeLocalizedRuntimeFaces($staticCard['cardFaces'], $localized['cardFaces']);
        }

        return $staticCard;
    }

    /**
     * @param list<array<string,mixed>> $sourceFaces
     * @param list<array<string,mixed>> $localizedFaces
     *
     * @return list<array<string,mixed>>
     */
    private function mergeLocalizedRuntimeFaces(array $sourceFaces, array $localizedFaces): array
    {
        return array_values(array_map(
            static function (array $face, int $index) use ($localizedFaces): array {
                $localizedFace = $localizedFaces[$index] ?? null;
                if (!is_array($localizedFace) || !is_array($localizedFace['imageUris'] ?? null) || $localizedFace['imageUris'] === []) {
                    return $face;
                }

                return [
                    ...$face,
                    'imageUris' => $localizedFace['imageUris'],
                ];
            },
            $sourceFaces,
            array_keys($sourceFaces),
        ));
    }

    /**
     * @param list<array<string,mixed>>         $cards
     * @param array<string,array<string,mixed>> $staticCardsByCardKey
     *
     * @return array<string,array<string,mixed>>
     */
    private function staticCardsForCards(array $cards, array $staticCardsByCardKey, string $viewerVisibility, string $viewerLanguage): array
    {
        $staticCards = [];
        foreach ($cards as $card) {
            $cardKey = $this->runtimeCardKey($card);
            if ($cardKey === '') {
                continue;
            }
            $staticCard = isset($staticCardsByCardKey[$cardKey])
                ? $this->compactRuntimeStaticCard($staticCardsByCardKey[$cardKey], $viewerVisibility)
                : $this->fallbackRuntimeStaticIdentity($cardKey, $card, $viewerVisibility, $viewerLanguage);
            $staticCards[$this->staticCardMapKey($staticCard, $cardKey)] = $staticCard;
        }

        return $staticCards;
    }

    /**
     * @param list<array<string,mixed>>         $cards
     * @param array<string,array<string,mixed>> $staticCardsByCardKey
     *
     * @return list<array<string,mixed>>
     */
    private function cardsWithRuntimeIdentity(array $cards, array $staticCardsByCardKey, string $viewerVisibility, string $viewerLanguage): array
    {
        return array_values(array_map(
            fn (array $card): array => $this->cardWithRuntimeIdentity($card, $staticCardsByCardKey, $viewerVisibility, $viewerLanguage),
            $cards,
        ));
    }

    /**
     * @param array<string,mixed>               $card
     * @param array<string,array<string,mixed>> $staticCardsByCardKey
     *
     * @return array<string,mixed>
     */
    private function cardWithRuntimeIdentity(array $card, array $staticCardsByCardKey, string $viewerVisibility, string $viewerLanguage): array
    {
        $cardKey = $this->runtimeCardKey($card);
        if ($cardKey === '') {
            return $card;
        }

        $staticCard = isset($staticCardsByCardKey[$cardKey])
            ? $this->compactRuntimeStaticCard($staticCardsByCardKey[$cardKey], $viewerVisibility)
            : $this->fallbackRuntimeStaticIdentity($cardKey, $card, $viewerVisibility, $viewerLanguage);
        $canonicalCardRef = is_string($staticCard['cardRef'] ?? null) && trim($staticCard['cardRef']) !== ''
            ? trim($staticCard['cardRef'])
            : $cardKey;
        $canonicalCardKey = is_string($staticCard['cardKey'] ?? null) && trim($staticCard['cardKey']) !== ''
            ? trim($staticCard['cardKey'])
            : $canonicalCardRef;

        return [
            ...$card,
            'cardRef' => $canonicalCardRef,
            'cardKey' => $canonicalCardKey,
            'printId' => $staticCard['printId'] ?? $staticCard['scryfallId'] ?? $cardKey,
            'cardVersion' => $staticCard['cardVersion'] ?? null,
            'language' => $staticCard['language'] ?? LanguageCatalog::DEFAULT_LANGUAGE,
            'viewerVisibility' => $viewerVisibility,
        ];
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array<string,mixed>
     */
    private function fallbackRuntimeStaticIdentity(string $cardKey, array $card, string $viewerVisibility, string $viewerLanguage): array
    {
        return [
            'cardRef' => $cardKey,
            'cardKey' => $cardKey,
            'printId' => is_string($card['printId'] ?? null) && trim($card['printId']) !== ''
                ? trim($card['printId'])
                : $cardKey,
            'cardVersion' => is_string($card['cardVersion'] ?? null) && trim($card['cardVersion']) !== ''
                ? trim($card['cardVersion'])
                : 'runtime-identity-v1',
            'language' => LanguageCatalog::normalize($viewerLanguage) ?? LanguageCatalog::DEFAULT_LANGUAGE,
            'viewerVisibility' => $viewerVisibility,
            'scryfallId' => is_string($card['scryfallId'] ?? null) && trim($card['scryfallId']) !== ''
                ? trim($card['scryfallId'])
                : null,
            'name' => is_string($card['name'] ?? null) && trim($card['name']) !== ''
                ? trim($card['name'])
                : null,
        ];
    }

    /**
     * @param array<string,array<string,mixed>> $staticCardsByCardKey
     *
     * @return array<string,mixed>|null
     */
    private function staticCardForCard(mixed $card, array $staticCardsByCardKey, string $viewerVisibility, string $viewerLanguage): ?array
    {
        if (!is_array($card)) {
            return null;
        }

        $cardKey = $this->runtimeCardKey($card);
        if ($cardKey === '') {
            return null;
        }

        return isset($staticCardsByCardKey[$cardKey])
            ? $this->compactRuntimeStaticCard($staticCardsByCardKey[$cardKey], $viewerVisibility)
            : $this->fallbackRuntimeStaticIdentity($cardKey, $card, $viewerVisibility, $viewerLanguage);
    }

    /**
     * @param array<string,mixed> $staticCard
     *
     * @return array<string,mixed>
     */
    private function compactRuntimeStaticCard(array $staticCard, string $viewerVisibility): array
    {
        $staticCard['viewerVisibility'] = $viewerVisibility;
        $staticCard['printId'] = is_string($staticCard['printId'] ?? null) && trim($staticCard['printId']) !== ''
            ? trim($staticCard['printId'])
            : (is_string($staticCard['scryfallId'] ?? null) && trim($staticCard['scryfallId']) !== '' ? trim($staticCard['scryfallId']) : (string) ($staticCard['cardKey'] ?? $staticCard['cardRef'] ?? ''));
        $staticCard['language'] = is_string($staticCard['language'] ?? null) && trim($staticCard['language']) !== ''
            ? trim($staticCard['language'])
            : LanguageCatalog::DEFAULT_LANGUAGE;
        unset($staticCard['oracleText']);
        if (is_array($staticCard['cardFaces'] ?? null)) {
            $staticCard['cardFaces'] = array_values(array_map(
                static function (mixed $face): mixed {
                    if (is_array($face)) {
                        unset($face['oracleText']);
                    }

                    return $face;
                },
                $staticCard['cardFaces'],
            ));
        }

        return $staticCard;
    }

    /**
     * Runtime actors intentionally emit compact instance patches. The browser still needs the renderable
     * static bundle for newly visible cards, so the bridge rehydrates staticCards from the command payload.
     *
     * @param array<string,mixed> $payload
     *
     * @return array<string,array<string,mixed>>
     */
    private function runtimePayloadStaticCardsByCardKey(string $type, array $payload): array
    {
        if ($type !== 'card.token.created') {
            return [];
        }

        $card = is_array($payload['card'] ?? null) ? $payload['card'] : [];
        if ($card === []) {
            return [];
        }

        $name = is_string($card['name'] ?? null) && trim($card['name']) !== ''
            ? trim($card['name'])
            : (is_string($payload['name'] ?? null) && trim($payload['name']) !== '' ? trim($payload['name']) : 'Token');
        $cardKey = $this->runtimeTokenCardKey($card, $name);
        $staticCard = $this->bootstrapStaticCard($cardKey, [
            ...$card,
            'name' => $name,
            'isToken' => true,
            'isTokenCopy' => false,
        ]);

        $staticCards = [$cardKey => $staticCard];
        foreach ($this->staticCardAliases($staticCard) as $alias) {
            $staticCards[$alias] ??= $staticCard;
        }

        return $staticCards;
    }

    /**
     * @param array<string,mixed> $staticCard
     */
    private function staticCardMapKey(array $staticCard, string $fallback): string
    {
        foreach (['cardRef', 'cardKey'] as $field) {
            if (is_string($staticCard[$field] ?? null) && trim($staticCard[$field]) !== '') {
                return trim($staticCard[$field]);
            }
        }

        return $fallback;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function runtimeCardKey(array $card): string
    {
        foreach (['cardKey', 'cardRef'] as $field) {
            if (is_string($card[$field] ?? null) && trim($card[$field]) !== '') {
                return trim($card[$field]);
            }
        }

        return '';
    }

    /**
     * @param array<string,mixed> $card
     */
    private function runtimeTokenCardKey(array $card, string $name): string
    {
        if (is_string($card['cardKey'] ?? null) && trim($card['cardKey']) !== '') {
            return trim($card['cardKey']);
        }

        if (is_string($card['scryfallId'] ?? null) && trim($card['scryfallId']) !== '') {
            return trim($card['scryfallId']).':token';
        }

        $slug = strtolower(trim($name));
        $slug = (string) preg_replace('/[^a-z0-9_-]+/', '-', $slug);
        $slug = trim($slug, '-_');

        return 'token:'.($slug !== '' ? $slug : 'token');
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,array<string,mixed>>
     */
    private function staticCardsByCardKey(array $snapshot): array
    {
        $catalog = is_array($snapshot['cardCatalog'] ?? null) ? $snapshot['cardCatalog'] : [];
        $staticCards = [];
        foreach ($catalog as $cardKey => $card) {
            if (is_string($cardKey) && is_array($card)) {
                $staticCard = $this->bootstrapStaticCard($cardKey, $card);
                foreach ($this->staticCardAliases($staticCard) as $alias) {
                    $staticCards[$alias] ??= $staticCard;
                }
                $staticCards[$cardKey] = $staticCard;
            }
        }

        $players = is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [];
        foreach ($players as $player) {
            if (!is_array($player)) {
                continue;
            }
            $zones = is_array($player['zones'] ?? null) ? $player['zones'] : [];
            foreach ($zones as $cards) {
                if (!is_array($cards)) {
                    continue;
                }
                foreach ($cards as $card) {
                    if (!is_array($card)) {
                        continue;
                    }
                    $cardKey = $this->cardKeyForStaticCard($card);
                    if ($cardKey !== '') {
                        $staticCard = $this->bootstrapStaticCard($cardKey, $card);
                        foreach ($this->staticCardAliases($staticCard) as $alias) {
                            $staticCards[$alias] ??= $staticCard;
                        }
                        $staticCards[$cardKey] ??= $staticCard;
                    }
                }
            }
        }

        return $staticCards;
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array<string,mixed>
     */
    private function bootstrapStaticCard(string $cardKey, array $card): array
    {
        $baseStats = is_array($card['baseStats'] ?? null) ? $card['baseStats'] : [];
        $bundle = CardStaticBundle::fromLegacyCard($card);
        $scryfallId = is_string($card['scryfallId'] ?? null) && trim($card['scryfallId']) !== '' ? trim($card['scryfallId']) : null;
        $cardVersion = is_string($card['cardVersion'] ?? null) && trim($card['cardVersion']) !== ''
            ? trim($card['cardVersion'])
            : $bundle->cardVersion;
        $providedCardKey = is_string($card['cardKey'] ?? null) && trim($card['cardKey']) !== ''
            ? trim($card['cardKey'])
            : $cardKey;
        $canonicalCardKey = trim($providedCardKey) !== ''
            ? trim($providedCardKey)
            : ($scryfallId !== null
            ? $scryfallId.((bool) ($card['isToken'] ?? false) ? ':token' : ':card')
            : $cardKey);

        return [
            'cardRef' => $canonicalCardKey,
            'cardKey' => $canonicalCardKey,
            'printId' => $scryfallId ?? $cardKey,
            'cardVersion' => $cardVersion,
            'scryfallId' => $scryfallId,
            'name' => is_string($card['name'] ?? null) ? $card['name'] : null,
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : null,
            'cardFaces' => is_array($card['cardFaces'] ?? null) ? array_values($card['cardFaces']) : [],
            'typeLine' => is_string($card['typeLine'] ?? null) ? $card['typeLine'] : null,
            'manaCost' => is_string($card['manaCost'] ?? null) ? $card['manaCost'] : null,
            'colorIdentity' => is_array($card['colorIdentity'] ?? null) ? array_values($card['colorIdentity']) : [],
            'defaultPower' => $card['defaultPower'] ?? $baseStats['power'] ?? null,
            'defaultToughness' => $card['defaultToughness'] ?? $baseStats['toughness'] ?? null,
            'defaultLoyalty' => $card['defaultLoyalty'] ?? $baseStats['loyalty'] ?? null,
            'defaultDefense' => $card['defaultDefense'] ?? $baseStats['defense'] ?? null,
            'hasRulings' => (bool) ($card['hasRulings'] ?? ($card['layoutMetadata']['hasRulings'] ?? false)),
        ];
    }

    /**
     * @param array<string,mixed> $staticCard
     *
     * @return list<string>
     */
    private function staticCardAliases(array $staticCard): array
    {
        $scryfallId = is_string($staticCard['scryfallId'] ?? null) ? trim($staticCard['scryfallId']) : '';
        if ($scryfallId === '') {
            return [];
        }

        return [
            $scryfallId.':card',
            $scryfallId.':token',
        ];
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardKeyForStaticCard(array $card): string
    {
        if (is_string($card['cardKey'] ?? null) && trim($card['cardKey']) !== '') {
            return trim($card['cardKey']);
        }

        return CardStaticBundle::fromLegacyCard($card)->cardKey;
    }

    private function viewerVisibilityForZone(string $zone): string
    {
        return $zone === 'hand' || $zone === 'library' ? 'private' : 'public';
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private function runtimePatchVisibleToViewer(array $snapshot, string $visibility, string $viewerId): bool
    {
        if ($visibility === 'public') {
            return true;
        }
        if ($visibility === sprintf('player:%s', $viewerId)) {
            return true;
        }
        if (!str_starts_with($visibility, 'group:')) {
            return false;
        }

        $groupMask = (int) substr($visibility, strlen('group:'));
        if ($groupMask <= 0) {
            return false;
        }

        return ($groupMask & $this->viewerMask($snapshot, $viewerId)) !== 0;
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
        foreach ($phaseTimings as $phase => $value) {
            if (!is_string($phase) || isset($normalized[$phase]) || !is_numeric($value)) {
                continue;
            }

            $normalized[$phase] = round((float) $value, 2);
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
