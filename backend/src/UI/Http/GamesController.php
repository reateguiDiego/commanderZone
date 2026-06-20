<?php

namespace App\UI\Http;

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Application\Game\GameProjectionService;
use App\Application\Game\GameRematchService;
use App\Application\Game\Debug\GameDebugHealthLiveStore;
use App\Application\Game\Performance\GameplayMetricsInspector;
use App\Application\Game\Performance\GameplayMetricsRecorderInterface;
use App\Application\Game\WebSocket\GameWebsocketRoomRegistry;
use App\Application\Game\WebSocket\GameWebsocketTicketManager;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\User\User;
use App\Infrastructure\Realtime\GameEventPublisher;
use App\Infrastructure\Realtime\RoomEventPublisher;
use Doctrine\DBAL\Exception\DeadlockException;
use Doctrine\DBAL\Exception\LockWaitTimeoutException;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class GamesController extends ApiController
{
    private const MULLIGAN_COMMAND_TYPES = [
        'mulligan.take',
        'mulligan.keep',
        'mulligan.scry_confirm',
    ];

    #[Route('/games/{id}/snapshot', methods: ['GET'])]
    #[Route('/games/{id}/bootstrap', methods: ['GET'])]
    public function snapshot(
        string $id,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        GameProjectionService $projection,
        GameDebugHealthLiveStore $debugHealth,
        ?Request $request = null,
        ?GameplayV2ContractFactory $contractsV2 = null,
        ?GameplayV2Flags $flagsV2 = null,
    ): JsonResponse
    {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeViewedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $startedAt = microtime(true);
        $projectedSnapshot = $projection->project($game, $user);
        $debugObserved = $debugHealth->isObserved($game->id());
        if ($debugObserved) {
            $debugHealth->recordBootstrapStage(
                $game->id(),
                'initial_snapshot',
                $this->elapsedMs($startedAt),
                $this->bootstrapStageContext($game, $debugObserved),
            );
        }

        $bootstrapContractRequested = $request instanceof Request
            && str_ends_with($request->getPathInfo(), '/bootstrap')
            && strtolower(trim((string) $request->query->get('contract', ''))) === 'v2';
        if ($bootstrapContractRequested && ($flagsV2?->bootstrapEnabled() ?? false) && $contractsV2 instanceof GameplayV2ContractFactory) {
            return $this->json($contractsV2->bootstrap($game, $user, $projectedSnapshot)->toArray());
        }

        return $this->json([
            'game' => [
                ...$game->toArray(),
                'snapshot' => $projectedSnapshot,
            ],
        ]);
    }

    #[Route('/games/{id}/websocket-ticket', methods: ['POST'])]
    public function websocketTicket(
        string $id,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        GameWebsocketTicketManager $tickets,
        GameDebugHealthLiveStore $debugHealth,
        #[Autowire('%game_websocket_public_url%')]
        string $websocketPublicUrl,
    ): JsonResponse {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeViewedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $startedAt = microtime(true);
        $ticket = $tickets->issue($game->id(), $user->id());
        $debugObserved = $debugHealth->isObserved($game->id());
        if ($debugObserved) {
            $debugHealth->recordBootstrapStage(
                $game->id(),
                'websocket_ticket',
                $this->elapsedMs($startedAt),
                $this->bootstrapStageContext($game, $debugObserved),
            );
        }

        return $this->json([
            'ticket' => $ticket->ticket,
            'expiresAt' => $ticket->expiresAt->format(DATE_ATOM),
            'websocketUrl' => rtrim($websocketPublicUrl, '/').'/games/'.$game->id().'?ticket='.rawurlencode($ticket->ticket),
        ]);
    }

    #[Route('/games/{id}/debug/health', methods: ['GET'])]
    public function debugHealth(
        string $id,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        GameDebugHealthLiveStore $debugHealth,
    ): JsonResponse {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeViewedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $report = $debugHealth->reportForGame($game->id());

        return $this->json([
            'gameId' => $game->id(),
            'enabled' => true,
            'context' => $this->debugHealthContext($game, (bool) ($report['enabled'] ?? false)),
            'health' => $report['health'] ?? [],
            'generatedAt' => $report['generatedAt'] ?? (new \DateTimeImmutable())->format(DATE_ATOM),
            'updatedAt' => $report['updatedAt'] ?? (new \DateTimeImmutable())->format(DATE_ATOM),
        ]);
    }

    /**
     * @return array{
     *     players: list<array{playerId: string, displayName: string, deckName: ?string, status: string}>,
     *     viewerCount: int,
     *     languageCount: int,
     *     uniqueCardCount: int,
     *     uniqueScryfallIdCount: int,
     *     debugObserved: bool,
     *     usingLegacyLocalizationFallback: null
     * }
     */
    private function debugHealthContext(Game $game, bool $debugObserved): array
    {
        $players = [];
        $snapshotPlayers = $game->snapshot()['players'] ?? [];
        if (!is_array($snapshotPlayers)) {
            return [
                'players' => [],
                'viewerCount' => 0,
                'languageCount' => 0,
                'uniqueCardCount' => 0,
                'uniqueScryfallIdCount' => 0,
                'debugObserved' => $debugObserved,
                'usingLegacyLocalizationFallback' => null,
            ];
        }

        $languages = [];
        foreach ($snapshotPlayers as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player)) {
                continue;
            }

            $user = is_array($player['user'] ?? null) ? $player['user'] : [];
            $displayName = is_string($user['displayName'] ?? null) && trim($user['displayName']) !== ''
                ? trim($user['displayName'])
                : $playerId;

            $players[] = [
                'playerId' => $playerId,
                'displayName' => $displayName,
                'deckName' => is_string($player['deckName'] ?? null) && trim($player['deckName']) !== '' ? trim($player['deckName']) : null,
                'status' => is_string($player['status'] ?? null) && trim($player['status']) !== '' ? trim($player['status']) : 'active',
            ];
        }

        $ownerLanguage = $this->normalizedCardLanguage($game->room()->owner());
        if ($ownerLanguage !== null) {
            $languages[$ownerLanguage] = true;
        }
        foreach ($game->room()->orderedPlayers() as $roomPlayer) {
            $language = $this->normalizedCardLanguage($roomPlayer->user());
            if ($language !== null) {
                $languages[$language] = true;
            }
        }

        return [
            'players' => $players,
            'viewerCount' => count($players),
            'languageCount' => count($languages),
            'uniqueCardCount' => $this->uniqueSnapshotCardCount($game->snapshot()),
            'uniqueScryfallIdCount' => $this->uniqueSnapshotScryfallIdCount($game->snapshot()),
            'debugObserved' => $debugObserved,
            'usingLegacyLocalizationFallback' => null,
        ];
    }

    /**
     * @return array{
     *     viewerCount: int,
     *     languageCount: int,
     *     uniqueCardCount: int,
     *     uniqueScryfallIdCount: int,
     *     debugObserved: bool,
     *     usingLegacyLocalizationFallback: null
     * }
     */
    private function bootstrapStageContext(Game $game, bool $debugObserved): array
    {
        $context = $this->debugHealthContext($game, $debugObserved);

        return [
            'viewerCount' => $context['viewerCount'],
            'languageCount' => $context['languageCount'],
            'uniqueCardCount' => $context['uniqueCardCount'],
            'uniqueScryfallIdCount' => $context['uniqueScryfallIdCount'],
            'debugObserved' => $context['debugObserved'],
            'usingLegacyLocalizationFallback' => $context['usingLegacyLocalizationFallback'],
        ];
    }

    private function normalizedCardLanguage(User $user): ?string
    {
        $language = trim((string) $user->cardLanguage());

        return $language !== '' ? strtolower($language) : null;
    }

    private function uniqueSnapshotCardCount(array $snapshot): int
    {
        $cards = [];
        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return 0;
        }

        foreach ($players as $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            foreach ($player['zones'] as $zoneCards) {
                if (!is_array($zoneCards)) {
                    continue;
                }

                foreach ($zoneCards as $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $instanceId = trim((string) ($card['instanceId'] ?? ''));
                    if ($instanceId !== '') {
                        $cards[$instanceId] = true;
                    }
                }
            }
        }

        return count($cards);
    }

    private function uniqueSnapshotScryfallIdCount(array $snapshot): int
    {
        $scryfallIds = [];
        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return 0;
        }

        foreach ($players as $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            foreach ($player['zones'] as $zoneCards) {
                if (!is_array($zoneCards)) {
                    continue;
                }

                foreach ($zoneCards as $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
                    if ($scryfallId !== '') {
                        $scryfallIds[$scryfallId] = true;
                    }
                }
            }
        }

        return count($scryfallIds);
    }

    private function elapsedMs(float $startedAt): float
    {
        return round(max(0, (microtime(true) - $startedAt) * 1000), 2);
    }

    #[Route('/games/{id}/commands', methods: ['POST'])]
    public function command(
        string $id,
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        GameCommandHandler $handler,
        GameProjectionService $projection,
        GameEventPublisher $publisher,
        GameplayMetricsRecorderInterface $metrics,
        GameplayMetricsInspector $metricsInspector,
    ): JsonResponse
    {
        $startedAt = microtime(true);
        $usageStartedAt = $metricsInspector->usageSnapshot();
        $snapshotLoadStartedAt = microtime(true);
        $game = $entityManager->getRepository(Game::class)->find($id);
        $snapshotLoadMs = $this->elapsedMs($snapshotLoadStartedAt);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeControlledBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $snapshotBytesBefore = $metricsInspector->jsonBytes($game->snapshot());
        $snapshotBytesAfter = $snapshotBytesBefore;
        $numberOfPlayers = $metricsInspector->countPlayers($game->snapshot());
        $numberOfInstances = $metricsInspector->countInstances($game->snapshot());
        $numberOfVisibleCards = 0;
        $normalizeMs = 0.0;
        $commandApplyMs = 0.0;
        $persistMs = 0.0;
        $projectionMs = 0.0;
        $duplicate = false;
        $projectedSnapshot = null;

        $payload = $this->payload($request);
        $type = trim((string) ($payload['type'] ?? ''));
        if ($type === '') {
            return $this->fail('Command type is required.');
        }
        if (!GameCommandHandler::isSupportedCommand($type)) {
            return $this->fail(sprintf('Unknown game command: %s', $type));
        }
        if ($game->status() === Game::STATUS_FINISHED && !GameCommandHandler::isAllowedWhenFinished($type)) {
            return $this->fail(sprintf('Game is finished. Command not allowed: %s', $type), 409);
        }

        $clientActionId = isset($payload['clientActionId']) && is_string($payload['clientActionId']) && trim($payload['clientActionId']) !== ''
            ? trim($payload['clientActionId'])
            : null;
        if ($clientActionId !== null) {
            $existingEvent = $entityManager->getRepository(GameEvent::class)->findOneBy([
                'game' => $game,
                'clientActionId' => $clientActionId,
            ]);
            if ($existingEvent instanceof GameEvent) {
                $duplicate = true;
                $projectionStartedAt = microtime(true);
                $projectedSnapshot = $projection->project($game, $user);
                $projectionMs = $this->elapsedMs($projectionStartedAt);
                $numberOfVisibleCards = $metricsInspector->countVisibleCards($projectedSnapshot);
                $this->recordGameplayMetric(
                    $metrics,
                    $metricsInspector,
                    [
                        'transport' => 'http',
                        'command.type' => $type,
                        'gameId' => $game->id(),
                        'snapshot_load_ms' => $snapshotLoadMs,
                        'normalize_ms' => $normalizeMs,
                        'command_apply_ms' => $commandApplyMs,
                        'persist_ms' => $persistMs,
                        'projection_ms' => $projectionMs,
                        'patch_build_ms' => 0.0,
                        'total_server_ms' => $this->elapsedMs($startedAt),
                        'snapshot_bytes_before' => $snapshotBytesBefore,
                        'snapshot_bytes_after' => $snapshotBytesAfter,
                        'patch_bytes' => 0,
                        'number_of_players' => $numberOfPlayers,
                        'number_of_instances' => $numberOfInstances,
                        'number_of_visible_cards' => $numberOfVisibleCards,
                        'resync_required' => false,
                        'clientActionId_duplicate' => $duplicate,
                        'status' => 'duplicate',
                    ],
                    $usageStartedAt,
                );

                return $this->existingEventResponse($existingEvent, $game, $user, $projection, $projectedSnapshot);
            }
        }

        $event = null;
        try {
            $entityManager->beginTransaction();
            $entityManager->lock($game, LockMode::PESSIMISTIC_WRITE);
            if ($game->status() === Game::STATUS_FINISHED && !GameCommandHandler::isAllowedWhenFinished($type)) {
                $entityManager->rollback();

                return $this->fail(sprintf('Game is finished. Command not allowed: %s', $type), 409);
            }
            if ($clientActionId !== null) {
                $existingEvent = $entityManager->getRepository(GameEvent::class)->findOneBy([
                    'game' => $game,
                    'clientActionId' => $clientActionId,
                ]);
                if ($existingEvent instanceof GameEvent) {
                    $entityManager->rollback();

                    return $this->existingEventResponse($existingEvent, $game, $user, $projection);
                }
            }

            $event = $handler->apply($game, $type, is_array($payload['payload'] ?? null) ? $payload['payload'] : [], $user, $clientActionId);
            $handlerMetrics = $handler->consumeLastCommandMetrics() ?? [];
            $normalizeMs = (float) ($handlerMetrics['normalize_ms'] ?? 0.0);
            $commandApplyMs = (float) ($handlerMetrics['command_apply_ms'] ?? 0.0);
            $snapshotBytesAfter = (int) ($handlerMetrics['snapshot_bytes_after'] ?? $snapshotBytesBefore);
            $numberOfPlayers = (int) ($handlerMetrics['number_of_players'] ?? $numberOfPlayers);
            $numberOfInstances = (int) ($handlerMetrics['number_of_instances'] ?? $numberOfInstances);
            $persistStartedAt = microtime(true);
            $entityManager->persist($event);
            $entityManager->flush();
            $entityManager->commit();
            $persistMs = $this->elapsedMs($persistStartedAt);
        } catch (\InvalidArgumentException $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            $handlerMetrics = $handler->consumeLastCommandMetrics() ?? [];
            $normalizeMs = (float) ($handlerMetrics['normalize_ms'] ?? 0.0);
            $commandApplyMs = (float) ($handlerMetrics['command_apply_ms'] ?? 0.0);
            $snapshotBytesAfter = (int) ($handlerMetrics['snapshot_bytes_after'] ?? $snapshotBytesBefore);
            $numberOfPlayers = (int) ($handlerMetrics['number_of_players'] ?? $numberOfPlayers);
            $numberOfInstances = (int) ($handlerMetrics['number_of_instances'] ?? $numberOfInstances);
            $this->recordGameplayMetric(
                $metrics,
                $metricsInspector,
                [
                    'transport' => 'http',
                    'command.type' => $type,
                    'gameId' => $game->id(),
                    'snapshot_load_ms' => $snapshotLoadMs,
                    'normalize_ms' => $normalizeMs,
                    'command_apply_ms' => $commandApplyMs,
                    'persist_ms' => $persistMs,
                    'projection_ms' => 0.0,
                    'patch_build_ms' => 0.0,
                    'total_server_ms' => $this->elapsedMs($startedAt),
                    'snapshot_bytes_before' => $snapshotBytesBefore,
                    'snapshot_bytes_after' => $snapshotBytesAfter,
                    'patch_bytes' => 0,
                    'number_of_players' => $numberOfPlayers,
                    'number_of_instances' => $numberOfInstances,
                    'number_of_visible_cards' => $numberOfVisibleCards,
                    'resync_required' => false,
                    'clientActionId_duplicate' => false,
                    'status' => 'rejected',
                ],
                $usageStartedAt,
            );

            return $this->fail($exception->getMessage());
        } catch (UniqueConstraintViolationException) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }
            $existingEvent = $clientActionId === null
                ? null
                : $entityManager->getRepository(GameEvent::class)->findOneBy([
                    'game' => $game,
                    'clientActionId' => $clientActionId,
                ]);
            if ($existingEvent instanceof GameEvent) {
                $duplicate = true;
                $projectionStartedAt = microtime(true);
                $projectedSnapshot = $projection->project($game, $user);
                $projectionMs = $this->elapsedMs($projectionStartedAt);
                $numberOfVisibleCards = $metricsInspector->countVisibleCards($projectedSnapshot);
                $this->recordGameplayMetric(
                    $metrics,
                    $metricsInspector,
                    [
                        'transport' => 'http',
                        'command.type' => $type,
                        'gameId' => $game->id(),
                        'snapshot_load_ms' => $snapshotLoadMs,
                        'normalize_ms' => $normalizeMs,
                        'command_apply_ms' => $commandApplyMs,
                        'persist_ms' => $persistMs,
                        'projection_ms' => $projectionMs,
                        'patch_build_ms' => 0.0,
                        'total_server_ms' => $this->elapsedMs($startedAt),
                        'snapshot_bytes_before' => $snapshotBytesBefore,
                        'snapshot_bytes_after' => $snapshotBytesAfter,
                        'patch_bytes' => 0,
                        'number_of_players' => $numberOfPlayers,
                        'number_of_instances' => $numberOfInstances,
                        'number_of_visible_cards' => $numberOfVisibleCards,
                        'resync_required' => false,
                        'clientActionId_duplicate' => true,
                        'status' => 'duplicate',
                    ],
                    $usageStartedAt,
                );

                return $this->existingEventResponse($existingEvent, $game, $user, $projection, $projectedSnapshot);
            }

            $this->recordGameplayMetric(
                $metrics,
                $metricsInspector,
                [
                    'transport' => 'http',
                    'command.type' => $type,
                    'gameId' => $game->id(),
                    'snapshot_load_ms' => $snapshotLoadMs,
                    'normalize_ms' => $normalizeMs,
                    'command_apply_ms' => $commandApplyMs,
                    'persist_ms' => $persistMs,
                    'projection_ms' => 0.0,
                    'patch_build_ms' => 0.0,
                    'total_server_ms' => $this->elapsedMs($startedAt),
                    'snapshot_bytes_before' => $snapshotBytesBefore,
                    'snapshot_bytes_after' => $snapshotBytesAfter,
                    'patch_bytes' => 0,
                    'number_of_players' => $numberOfPlayers,
                    'number_of_instances' => $numberOfInstances,
                    'number_of_visible_cards' => $numberOfVisibleCards,
                    'resync_required' => true,
                    'clientActionId_duplicate' => false,
                    'status' => 'conflict',
                ],
                $usageStartedAt,
            );

            return $this->fail('Command conflict. Please retry.', 409);
        } catch (DeadlockException|LockWaitTimeoutException) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            $this->recordGameplayMetric(
                $metrics,
                $metricsInspector,
                [
                    'transport' => 'http',
                    'command.type' => $type,
                    'gameId' => $game->id(),
                    'snapshot_load_ms' => $snapshotLoadMs,
                    'normalize_ms' => $normalizeMs,
                    'command_apply_ms' => $commandApplyMs,
                    'persist_ms' => $persistMs,
                    'projection_ms' => 0.0,
                    'patch_build_ms' => 0.0,
                    'total_server_ms' => $this->elapsedMs($startedAt),
                    'snapshot_bytes_before' => $snapshotBytesBefore,
                    'snapshot_bytes_after' => $snapshotBytesAfter,
                    'patch_bytes' => 0,
                    'number_of_players' => $numberOfPlayers,
                    'number_of_instances' => $numberOfInstances,
                    'number_of_visible_cards' => $numberOfVisibleCards,
                    'resync_required' => true,
                    'clientActionId_duplicate' => false,
                    'status' => 'conflict',
                ],
                $usageStartedAt,
            );

            return $this->fail('Game command conflict. Please retry.', 409);
        } catch (\Throwable $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            throw $exception;
        }

        if (!$event instanceof GameEvent) {
            return $this->fail('Could not apply game command.', 500);
        }

        if (!in_array($type, self::MULLIGAN_COMMAND_TYPES, true)) {
            $publisher->publish($game, $event);
        }

        $projectionStartedAt = microtime(true);
        $projectedSnapshot = $projection->project($game, $user);
        $projectionMs = $this->elapsedMs($projectionStartedAt);
        $numberOfVisibleCards = $metricsInspector->countVisibleCards($projectedSnapshot);
        $this->recordGameplayMetric(
            $metrics,
            $metricsInspector,
            [
                'transport' => 'http',
                'command.type' => $type,
                'gameId' => $game->id(),
                'snapshot_load_ms' => $snapshotLoadMs,
                'normalize_ms' => $normalizeMs,
                'command_apply_ms' => $commandApplyMs,
                'persist_ms' => $persistMs,
                'projection_ms' => $projectionMs,
                'patch_build_ms' => 0.0,
                'total_server_ms' => $this->elapsedMs($startedAt),
                'snapshot_bytes_before' => $snapshotBytesBefore,
                'snapshot_bytes_after' => $snapshotBytesAfter,
                'patch_bytes' => 0,
                'number_of_players' => $numberOfPlayers,
                'number_of_instances' => $numberOfInstances,
                'number_of_visible_cards' => $numberOfVisibleCards,
                'resync_required' => false,
                'clientActionId_duplicate' => false,
                'status' => 'applied',
            ],
            $usageStartedAt,
        );

        return $this->json([
            'event' => $event->toArray(),
            'snapshot' => $projectedSnapshot,
            'version' => $game->snapshot()['version'] ?? null,
            'applied' => true,
        ], 201);
    }

    #[Route('/games/{id}/rematch-vote', methods: ['POST'])]
    public function rematchVote(
        string $id,
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        GameProjectionService $projection,
        GameRematchService $rematch,
        GameEventPublisher $gamePublisher,
        RoomEventPublisher $roomPublisher,
    ): JsonResponse {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeViewedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }
        if (!$game->room()->hasPlayer($user)) {
            return $this->fail('Only room players can vote for a rematch.', 403);
        }

        $payload = $this->payload($request);
        $vote = (string) ($payload['vote'] ?? '');
        $event = null;
        $room = $game->room();
        $roomDeleted = false;
        $roomReady = false;
        $projectedSnapshot = null;

        try {
            $entityManager->beginTransaction();
            $entityManager->lock($game, LockMode::PESSIMISTIC_WRITE);

            if ($vote === GameRematchService::VOTE_LEAVE && $room->players()->count() === 1) {
                $room->removeUser($user);
                $roomDeleted = true;
                $this->removeRoomWithGame($room, $entityManager);
            } else {
                $recorded = $rematch->recordVote($game, $user, $vote);
                $event = $recorded['event'];
                $snapshot = $recorded['snapshot'];
                $entityManager->persist($event);

                if ($vote === GameRematchService::VOTE_LEAVE) {
                    $room->removeUser($user);
                    if ($room->players()->count() === 0) {
                        $roomDeleted = true;
                        $this->removeRoomWithGame($room, $entityManager);
                    } else {
                        $roomReady = $this->returnRoomToWaitingIfRematchReady($room, $game, $snapshot, $rematch, $entityManager);
                    }
                } elseif ($rematch->shouldWaitForGameEnd($snapshot, $user)) {
                    $projectedSnapshot = $projection->projectSnapshot($snapshot, $user);
                } else {
                    $roomReady = $this->returnRoomToWaitingIfRematchReady($room, $game, $snapshot, $rematch, $entityManager);
                    if (!$roomReady) {
                        $projectedSnapshot = $projection->projectSnapshot($snapshot, $user);
                    }
                }
            }

            $entityManager->flush();
            $entityManager->commit();
        } catch (\InvalidArgumentException $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            return $this->fail($exception->getMessage());
        } catch (\Throwable $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            throw $exception;
        }

        if ($event instanceof GameEvent && !$roomDeleted && !$roomReady) {
            $gamePublisher->publish($game, $event);
        }
        if ($vote === GameRematchService::VOTE_LEAVE && !$roomDeleted) {
            $roomPublisher->publish($room, 'room.player.left');
        }
        if ($roomDeleted) {
            $roomPublisher->publishDeleted($room->id());

            return $this->json([
                'status' => GameRematchService::STATUS_ROOM_DELETED,
                'left' => true,
                'roomDeleted' => true,
            ]);
        }
        if ($roomReady) {
            $gamePublisher->publishRematchCreated($game, $room, $user);
            $roomPublisher->publish($room, 'room.rematch.created');

            return $this->json([
                'status' => GameRematchService::STATUS_ROOM_READY,
                'room' => $room->toArray(),
            ]);
        }
        if ($vote === GameRematchService::VOTE_LEAVE) {
            return $this->json([
                'status' => GameRematchService::STATUS_LEFT,
                'left' => true,
                'roomDeleted' => false,
            ]);
        }

        $status = GameRematchService::STATUS_WAITING_FOR_VOTES;
        $message = null;
        if ($projectedSnapshot !== null && $rematch->shouldWaitForGameEnd($projectedSnapshot, $user)) {
            $status = GameRematchService::STATUS_WAITING_FOR_GAME_END;
            $message = 'Tu voto se ha guardado. Espera a que termine la partida.';
        }

        return $this->json([
            'status' => $status,
            'message' => $message,
            'event' => $event?->toArray(),
            'snapshot' => $projectedSnapshot,
            'version' => $projectedSnapshot['version'] ?? null,
        ]);
    }

    #[Route('/games/{id}/disconnect-vote', methods: ['POST'])]
    public function disconnectVote(
        string $id,
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        GameProjectionService $projection,
        GameDisconnectVoteService $disconnectVotes,
        GameWebsocketRoomRegistry $rooms,
        GameEventPublisher $gamePublisher,
        RoomEventPublisher $roomPublisher,
    ): JsonResponse {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeControlledBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $payload = $this->payload($request);
        $targetPlayerId = trim((string) ($payload['targetPlayerId'] ?? ''));
        $vote = trim((string) ($payload['vote'] ?? ''));
        if ($targetPlayerId === '' || $vote === '') {
            return $this->fail('targetPlayerId and vote are required.');
        }

        $room = $game->room();
        $roomDeleted = false;
        $event = null;
        try {
            $entityManager->beginTransaction();
            $entityManager->lock($game, LockMode::PESSIMISTIC_WRITE);
            $recorded = $disconnectVotes->recordVote(
                $game,
                $user,
                $targetPlayerId,
                $vote,
                array_values(array_unique([...$rooms->connectedUserIdsForGame($game->id()), $user->id()])),
            );
            $event = $recorded['event'];
            $entityManager->persist($event);
            if ($room->players()->count() === 0) {
                $roomDeleted = true;
                $this->removeRoomWithGame($room, $entityManager);
            }
            $entityManager->flush();
            $entityManager->commit();
        } catch (\InvalidArgumentException $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            return $this->fail($exception->getMessage());
        } catch (\Throwable $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            throw $exception;
        }

        if ($event instanceof GameEvent && !$roomDeleted) {
            $gamePublisher->publish($game, $event);
        }
        if ($roomDeleted) {
            $roomPublisher->publishDeleted($room->id());

            return $this->json([
                'status' => 'room_deleted',
                'roomDeleted' => true,
            ]);
        }

        return $this->json([
            'status' => 'recorded',
            'event' => $event->toArray(),
            'snapshot' => $projection->project($game, $user),
            'version' => $game->snapshot()['version'] ?? null,
        ], 201);
    }

    #[Route('/games/{id}/events', methods: ['GET'])]
    public function events(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeViewedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $limit = max(1, min(500, (int) $request->query->get('limit', 200)));
        $after = $request->query->get('after');
        $afterDate = null;
        if (is_string($after) && $after !== '') {
            try {
                $afterDate = new \DateTimeImmutable($after);
            } catch (\Exception) {
                return $this->fail('after must be a valid ISO-8601 date-time.');
            }
        }

        $queryBuilder = $entityManager->getRepository(\App\Domain\Game\GameEvent::class)->createQueryBuilder('event')
            ->where('event.game = :game')
            ->setParameter('game', $game)
            ->orderBy('event.createdAt', 'ASC')
            ->setMaxResults($limit);

        if ($afterDate instanceof \DateTimeImmutable) {
            $queryBuilder
                ->andWhere('event.createdAt > :after')
                ->setParameter('after', $afterDate);
        }

        return $this->json([
            'data' => array_map(
                static fn (\App\Domain\Game\GameEvent $event) => $event->toArray(),
                $queryBuilder->getQuery()->getResult(),
            ),
            'limit' => $limit,
        ]);
    }

    #[Route('/games/{id}/zones/{playerId}/{zone}', methods: ['GET'])]
    public function zone(string $id, string $playerId, string $zone, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, GameProjectionService $projection, GameCommandHandler $normalizer): JsonResponse
    {
        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (!$game->canBeViewedBy($user)) {
            return $this->fail('Game access denied.', 403);
        }

        $snapshot = $normalizer->normalizeSnapshot($game->snapshot());
        if (!isset($snapshot['players'][$playerId]['zones'][$zone])) {
            return $this->fail('Zone not found.', 404);
        }

        $cards = [];
        if (!(($snapshot['gamePhase'] ?? null) === 'MULLIGAN' && $zone === 'library')) {
            $cards = $projection->projectZone(
                $snapshot['players'][$playerId]['zones'][$zone],
                $playerId,
                $zone,
                $user,
                ($snapshot['players'][$playerId]['playTopLibraryRevealed'] ?? false) === true,
                playerState: is_array($snapshot['players'][$playerId] ?? null) ? $snapshot['players'][$playerId] : null,
            );
        }
        $type = mb_strtolower(trim((string) $request->query->get('type', '')));
        $search = mb_strtolower(trim((string) $request->query->get('search', '')));

        if ($type !== '') {
            $cards = array_values(array_filter($cards, static fn (array $card): bool => str_contains(mb_strtolower((string) ($card['typeLine'] ?? '')), $type)));
        }
        if ($search !== '') {
            $cards = array_values(array_filter($cards, static fn (array $card): bool => str_contains(mb_strtolower((string) ($card['name'] ?? '')), $search)));
        }

        $limit = max(1, min(200, (int) $request->query->get('limit', 100)));
        $offset = max(0, (int) $request->query->get('offset', 0));

        return $this->json([
            'gameId' => $game->id(),
            'playerId' => $playerId,
            'zone' => $zone,
            'total' => count($cards),
            'data' => array_slice($cards, $offset, $limit),
        ]);
    }

    private function existingEventResponse(
        GameEvent $event,
        Game $game,
        User $user,
        GameProjectionService $projection,
        ?array $projectedSnapshot = null,
    ): JsonResponse
    {
        $projectedSnapshot ??= $projection->project($game, $user);

        return $this->json([
            'event' => $event->toArray(),
            'snapshot' => $projectedSnapshot,
            'version' => $game->snapshot()['version'] ?? null,
            'applied' => false,
        ]);
    }

    /**
     * @param array<string,mixed> $metric
     * @param array<string,int>|null $usageStartedAt
     */
    private function recordGameplayMetric(
        GameplayMetricsRecorderInterface $metrics,
        GameplayMetricsInspector $metricsInspector,
        array $metric,
        ?array $usageStartedAt,
    ): void {
        $metrics->record([
            ...$metric,
            'memory_peak_bytes' => $metricsInspector->memoryPeakBytes(),
            ...$metricsInspector->cpuDiffMs($usageStartedAt),
        ]);
    }

    private function removeRoomWithGame(Room $room, EntityManagerInterface $entityManager): void
    {
        $game = $room->game();
        if ($game instanceof Game) {
            $room->detachGame();
            $entityManager->flush();
            $entityManager->remove($game);
            $entityManager->flush();
        }

        $entityManager->remove($room);
    }

    private function returnRoomToWaitingIfRematchReady(
        Room $room,
        Game $game,
        array $snapshot,
        GameRematchService $rematch,
        EntityManagerInterface $entityManager,
    ): bool {
        if (!$rematch->allSnapshotPlayersHaveVoted($snapshot) || $rematch->activeLifePlayerCount($snapshot) > 1) {
            return false;
        }

        $eligiblePlayerIds = $rematch->eligiblePlayAgainPlayerIds($room, $snapshot);
        if (count($eligiblePlayerIds) < Room::MIN_PLAYERS) {
            return false;
        }

        $owner = $rematch->rematchOwner($room, $eligiblePlayerIds);
        $room->returnToWaitingForRematch($owner, $eligiblePlayerIds);
        $entityManager->remove($game);

        return true;
    }
}
