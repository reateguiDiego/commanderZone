<?php

namespace App\Application\Game\WebSocket;

use App\Application\Game\Compact\CardStaticBundle;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameEventStoreV2;
use App\Application\Game\GameLibraryOps;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\Performance\GameplayMetricsInspector;
use App\Application\Game\Runtime\GameRuntimeMulliganClientInterface;
use App\Application\Game\Runtime\GameRuntimeGatewayException;
use App\Application\Game\Runtime\GameRuntimeMulliganException;
use App\Application\Game\Runtime\GameRuntimeMulliganResult;
use App\Application\Game\Runtime\GameplayRuntimePatchContractException;
use App\Application\Game\Runtime\GameplayRuntimePatchAdapter;
use App\Application\Game\Runtime\GameplayRuntimeRoute;
use App\Application\Game\Runtime\GameplayRuntimeRouter;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\DBAL\Exception\DeadlockException;
use Doctrine\DBAL\Exception\LockWaitTimeoutException;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\Persistence\ManagerRegistry;

final readonly class GameWebsocketMulliganService
{
    private const CLIENT_EVENTS = [
        'mulligan.take',
        'mulligan.keep',
        'mulligan.scry.confirm',
    ];
    private const GAME_PHASE_MULLIGAN = 'MULLIGAN';
    private const GAME_PHASE_PLAYING = 'PLAYING';

    public function __construct(
        private GameCommandHandler $commands,
        private ManagerRegistry $managerRegistry,
        private ?GameplayMetricsInspector $metricsInspector = null,
        private ?GameplayV2Flags $flags = null,
        private ?GameRuntimeMulliganClientInterface $runtimeClient = null,
        private ?GameplayRuntimeRouter $runtimeRouter = null,
        private ?GameplayRuntimePatchAdapter $runtimePatchAdapter = null,
        private ?GameEventStoreV2 $eventStoreV2 = null,
    ) {
    }

    public function supports(string $kind): bool
    {
        return in_array($kind, self::CLIENT_EVENTS, true);
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function initialStateMessages(string $gameId, string $userId): array
    {
        $manager = $this->manager();
        try {
            $game = $manager->getRepository(Game::class)->find($gameId);
            $viewer = $manager->getRepository(User::class)->find($userId);
            if (!$game instanceof Game || !$viewer instanceof User || !$game->canBeViewedBy($viewer)) {
                return [];
            }

            $this->hydrateRuntimeEvents($game);
            $snapshot = $this->commands->normalizeSnapshot($game->snapshot());
            if (($snapshot['gamePhase'] ?? null) !== self::GAME_PHASE_MULLIGAN) {
                return [];
            }

            $messages = [$this->publicState($game->id(), $snapshot, null)];
            if ($game->canBeControlledBy($viewer)) {
                $playerId = $this->playerId($snapshot, $viewer->id());
                if ($playerId !== null) {
                    $messages[] = $this->privateState($game->id(), $snapshot, $playerId, null);
                }
            }

            return $messages;
        } finally {
            $manager->clear();
        }
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array<string,mixed>|GameWebsocketCommandResult
     */
    public function handle(string $kind, array $payload, GameWebsocketPeer $peer, ?string $messageId = null): array|GameWebsocketCommandResult
    {
        $gameId = is_string($payload['gameId'] ?? null) ? trim($payload['gameId']) : '';
        if ($gameId === '' || $gameId !== $peer->gameId) {
            return $this->error($peer->gameId, 'NOT_IN_GAME', 'Game access denied.', $messageId);
        }

        $manager = $this->manager();
        try {
            $game = $manager->getRepository(Game::class)->find($gameId);
            $actor = $manager->getRepository(User::class)->find($peer->userId);
            if (!$game instanceof Game || !$actor instanceof User || !$game->canBeViewedBy($actor)) {
                return $this->error($peer->gameId, 'NOT_IN_GAME', 'Game access denied.', $messageId);
            }
            if (!$game->canBeControlledBy($actor)) {
                return $this->error($game->id(), 'SPECTATOR_NOT_ALLOWED', 'Spectators cannot perform mulligan actions.', $messageId);
            }

            $this->hydrateRuntimeEvents($game);
            $snapshot = $this->commands->normalizeSnapshot($game->snapshot());
            $playerId = $this->playerId($snapshot, $actor->id());
            if ($playerId === null) {
                return $this->error($game->id(), 'NOT_IN_GAME', 'Game access denied.', $messageId);
            }
            if (($snapshot['gamePhase'] ?? null) !== self::GAME_PHASE_MULLIGAN) {
                return $this->error($game->id(), 'GAME_NOT_IN_MULLIGAN_PHASE', 'Game is not in mulligan phase.', $messageId, $this->snapshotVersion($game));
            }

            $status = (string) ($snapshot['players'][$playerId]['mulligan']['status'] ?? 'DECIDING');
            if ($status === 'READY' && in_array($kind, ['mulligan.take', 'mulligan.keep'], true)) {
                return $this->error($game->id(), 'ALREADY_READY', 'Player is already ready.', $messageId, $this->snapshotVersion($game));
            }
            if ($kind === 'mulligan.scry.confirm' && $status === 'READY') {
                return $this->error($game->id(), 'ALREADY_READY', 'Player is already ready.', $messageId, $this->snapshotVersion($game));
            }

            $previousVersion = $this->snapshotVersion($game);
            $clientActionId = $this->clientActionId($kind, $actor, $messageId);

            $runtimeFallbackDebug = [];
            if ($this->runtimePrimaryEnabled($kind)) {
                try {
                    return $this->runtimeResult(
                        $game,
                        $actor,
                        $this->runtimeClient()->dispatch($kind, $game->id(), $actor->id(), $previousVersion, $clientActionId, $payload),
                        $messageId,
                    );
                } catch (GameRuntimeGatewayException $exception) {
                    $runtimeFallbackDebug = [
                        'gameplay.runtime_route' => 0.0,
                        'gameplay.runtime_fallback_count' => 1.0,
                        'gameplay.runtime_error_count' => 1.0,
                        'gameplay.runtime_patch_contract_error' => $exception instanceof GameplayRuntimePatchContractException ? 1.0 : 0.0,
                        'mulligan.runtime_route' => 0.0,
                        'mulligan.runtime_fallback_count' => 1.0,
                        'mulligan.runtime_error_count' => 1.0,
                    ];
                }
            }

            $manager->beginTransaction();
            $manager->lock($game, LockMode::PESSIMISTIC_WRITE);

            $this->hydrateRuntimeEvents($game);
            $snapshot = $this->commands->normalizeSnapshot($game->snapshot());
            $existingEvent = $manager->getRepository(GameEvent::class)->findOneBy([
                'game' => $game,
                'clientActionId' => $clientActionId,
            ]);
            if ($existingEvent instanceof GameEvent) {
                $manager->rollback();

                return $this->error($game->id(), 'INVALID_MULLIGAN_STATE', 'Duplicate mulligan action ignored.', $messageId, $previousVersion);
            }

            $handlerType = $this->handlerType($kind);
            $handlerPayload = $this->handlerPayload($kind, $payload);
            try {
                $event = $this->commands->apply($game, $handlerType, $handlerPayload, $actor, $clientActionId);
            } catch (\InvalidArgumentException $exception) {
                $manager->rollback();

                $error = $this->error(
                    $game->id(),
                    $this->errorCode($exception->getMessage(), $kind),
                    $exception->getMessage(),
                    $messageId,
                    $previousVersion,
                );

                if ($runtimeFallbackDebug !== []) {
                    return GameWebsocketCommandResult::forViewerMessageLists(
                        [$actor->id() => [$error]],
                        [],
                        [
                            ...$runtimeFallbackDebug,
                            ...$this->mulliganDebugProfile([], [$error]),
                            'mulligan.runtime_shadow_executed' => 0.0,
                            'mulligan.runtime_shadow_divergence' => 0.0,
                        ],
                    );
                }

                return $error;
            }

            $manager->persist($event);
            $manager->flush();
            $manager->commit();

            $legacyResult = $this->result($game, $actor, $event, $messageId, $runtimeFallbackDebug);

            return $this->shadowCompare($kind, $game, $actor, $previousVersion, $clientActionId, $payload, $legacyResult);
        } catch (UniqueConstraintViolationException) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }

            return $this->error($gameId, 'INVALID_MULLIGAN_STATE', 'Duplicate mulligan action ignored.', $messageId);
        } catch (DeadlockException|LockWaitTimeoutException) {
            if ($manager->getConnection()->isTransactionActive()) {
                $manager->rollback();
            }

            return $this->error($gameId, 'INVALID_MULLIGAN_STATE', 'Mulligan action conflicted. Please retry.', $messageId);
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
            throw new \RuntimeException('Game WebSocket mulligan requires Doctrine ORM entity manager.');
        }

        return $manager;
    }

    private function runtimePrimaryEnabled(string $kind): bool
    {
        return $this->runtimeClient instanceof GameRuntimeMulliganClientInterface
            && $this->runtimeRoute($kind) === GameplayRuntimeRoute::RuntimePrimary;
    }

    private function runtimeShadowEnabled(string $kind): bool
    {
        return $this->runtimeClient instanceof GameRuntimeMulliganClientInterface
            && $this->runtimeRoute($kind) === GameplayRuntimeRoute::Shadow;
    }

    private function runtimeRoute(string $kind): GameplayRuntimeRoute
    {
        if ($this->runtimeRouter instanceof GameplayRuntimeRouter) {
            return $this->runtimeRouter->routeFor($kind);
        }
        if (!$this->flags instanceof GameplayV2Flags || $this->flags->commandsAllowlist() === [] || !$this->flags->commandAllowed($kind)) {
            return GameplayRuntimeRoute::LegacyOnly;
        }
        if ($this->flags->runtimeServiceEnabled()) {
            return GameplayRuntimeRoute::RuntimePrimary;
        }
        if ($this->flags->shadowCompareEnabled()) {
            return GameplayRuntimeRoute::Shadow;
        }

        return GameplayRuntimeRoute::LegacyOnly;
    }

    private function runtimeClient(): GameRuntimeMulliganClientInterface
    {
        if (!$this->runtimeClient instanceof GameRuntimeMulliganClientInterface) {
            throw new GameRuntimeMulliganException('Runtime mulligan client is not configured.');
        }

        return $this->runtimeClient;
    }

    private function handlerType(string $kind): string
    {
        return match ($kind) {
            'mulligan.take' => 'mulligan.take',
            'mulligan.keep' => 'mulligan.keep',
            'mulligan.scry.confirm' => 'mulligan.scry_confirm',
            default => throw new \InvalidArgumentException(sprintf('Unsupported mulligan event: %s', $kind)),
        };
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array<string,mixed>
     */
    private function handlerPayload(string $kind, array $payload): array
    {
        if ($kind === 'mulligan.keep') {
            return ['bottomCardInstanceIds' => $payload['bottomCardInstanceIds'] ?? []];
        }
        if ($kind === 'mulligan.scry.confirm') {
            return ['destination' => $payload['destination'] ?? null];
        }

        return [];
    }

    private function clientActionId(string $kind, User $actor, ?string $messageId): string
    {
        $dedupeKey = $messageId !== null && trim($messageId) !== ''
            ? substr(hash('sha256', $messageId), 0, 24)
            : bin2hex(random_bytes(12));

        return sprintf('ws-%s-%s-%s', str_replace('.', '-', $kind), $actor->id(), $dedupeKey);
    }

    private function snapshotVersion(Game $game): int
    {
        return max(1, (int) ($game->snapshot()['version'] ?? 1));
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private function playerId(array $snapshot, string $userId): ?string
    {
        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            if ((string) $playerId === $userId) {
                return (string) $playerId;
            }
            if (is_array($player) && ($player['user']['id'] ?? null) === $userId) {
                return (string) $playerId;
            }
        }

        return null;
    }

    private function errorCode(string $message, string $kind): string
    {
        return match (true) {
            str_contains($message, 'already ready') => 'ALREADY_READY',
            str_contains($message, 'Game is not in mulligan phase') => 'GAME_NOT_IN_MULLIGAN_PHASE',
            str_contains($message, 'Incorrect number of bottom cards selected') => 'INVALID_BOTTOM_COUNT',
            str_contains($message, 'Selected bottom card is not in hand') => 'CARD_NOT_IN_HAND',
            str_contains($message, 'does not allow bottom card selections') => 'BOTTOM_NOT_ALLOWED',
            str_contains($message, 'No bottom card selections are required') => 'BOTTOM_NOT_ALLOWED',
            $kind === 'mulligan.scry.confirm' && (
                str_contains($message, 'Only Vancouver')
                || str_contains($message, 'No scry card')
                || str_contains($message, 'Scry destination')
            ) => 'SCRY_NOT_ALLOWED',
            default => 'INVALID_MULLIGAN_STATE',
        };
    }

    /**
     * @param array<string,float> $extraDebug
     */
    private function result(Game $game, User $actor, GameEvent $event, ?string $messageId, array $extraDebug = []): GameWebsocketCommandResult
    {
        $snapshot = $this->commands->normalizeSnapshot($game->snapshot());
        $publicMessages = [$this->publicState($game->id(), $snapshot, $messageId)];
        if (($snapshot['gamePhase'] ?? null) === self::GAME_PHASE_PLAYING) {
            $publicMessages[] = $this->completed($game->id(), $snapshot, $event, $messageId);
        }

        $messagesByUserId = [];
        foreach ($this->viewers($game) as $viewer) {
            $messagesByUserId[$viewer->id()] = $publicMessages;
        }
        $actorMessages = $messagesByUserId[$actor->id()] ?? $publicMessages;
        $messagesByUserId[$actor->id()] = [
            ...$actorMessages,
            $this->privateState($game->id(), $snapshot, $actor->id(), $messageId),
        ];

        return GameWebsocketCommandResult::forViewerMessageLists(
            $messagesByUserId,
            $publicMessages,
            [
                ...$this->mulliganDebugProfile($publicMessages, $messagesByUserId[$actor->id()] ?? $publicMessages),
                ...$extraDebug,
            ],
        );
    }

    private function runtimeResult(Game $game, User $actor, GameRuntimeMulliganResult $runtimeResult, ?string $messageId): GameWebsocketCommandResult
    {
        $patches = ($this->runtimePatchAdapter ?? new GameplayRuntimePatchAdapter())->normalize($runtimeResult->patches);
        $staticCardsByCardKey = $this->staticCardsByCardKey($game->snapshot());
        $messagesByUserId = [];
        foreach ($this->viewers($game) as $viewer) {
            $messagesByUserId[$viewer->id()] = [];
        }

        $publicOps = [];
        $privateOpsByPlayerId = [];
        $basePatch = [];
        foreach ($patches as $patch) {
            if (!is_array($patch)) {
                continue;
            }
            $patch = $this->hydratePrivateMulliganStaticCards($patch, $staticCardsByCardKey);
            $basePatch = $basePatch === [] ? $patch : $basePatch;
            $ops = is_array($patch['ops'] ?? null) ? $patch['ops'] : [];
            $visibility = is_string($patch['visibility'] ?? null) ? $patch['visibility'] : 'public';
            if ($visibility === 'public') {
                array_push($publicOps, ...$ops);
                continue;
            }
            if (str_starts_with($visibility, 'player:')) {
                $playerId = substr($visibility, strlen('player:'));
                $privateOpsByPlayerId[$playerId] ??= [];
                array_push($privateOpsByPlayerId[$playerId], ...$ops);
            }
        }

        $fallbackMessages = [];
        if ($basePatch !== [] && $publicOps !== []) {
            $fallbackMessages[] = $this->runtimePatchMessage($basePatch, 'public', $publicOps, $messageId);
        }

        foreach (array_keys($messagesByUserId) as $viewerId) {
            $privateOps = $privateOpsByPlayerId[$viewerId] ?? [];
            if ($privateOps !== []) {
                $messagesByUserId[$viewerId][] = $this->runtimePatchMessage(
                    $basePatch,
                    sprintf('player:%s', $viewerId),
                    [...$publicOps, ...$privateOps],
                    $messageId,
                );
                continue;
            }
            $messagesByUserId[$viewerId] = $fallbackMessages;
        }

        $actorMessages = $messagesByUserId[$actor->id()] ?? $fallbackMessages;
        $debug = [
            ...$this->mulliganDebugProfile($fallbackMessages, $actorMessages),
            ...$this->runtimeMetricFloats($runtimeResult->metrics),
            'gameplay.runtime_route' => 1.0,
            'gameplay.runtime_fallback_count' => 0.0,
            'gameplay.runtime_error_count' => 0.0,
            'gameplay.runtime_shadow_executed' => 0.0,
            'gameplay.runtime_shadow_divergence' => 0.0,
            'gameplay.runtime_patch_contract_error' => 0.0,
            'mulligan.runtime_route' => 1.0,
            'mulligan.runtime_fallback_count' => 0.0,
            'mulligan.runtime_error_count' => 0.0,
            'mulligan.runtime_shadow_executed' => 0.0,
            'mulligan.runtime_shadow_divergence' => 0.0,
        ];

        return GameWebsocketCommandResult::forViewerMessageLists($messagesByUserId, $fallbackMessages, $debug);
    }

    /**
     * @param array<string,mixed>               $patch
     * @param array<string,array<string,mixed>> $staticCardsByCardKey
     *
     * @return array<string,mixed>
     */
    private function hydratePrivateMulliganStaticCards(array $patch, array $staticCardsByCardKey): array
    {
        $visibility = is_string($patch['visibility'] ?? null) ? $patch['visibility'] : 'public';
        if (!str_starts_with($visibility, 'player:') || $staticCardsByCardKey === []) {
            return $patch;
        }

        $ops = is_array($patch['ops'] ?? null) ? $patch['ops'] : [];
        $changed = false;
        foreach ($ops as $index => $op) {
            if (!is_array($op) || ($op['op'] ?? null) !== 'mulligan.hand.replace_private') {
                continue;
            }

            $hand = is_array($op['hand'] ?? null) ? $op['hand'] : [];
            $staticCards = [];
            foreach ($hand as $cardIndex => $card) {
                if (!is_array($card)) {
                    continue;
                }
                $cardKey = is_string($card['cardKey'] ?? null) ? trim($card['cardKey']) : '';
                if ($cardKey !== '' && isset($staticCardsByCardKey[$cardKey])) {
                    $staticCard = $staticCardsByCardKey[$cardKey];
                    $staticCards[$cardKey] = $staticCard;
                    $hand[$cardIndex] = $this->privateMulliganCardWithRuntimeIdentity($card, $staticCard, $cardKey);
                }
            }
            if ($staticCards !== []) {
                $ops[$index]['hand'] = $hand;
                $ops[$index]['staticCards'] = $staticCards;
                $changed = true;
            }
        }

        if (!$changed) {
            return $patch;
        }

        return [
            ...$patch,
            'ops' => $ops,
        ];
    }

    /**
     * @param array<string,mixed> $card
     * @param array<string,mixed> $staticCard
     *
     * @return array<string,mixed>
     */
    private function privateMulliganCardWithRuntimeIdentity(array $card, array $staticCard, string $cardKey): array
    {
        $canonicalCardKey = is_string($staticCard['cardKey'] ?? null) && trim($staticCard['cardKey']) !== ''
            ? trim($staticCard['cardKey'])
            : $cardKey;

        return [
            ...$card,
            'cardKey' => $canonicalCardKey,
            'printId' => $staticCard['printId'] ?? $staticCard['scryfallId'] ?? $canonicalCardKey,
            'cardVersion' => $staticCard['cardVersion'] ?? 'legacy-snapshot-v1',
            'language' => $staticCard['language'] ?? 'en',
            'viewerVisibility' => 'private',
        ];
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
            if (!is_string($cardKey) || !is_array($card)) {
                continue;
            }
            $staticCards[$cardKey] = $this->bootstrapStaticCard($cardKey, $card);
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
                        $staticCards[$cardKey] ??= $this->bootstrapStaticCard($cardKey, $card);
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
        $bundle = is_string($card['cardVersion'] ?? null) && trim($card['cardVersion']) !== ''
            ? CardStaticBundle::fromArray([
                ...$card,
                'cardKey' => $cardKey,
            ])
            : CardStaticBundle::fromLegacyCard($card);
        $scryfallId = is_string($card['scryfallId'] ?? null) && trim($card['scryfallId']) !== ''
            ? trim($card['scryfallId'])
            : $bundle->scryfallId;

        return [
            'cardRef' => $cardKey,
            'cardKey' => $cardKey,
            'printId' => $scryfallId ?? $cardKey,
            'cardVersion' => is_string($card['cardVersion'] ?? null) && trim($card['cardVersion']) !== ''
                ? trim($card['cardVersion'])
                : $bundle->cardVersion,
            'language' => 'en',
            'viewerVisibility' => 'private',
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
     * @param array<string,mixed> $card
     */
    private function cardKeyForStaticCard(array $card): string
    {
        if (is_string($card['cardKey'] ?? null) && trim($card['cardKey']) !== '') {
            return trim($card['cardKey']);
        }

        return CardStaticBundle::fromLegacyCard($card)->cardKey;
    }

    /**
     * @param array<string,mixed>       $patch
     * @param list<array<string,mixed>> $ops
     *
     * @return array<string,mixed>
     */
    private function runtimePatchMessage(array $patch, string $visibility, array $ops, ?string $messageId): array
    {
        $message = ['kind' => 'patch.v2', ...$patch, 'visibility' => $visibility, 'ops' => $ops];
        if ($messageId !== null) {
            $message['messageId'] = $messageId;
        }

        return $message;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function shadowCompare(
        string $kind,
        Game $game,
        User $actor,
        int $baseVersion,
        string $clientActionId,
        array $payload,
        GameWebsocketCommandResult $legacyResult,
    ): GameWebsocketCommandResult {
        if (!$this->runtimeShadowEnabled($kind)) {
            return $legacyResult;
        }

        $debug = $legacyResult->debugProfile() ?? [];
        $debug['gameplay.runtime_shadow_executed'] = 1.0;
        $debug['mulligan.runtime_shadow_executed'] = 1.0;
        try {
            $shadow = $this->runtimeClient()->dispatch($kind, $game->id(), $actor->id(), $baseVersion, $clientActionId, $payload, true);
            $diverged = $this->shadowDiverged($shadow, $baseVersion) ? 1.0 : 0.0;
            $debug['gameplay.runtime_shadow_divergence'] = $diverged;
            $debug['mulligan.runtime_shadow_divergence'] = $diverged;
            $debug['gameplay.runtime_error_count'] = 0.0;
            $debug['mulligan.runtime_error_count'] = 0.0;
        } catch (GameRuntimeGatewayException) {
            $debug['gameplay.runtime_shadow_divergence'] = 1.0;
            $debug['mulligan.runtime_shadow_divergence'] = 1.0;
            $debug['gameplay.runtime_error_count'] = 1.0;
            $debug['mulligan.runtime_error_count'] = 1.0;
        }

        return GameWebsocketCommandResult::forViewerMessageLists(
            $legacyResult->messageListsByUserId(),
            $legacyResult->fallbackMessages(),
            $debug,
        );
    }

    private function shadowDiverged(GameRuntimeMulliganResult $shadow, int $baseVersion): bool
    {
        return ($shadow->event['version'] ?? null) !== $baseVersion + 1
            || $shadow->patches === [];
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
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function publicState(string $gameId, array $snapshot, ?string $messageId): array
    {
        $message = [
            'kind' => 'mulligan.public_state',
            'gameId' => $gameId,
            'version' => max(1, (int) ($snapshot['version'] ?? 1)),
            'visibility' => 'public',
            'gamePhase' => $snapshot['gamePhase'] ?? null,
            'players' => [],
            'ops' => [
                [
                    'op' => 'game.phase.set',
                    'phase' => $snapshot['gamePhase'] ?? null,
                ],
            ],
        ];
        if ($messageId !== null) {
            $message['messageId'] = $messageId;
        }

        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            if (!is_array($player)) {
                continue;
            }
            $mulligan = is_array($player['mulligan'] ?? null) ? $player['mulligan'] : [];
            $user = is_array($player['user'] ?? null) ? $player['user'] : [];
            $handCount = count(is_array($player['zones']['hand'] ?? null) ? $player['zones']['hand'] : []);
            $status = is_string($mulligan['status'] ?? null) ? $mulligan['status'] : 'DECIDING';
            $ready = ($mulligan['ready'] ?? false) === true || ($mulligan['status'] ?? null) === 'READY';
            $effectiveMulligans = max(0, (int) ($mulligan['effectiveMulligans'] ?? 0));
            $playerPayload = [
                'playerId' => (string) $playerId,
                'displayName' => $user['displayName'] ?? null,
                'avatarType' => $user['avatarType'] ?? null,
                'avatarPreset' => $user['avatarPreset'] ?? null,
                'avatarInitialLetter' => $user['avatarInitialLetter'] ?? null,
                'handCount' => $handCount,
                'mulligansTaken' => max(0, (int) ($mulligan['mulligansTaken'] ?? 0)),
                'effectiveMulligans' => $effectiveMulligans,
                'status' => $status,
                'ready' => $ready,
            ];
            $message['players'][] = $playerPayload;
            $message['ops'][] = [
                'op' => 'mulligan.status.set',
                'playerId' => (string) $playerId,
                'status' => $status,
                'ready' => $ready,
                'effectiveMulligans' => $effectiveMulligans,
            ];
            $message['ops'][] = [
                'op' => 'mulligan.hand.count.set',
                'playerId' => (string) $playerId,
                'handCount' => $handCount,
            ];
        }

        return $message;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function privateState(string $gameId, array $snapshot, string $playerId, ?string $messageId): array
    {
        $player = is_array($snapshot['players'][$playerId] ?? null) ? $snapshot['players'][$playerId] : [];
        $mulligan = is_array($player['mulligan'] ?? null) ? $player['mulligan'] : [];
        $hand = is_array($player['zones']['hand'] ?? null) ? array_values($player['zones']['hand']) : [];
        $compactHand = $this->compactHand($hand);
        $status = is_string($mulligan['status'] ?? null) ? $mulligan['status'] : 'DECIDING';
        $bottomSelectionCount = max(0, (int) ($mulligan['bottomSelectionCount'] ?? 0));
        $needsBottomSelection = ($mulligan['needsBottomSelection'] ?? false) === true;
        $needsScryAfterKeep = ($mulligan['needsScryAfterKeep'] ?? false) === true;
        $message = [
            'kind' => 'mulligan.private_state',
            'gameId' => $gameId,
            'version' => max(1, (int) ($snapshot['version'] ?? 1)),
            'visibility' => sprintf('player:%s', $playerId),
            'playerId' => $playerId,
            'hand' => $compactHand,
            'handSize' => count($compactHand),
            'mulligan' => [
                'rule' => $mulligan['rule'] ?? null,
                'mulligansTaken' => max(0, (int) ($mulligan['mulligansTaken'] ?? 0)),
                'effectiveMulligans' => max(0, (int) ($mulligan['effectiveMulligans'] ?? 0)),
                'drawCount' => max(0, (int) ($mulligan['drawCount'] ?? 0)),
                'bottomSelectionCount' => $bottomSelectionCount,
                'finalHandSize' => max(0, (int) ($mulligan['finalHandSize'] ?? 0)),
                'needsBottomSelection' => $needsBottomSelection,
                'bottomOrderMode' => is_string($mulligan['bottomOrderMode'] ?? null) ? $mulligan['bottomOrderMode'] : 'NONE',
                'needsScryAfterKeep' => $needsScryAfterKeep,
                'canTakeAnotherMulligan' => ($mulligan['canTakeAnotherMulligan'] ?? false) === true,
                'status' => $status,
                'ready' => ($mulligan['ready'] ?? false) === true || ($mulligan['status'] ?? null) === 'READY',
            ],
            'ops' => [
                [
                    'op' => 'mulligan.private_state.set',
                    'playerId' => $playerId,
                    'status' => $status,
                    'effectiveMulligans' => max(0, (int) ($mulligan['effectiveMulligans'] ?? 0)),
                    'handSize' => count($compactHand),
                    'cardsToBottom' => $bottomSelectionCount,
                    'bottomPending' => $needsBottomSelection,
                    'scryPending' => $status === 'SCRYING' || $needsScryAfterKeep,
                ],
                [
                    'op' => 'mulligan.hand.replace_private',
                    'playerId' => $playerId,
                    'hand' => $compactHand,
                ],
                [
                    'op' => 'mulligan.bottom.required.set',
                    'playerId' => $playerId,
                    'count' => $bottomSelectionCount,
                    'pending' => $needsBottomSelection,
                ],
            ],
        ];
        if ($messageId !== null) {
            $message['messageId'] = $messageId;
        }

        $scryCardInstanceId = is_string($mulligan['scryCardInstanceId'] ?? null) ? $mulligan['scryCardInstanceId'] : '';
        $topCard = (new GameLibraryOps())->peekTop($player, 1)[0] ?? null;
        if (($mulligan['status'] ?? null) === 'SCRYING' && $scryCardInstanceId !== '' && is_array($topCard) && ($topCard['instanceId'] ?? null) === $scryCardInstanceId) {
            $message['scryCard'] = $this->compactCard($topCard);
            $message['ops'][] = [
                'op' => 'mulligan.scry.available.set',
                'playerId' => $playerId,
                'card' => $message['scryCard'],
            ];
        }

        return $message;
    }

    /**
     * @param list<array<string,mixed>> $hand
     *
     * @return list<array{instanceId:string,cardKey:?string}>
     */
    private function compactHand(array $hand): array
    {
        $compact = [];
        foreach ($hand as $card) {
            if (!is_array($card)) {
                continue;
            }
            $compact[] = $this->compactCard($card);
        }

        return $compact;
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{instanceId:string,cardKey:?string}
     */
    private function compactCard(array $card): array
    {
        return [
            'instanceId' => (string) ($card['instanceId'] ?? ''),
            'cardKey' => null,
        ];
    }

    /**
     * @param list<array<string,mixed>> $publicMessages
     * @param list<array<string,mixed>> $actorMessages
     *
     * @return array<string,float>
     */
    private function mulliganDebugProfile(array $publicMessages, array $actorMessages): array
    {
        $inspector = $this->metricsInspector ?? new GameplayMetricsInspector();

        return [
            'mulligan.public_payload_bytes' => (float) $inspector->patchBytesForMessages($publicMessages),
            'mulligan.private_payload_bytes' => (float) $inspector->patchBytesForMessages($actorMessages),
            'mulligan.private_static_cards_count' => 0.0,
            'mulligan.public_private_leak_detected' => $this->publicPrivateLeakDetected($publicMessages) ? 1.0 : 0.0,
            'mulligan.resync_count' => 0.0,
        ];
    }

    /**
     * @param array<string,mixed> $metrics
     *
     * @return array<string,float>
     */
    private function runtimeMetricFloats(array $metrics): array
    {
        $out = [];
        foreach ($metrics as $key => $value) {
            if (!is_string($key) || !is_numeric($value)) {
                continue;
            }
            $out[$key] = (float) $value;
        }

        return $out;
    }

    /**
     * @param list<array<string,mixed>> $publicMessages
     */
    private function publicPrivateLeakDetected(array $publicMessages): bool
    {
        $encoded = json_encode($publicMessages);
        if (!is_string($encoded)) {
            return false;
        }

        foreach (['cardKey', 'imageUris', 'oracleText', 'cardFaces', 'avatarImageData'] as $privateField) {
            if (str_contains($encoded, $privateField)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function completed(string $gameId, array $snapshot, GameEvent $event, ?string $messageId): array
    {
        $message = [
            'kind' => 'mulligan.completed',
            'gameId' => $gameId,
            'version' => max(1, (int) ($snapshot['version'] ?? 1)),
            'visibility' => 'public',
            'event' => $event->toArray(),
            'ops' => [
                [
                    'op' => 'mulligan.completed',
                    'event' => $event->toArray(),
                ],
                [
                    'op' => 'game.phase.set',
                    'phase' => $snapshot['gamePhase'] ?? null,
                ],
            ],
        ];
        if ($messageId !== null) {
            $message['messageId'] = $messageId;
        }

        return $message;
    }

    /**
     * @return array<string,mixed>
     */
    private function error(string $gameId, string $code, string $message, ?string $messageId = null, ?int $version = null): array
    {
        $payload = [
            'kind' => 'mulligan.error',
            'gameId' => $gameId,
            'error' => [
                'code' => $code,
                'message' => $message,
                'retryable' => false,
            ],
        ];
        if ($messageId !== null) {
            $payload['messageId'] = $messageId;
        }
        if ($version !== null) {
            $payload['version'] = $version;
        }

        return $payload;
    }

    private function hydrateRuntimeEvents(Game $game): void
    {
        if ($this->eventStoreV2?->enabled() === true) {
            $this->eventStoreV2->hydrateGame($game);
        }
    }
}
