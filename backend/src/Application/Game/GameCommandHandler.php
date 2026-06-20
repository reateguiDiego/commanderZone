<?php

namespace App\Application\Game;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Compact\GameplayCompactRuntimeFlags;
use App\Application\Game\Performance\GameplayMetricsInspector;
use App\Domain\Deck\Deck;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\User\User;
use Symfony\Component\Uid\Uuid;

class GameCommandHandler
{
    private const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
    private const HIDDEN_ZONES = ['library', 'hand'];
    private const GAME_PHASE_MULLIGAN = 'MULLIGAN';
    private const GAME_PHASE_PLAYING = 'PLAYING';
    private const MULLIGAN_STATUS_DECIDING = 'DECIDING';
    private const MULLIGAN_STATUS_SCRYING = 'SCRYING';
    private const MULLIGAN_STATUS_READY = 'READY';
    private const CHAT_REACTIONS = ['like', 'dislike', 'love', 'laugh', 'angry', 'vomit', 'cry'];
    private const MAX_CARD_COUNTER_TYPES = 5;
    private const MAX_TOKEN_CREATE_QUANTITY = 20;
    private const COMMANDER_DAMAGE_DEFEAT_THRESHOLD = 21;
    private const POSITION_UNIT_RATIO = 'ratio';
    private const THE_RING_SCRYFALL_ID = '7215460e-8c06-47d0-94e5-d1832d0218af';
    private const TOKEN_COPY_LEGACY_OFFSET_X = 132;
    private const TOKEN_COPY_RATIO_OFFSET_X = 0.1683673469387755;
    private const DICE_ROLL_LABELS = [
        'coin' => 'moneda',
        'd4' => 'd4',
        'd6' => 'd6',
        'd10' => 'd10',
        'd20' => 'd20',
    ];
    private const SUPPORTED_COMMANDS = [
        'game.concede',
        'game.close',
        'mulligan.take',
        'mulligan.keep',
        'mulligan.scry_confirm',
        'chat.message',
        'chat.reaction.toggled',
        'dice.rolled',
        'life.changed',
        'commander.damage.changed',
        'counter.changed',
        'card.counter.changed',
        'card.power_toughness.changed',
        'card.moved',
        'cards.moved',
        'card.tapped',
        'card.position.changed',
        'card.dungeon_marker.changed',
        'cards.position.changed',
        'card.face_down.changed',
        'card.face.changed',
        'card.revealed',
        'card.token.created',
        'card.token_copy.created',
        'card.controller.changed',
        'turn.changed',
        'battlefield.untap_all',
        'zone.changed',
        'zone.move_all',
        'zone.random_card.selected',
        'library.draw',
        'library.draw_many',
        'library.shuffle',
        'library.move_top',
        'library.reveal_top',
        'library.reveal',
        'library.view',
        'library.play_top_revealed',
        'library.reorder_top',
        'stack.card_added',
        'stack.item_removed',
        'arrow.created',
        'arrow.removed',
        'attachment.created',
        'attachment.removed',
        'helper.created',
        'helper.updated',
        'helper.removed',
    ];
    private const COMMANDS_ALLOWED_WHEN_FINISHED = [
        'chat.message',
        'chat.reaction.toggled',
    ];
    private const MULLIGAN_COMMANDS = [
        'mulligan.take',
        'mulligan.keep',
        'mulligan.scry_confirm',
    ];
    private const ACTOR_OWN_PLAYER_COMMANDS = [
        'zone.changed',
        'zone.move_all',
        'zone.random_card.selected',
        'card.moved',
        'cards.moved',
        'card.tapped',
        'card.position.changed',
        'card.dungeon_marker.changed',
        'cards.position.changed',
        'card.face_down.changed',
        'card.face.changed',
        'card.revealed',
        'card.token.created',
        'card.token_copy.created',
        'card.controller.changed',
        'card.power_toughness.changed',
        'card.counter.changed',
        'battlefield.untap_all',
        'stack.card_added',
        'helper.created',
        'helper.updated',
        'helper.removed',
    ];

    /**
     * @var array<string,mixed>
     */
    private array $pendingLogContext = [];
    /**
     * @var array<string,mixed>|null
     */
    private ?array $pendingEventPayload = null;
    private ?string $pendingDefeatedPlayerId = null;
    private bool $pendingDefeatPreexisted = false;
    /**
     * @var array<string,mixed>|null
     */
    private ?array $lastCommandMetrics = null;

    public function __construct(
        private readonly ?GameCardBaseStatsResolver $baseStatsResolver = null,
        ?GameRandomizer $randomizer = null,
        ?GameSpecialEntityCommandHandler $specialEntityCommandHandler = null,
        ?GameplayMetricsInspector $metricsInspector = null,
        ?CompactGameCardStateMapper $compactStateMapper = null,
        ?GameplayCompactRuntimeFlags $compactRuntimeFlags = null,
    )
    {
        $this->randomizer = $randomizer ?? new GameRandomizer();
        $this->specialEntityCommandHandler = $specialEntityCommandHandler ?? new GameSpecialEntityCommandHandler();
        $this->metricsInspector = $metricsInspector ?? new GameplayMetricsInspector();
        $this->compactStateMapper = $compactStateMapper ?? new CompactGameCardStateMapper();
        $this->compactRuntimeFlags = $compactRuntimeFlags ?? new GameplayCompactRuntimeFlags();
    }

    private readonly GameRandomizer $randomizer;
    private readonly GameSpecialEntityCommandHandler $specialEntityCommandHandler;
    private readonly GameplayMetricsInspector $metricsInspector;
    private readonly CompactGameCardStateMapper $compactStateMapper;
    private readonly GameplayCompactRuntimeFlags $compactRuntimeFlags;

    /**
     * @return list<string>
     */
    public static function supportedCommands(): array
    {
        return self::SUPPORTED_COMMANDS;
    }

    public static function isSupportedCommand(string $type): bool
    {
        return in_array($type, self::SUPPORTED_COMMANDS, true);
    }

    public static function isAllowedWhenFinished(string $type): bool
    {
        return in_array($type, self::COMMANDS_ALLOWED_WHEN_FINISHED, true);
    }

    public function apply(Game $game, string $type, array $payload, User $actor, ?string $clientActionId = null): GameEvent
    {
        if (!self::isSupportedCommand($type)) {
            throw new \InvalidArgumentException(sprintf('Unknown game command: %s', $type));
        }

        $this->lastCommandMetrics = null;
        $snapshotBefore = $game->snapshot();
        $snapshotBytesBefore = $this->metricsInspector->jsonBytes($snapshotBefore);
        $normalizeStartedAt = microtime(true);
        $snapshot = $this->normalizeSnapshot($snapshotBefore);
        $normalizeMs = $this->elapsedMs($normalizeStartedAt);
        $applyStartedAt = microtime(true);

        try {
            $log = null;
            $this->pendingLogContext = [];
            $this->pendingEventPayload = null;
            $this->pendingDefeatedPlayerId = null;
            $this->pendingDefeatPreexisted = false;
            $this->assertActorCanApply($snapshot, $type, $payload, $actor);
            $this->assertGamePhaseAllowsCommand($snapshot, $type);

            if ($this->specialEntityCommandHandler->supports($type)) {
                $helperResult = $this->specialEntityCommandHandler->apply($snapshot, $type, $payload, $actor);
                if ($type === 'helper.created') {
                    $this->syncInitiativeUndercityFromHelperCreate(
                        $snapshot,
                        is_array($helperResult['eventPayload'] ?? null) ? $helperResult['eventPayload'] : [],
                    );
                }
                $log = is_string($helperResult['log'] ?? null) ? $helperResult['log'] : null;
                $this->pendingEventPayload = is_array($helperResult['eventPayload'] ?? null) ? $helperResult['eventPayload'] : null;
            } else {
                match ($type) {
                    'game.concede' => $log = $this->applyGameConcede($snapshot, $actor),
                    'game.close' => $log = $this->applyGameClose($snapshot, $game, $actor),
                    'mulligan.take' => $log = $this->applyMulliganTake($snapshot, $actor),
                    'mulligan.keep' => $log = $this->applyMulliganKeep($snapshot, $payload, $actor),
                    'mulligan.scry_confirm' => $log = $this->applyMulliganScryConfirm($snapshot, $payload, $actor),
                    'chat.message' => $log = $this->applyChatMessage($snapshot, $payload, $actor),
                    'chat.reaction.toggled' => $log = $this->applyChatReactionToggled($snapshot, $payload, $actor),
                    'dice.rolled' => $log = $this->applyDiceRolled($payload),
                    'life.changed' => $log = $this->applyLifeChanged($snapshot, $payload),
                    'commander.damage.changed' => $log = $this->applyCommanderDamageChanged($snapshot, $payload),
                    'counter.changed' => $log = $this->applyLegacyCounterChanged($snapshot, $payload),
                    'card.counter.changed' => $log = $this->applyCardCounterChanged($snapshot, $payload),
                    'card.power_toughness.changed' => $log = $this->applyPowerToughnessChanged($snapshot, $payload),
                    'card.moved' => $log = $this->applyCardMoved($snapshot, $payload),
                    'cards.moved' => $log = $this->applyCardsMoved($snapshot, $payload),
                    'card.tapped' => $log = $this->applyCardTapped($snapshot, $payload),
                    'card.position.changed' => $log = $this->applyCardPositionChanged($snapshot, $payload),
                    'card.dungeon_marker.changed' => $log = $this->applyDungeonMarkerChanged($snapshot, $payload),
                    'cards.position.changed' => $log = $this->applyCardsPositionChanged($snapshot, $payload),
                    'card.face_down.changed' => $log = $this->applyCardFaceDown($snapshot, $payload),
                    'card.face.changed' => $log = $this->applyCardFaceChanged($snapshot, $payload),
                    'card.revealed' => $log = $this->applyCardRevealed($snapshot, $payload),
                    'card.token.created' => $log = $this->applyTokenCreated($snapshot, $payload),
                    'card.token_copy.created' => $log = $this->applyTokenCopyCreated($snapshot, $payload, $actor),
                    'card.controller.changed' => $log = $this->applyControllerChanged($snapshot, $payload),
                    'turn.changed' => $log = $this->applyTurnChanged($snapshot, $payload),
                    'battlefield.untap_all' => $log = $this->applyBattlefieldUntapAll($snapshot, $payload),
                    'zone.changed' => $log = $this->applyZoneChanged($snapshot, $payload),
                    'zone.move_all' => $log = $this->applyZoneMoveAll($snapshot, $payload),
                    'zone.random_card.selected' => $log = $this->applyZoneRandomCardSelected($snapshot, $payload),
                    'library.draw' => $log = $this->applyLibraryDraw($snapshot, $payload, 1),
                    'library.draw_many' => $log = $this->applyLibraryDraw($snapshot, $payload, $this->positiveInt($payload['count'] ?? 1, 1, 99)),
                    'library.shuffle' => $log = $this->applyLibraryShuffle($snapshot, $payload),
                    'library.move_top' => $log = $this->applyLibraryMoveTop($snapshot, $payload),
                    'library.reveal_top' => $log = $this->applyLibraryRevealTop($snapshot, $payload),
                    'library.reveal' => $log = $this->applyLibraryReveal($snapshot, $payload),
                    'library.view' => $log = $this->applyLibraryView($snapshot, $payload),
                    'library.play_top_revealed' => $log = $this->applyLibraryPlayTopRevealed($snapshot, $payload),
                    'library.reorder_top' => $log = $this->applyLibraryReorderTop($snapshot, $payload),
                    'stack.card_added' => $log = $this->applyStackCardAdded($snapshot, $payload),
                    'stack.item_removed' => $log = $this->applyStackItemRemoved($snapshot, $payload),
                    'arrow.created' => $log = $this->applyArrowCreated($snapshot, $payload, $actor),
                    'arrow.removed' => $log = $this->applyArrowRemoved($snapshot, $payload, $actor),
                    'attachment.created' => $log = $this->applyAttachmentCreated($snapshot, $payload, $actor),
                    'attachment.removed' => $log = $this->applyAttachmentRemoved($snapshot, $payload, $actor),
                    default => throw new \InvalidArgumentException(sprintf('Unknown game command: %s', $type)),
                };
            }

            $this->pruneBattlefieldRelations($snapshot);
            $snapshot = $this->specialEntityCommandHandler->normalizeSnapshot($snapshot);
            $eventPayload = $type === 'chat.message'
                ? $this->chatEventPayload($payload)
                : ($this->pendingEventPayload ?? $payload);
            $this->commit($snapshot, $type, $log, $actor);
            $persistedSnapshot = $this->snapshotForPersistence($snapshotBefore, $snapshot);
            $game->replaceSnapshot($persistedSnapshot);
            $event = new GameEvent($game, $type, $eventPayload, $actor, $clientActionId);
            $game->addEvent($event);
            $this->lastCommandMetrics = $this->commandMetricsPayload(
                $persistedSnapshot,
                $snapshotBytesBefore,
                $normalizeMs,
                $this->elapsedMs($applyStartedAt),
            );

            return $event;
        } catch (\Throwable $exception) {
            $this->lastCommandMetrics = $this->commandMetricsPayload(
                $snapshot,
                $snapshotBytesBefore,
                $normalizeMs,
                $this->elapsedMs($applyStartedAt),
            );

            throw $exception;
        }
    }

    /**
     * @return array<string,mixed>|null
     */
    public function consumeLastCommandMetrics(): ?array
    {
        $metrics = $this->lastCommandMetrics;
        $this->lastCommandMetrics = null;

        return $metrics;
    }

    public function normalizeSnapshot(array $snapshot): array
    {
        $snapshot = $this->compactStateMapper->hydrateSnapshot($snapshot);
        $snapshot['version'] = max(1, (int) ($snapshot['version'] ?? 1));
        $snapshot['ownerId'] = (string) ($snapshot['ownerId'] ?? '');
        $gamePhase = $snapshot['gamePhase'] ?? self::GAME_PHASE_PLAYING;
        $snapshot['gamePhase'] = in_array($gamePhase, [self::GAME_PHASE_MULLIGAN, self::GAME_PHASE_PLAYING], true)
            ? $gamePhase
            : self::GAME_PHASE_PLAYING;
        $snapshot['mulligan'] = is_array($snapshot['mulligan'] ?? null) ? $snapshot['mulligan'] : [];
        $mulliganRule = $snapshot['mulligan']['rule'] ?? Room::DEFAULT_MULLIGAN_RULE;
        $snapshot['mulligan']['rule'] = in_array($mulliganRule, Room::MULLIGAN_RULES, true)
            ? $mulliganRule
            : Room::DEFAULT_MULLIGAN_RULE;
        $snapshot['mulligan']['firstMulliganFree'] = (bool) ($snapshot['mulligan']['firstMulliganFree'] ?? false);
        $snapshot['stack'] ??= [];
        $snapshot['arrows'] ??= [];
        $snapshot['attachments'] ??= [];
        $snapshot['chat'] ??= [];
        $snapshot['chat'] = $this->normalizeChatMessages(is_array($snapshot['chat']) ? $snapshot['chat'] : []);
        $snapshot['eventLog'] ??= [];
        $snapshot['counters'] ??= [];
        $snapshot['updatedAt'] ??= $snapshot['createdAt'] ?? (new \DateTimeImmutable())->format(DATE_ATOM);

        if (!isset($snapshot['players']) || !is_array($snapshot['players'])) {
            $snapshot['players'] = [];
        }

        foreach ($snapshot['players'] as $playerId => &$player) {
            $status = $player['status'] ?? 'active';
            $player['status'] = in_array($status, ['active', 'conceded'], true) ? $status : 'active';
            $player['concededAt'] ??= null;
            $player['deckName'] = is_string($player['deckName'] ?? null) ? $player['deckName'] : null;
            $player['colorIdentity'] = $this->orderedColorIdentity(is_array($player['colorIdentity'] ?? null) ? $player['colorIdentity'] : []);
            $player['backgroundName'] = $this->visualName($player['backgroundName'] ?? null, Deck::DEFAULT_BACKGROUND_NAME);
            $player['sleevesName'] = $this->visualName($player['sleevesName'] ?? null, Deck::DEFAULT_SLEEVES_NAME);
            $player['playTopLibraryRevealed'] = (bool) ($player['playTopLibraryRevealed'] ?? false);
            $player['revealedLibraryTo'] = is_array($player['revealedLibraryTo'] ?? null) ? array_values($player['revealedLibraryTo']) : [];
            $player['counters'] ??= [];
            $player['commanderDamage'] ??= [];
            $player['mulligan'] = $this->normalizePlayerMulligan(
                is_array($player['mulligan'] ?? null) ? $player['mulligan'] : [],
                (string) $snapshot['mulligan']['rule'],
                (bool) $snapshot['mulligan']['firstMulliganFree'],
            );
            foreach (self::ZONES as $zone) {
                $player['zones'][$zone] ??= [];
                foreach ($player['zones'][$zone] as &$card) {
                    $card = $this->normalizeCard($card, (string) $playerId, $zone);
                }
                unset($card);
            }
            if ($player['colorIdentity'] === [] && isset($player['zones']['command'])) {
                foreach ($player['zones']['command'] as $commander) {
                    $player['colorIdentity'] = $this->orderedColorIdentity([
                        ...$player['colorIdentity'],
                        ...(is_array($commander['colorIdentity'] ?? null) ? $commander['colorIdentity'] : []),
                    ]);
                }
            }
        }
        unset($player);

        $this->normalizeCommanderDamage($snapshot);
        $this->normalizeCommanderCastCounters($snapshot);
        $this->pruneBattlefieldRelations($snapshot);
        $snapshot = $this->specialEntityCommandHandler->normalizeSnapshot($snapshot);

        return $snapshot;
    }

    /**
     * @param array<string,mixed> $mulligan
     *
     * @return array<string,mixed>
     */
    private function normalizePlayerMulligan(array $mulligan, string $rule, bool $firstMulliganFree): array
    {
        $mulligansTaken = max(0, (int) ($mulligan['mulligansTaken'] ?? 0));
        $state = GameMulliganRules::calculateMulliganState($rule, $firstMulliganFree, $mulligansTaken);
        $status = $mulligan['status'] ?? self::MULLIGAN_STATUS_DECIDING;
        $status = in_array($status, [self::MULLIGAN_STATUS_DECIDING, self::MULLIGAN_STATUS_SCRYING, self::MULLIGAN_STATUS_READY], true)
            ? $status
            : self::MULLIGAN_STATUS_DECIDING;
        $scryCardInstanceId = is_string($mulligan['scryCardInstanceId'] ?? null) && trim($mulligan['scryCardInstanceId']) !== ''
            ? trim($mulligan['scryCardInstanceId'])
            : null;

        return [
            ...$state,
            'status' => $status,
            'ready' => $status === self::MULLIGAN_STATUS_READY,
            'scryCardInstanceId' => $status === self::MULLIGAN_STATUS_SCRYING ? $scryCardInstanceId : null,
        ];
    }

    private function normalizeCommanderDamage(array &$snapshot): void
    {
        $commandersByPlayer = $this->commanderCardsByPlayer($snapshot);
        $commanderOwners = $this->commanderOwnersByInstanceId($commandersByPlayer);

        foreach ($snapshot['players'] as $targetPlayerId => &$player) {
            $previousDamage = is_array($player['commanderDamage'] ?? null) ? $player['commanderDamage'] : [];
            $nextDamage = [];

            foreach ($commandersByPlayer as $sourcePlayerId => $commanders) {
                if ((string) $sourcePlayerId === (string) $targetPlayerId) {
                    continue;
                }

                foreach ($commanders as $commander) {
                    $commanderInstanceId = (string) ($commander['instanceId'] ?? '');
                    if ($commanderInstanceId !== '') {
                        $nextDamage[$commanderInstanceId] = 0;
                    }
                }
            }

            foreach ($previousDamage as $key => $damage) {
                $damage = max(0, (int) $damage);
                $resolvedCommanderId = null;
                if (isset($commanderOwners[(string) $key]) && $commanderOwners[(string) $key] !== (string) $targetPlayerId) {
                    $resolvedCommanderId = (string) $key;
                } elseif (isset($commandersByPlayer[(string) $key][0]) && (string) $key !== (string) $targetPlayerId) {
                    $resolvedCommanderId = (string) $commandersByPlayer[(string) $key][0]['instanceId'];
                }

                if ($resolvedCommanderId !== null) {
                    $nextDamage[$resolvedCommanderId] = max((int) ($nextDamage[$resolvedCommanderId] ?? 0), $damage);
                }
            }

            $player['commanderDamage'] = $nextDamage;
        }
        unset($player);
    }

    private function normalizeCommanderCastCounters(array &$snapshot): void
    {
        $counters = is_array($snapshot['counters'] ?? null) ? $snapshot['counters'] : [];
        $commandersByPlayer = $this->commanderCardsByPlayer($snapshot);
        $commanderOwners = $this->commanderOwnersByInstanceId($commandersByPlayer);
        $normalized = [];

        foreach ($counters as $scope => $scopeCounters) {
            $scope = (string) $scope;
            $scopeCounters = is_array($scopeCounters) ? $scopeCounters : [];
            if (!str_starts_with($scope, 'commander:')) {
                $normalized[$scope] = $scopeCounters;
                continue;
            }

            $id = substr($scope, strlen('commander:'));
            if (isset($commandersByPlayer[$id][0])) {
                $scope = 'commander:'.(string) $commandersByPlayer[$id][0]['instanceId'];
            } elseif (!isset($commanderOwners[$id])) {
                continue;
            }

            $normalized[$scope] = [
                ...($normalized[$scope] ?? []),
                ...$scopeCounters,
            ];
        }

        $snapshot['counters'] = $normalized;
    }

    /**
     * @return array<string,list<array<string,mixed>>>
     */
    private function commanderCardsByPlayer(array $snapshot): array
    {
        $commandersByPlayer = [];
        $seenInstanceIds = [];
        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            $commandersByPlayer[(string) $playerId] = [];
        }

        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            foreach (self::ZONES as $zone) {
                foreach (($player['zones'][$zone] ?? []) as $card) {
                    if (!is_array($card) || ($card['isCommander'] ?? false) !== true) {
                        continue;
                    }

                    $ownerId = (string) ($card['ownerId'] ?? $playerId);
                    if (!isset($commandersByPlayer[$ownerId])) {
                        continue;
                    }

                    $instanceId = (string) ($card['instanceId'] ?? '');
                    if ($instanceId === '' || isset($seenInstanceIds[$instanceId])) {
                        continue;
                    }

                    $seenInstanceIds[$instanceId] = true;
                    $commandersByPlayer[$ownerId][] = $card;
                }
            }
        }

        return $commandersByPlayer;
    }

    /**
     * @param array<string,list<array<string,mixed>>> $commandersByPlayer
     *
     * @return array<string,string>
     */
    private function commanderOwnersByInstanceId(array $commandersByPlayer): array
    {
        $owners = [];
        foreach ($commandersByPlayer as $playerId => $commanders) {
            foreach ($commanders as $commander) {
                $instanceId = (string) ($commander['instanceId'] ?? '');
                if ($instanceId !== '') {
                    $owners[$instanceId] = (string) $playerId;
                }
            }
        }

        return $owners;
    }

    private function normalizeCard(array $card, string $ownerId, string $zone): array
    {
        $rawPower = $card['power'] ?? null;
        $rawToughness = $card['toughness'] ?? null;
        $rawLoyalty = $card['loyalty'] ?? null;
        $rawDefense = $card['defense'] ?? null;
        $power = $this->gameplayStat($rawPower);
        $toughness = $this->gameplayStat($rawToughness);
        $baseStats = $this->baseStats($card, $rawPower, $rawToughness);
        $loyalty = array_key_exists('loyalty', $card) ? $this->gameplayStat($rawLoyalty) : null;
        $defaultLoyalty = $this->defaultLoyalty($card, $rawLoyalty);
        $defense = array_key_exists('defense', $card) ? $this->gameplayStat($rawDefense) : null;
        $defaultDefense = $this->defaultDefense($card, $rawDefense);
        $loyalty ??= $defaultLoyalty;
        $defense ??= $defaultDefense;
        $tapped = $zone === 'battlefield' && (bool) ($card['tapped'] ?? false);

        $normalized = [
            'instanceId' => (string) ($card['instanceId'] ?? Uuid::v7()->toRfc4122()),
            'ownerId' => (string) ($card['ownerId'] ?? $ownerId),
            'controllerId' => (string) ($card['controllerId'] ?? $ownerId),
            'scryfallId' => (string) ($card['scryfallId'] ?? ''),
            'name' => (string) ($card['name'] ?? 'Unknown card'),
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
            'cardFaces' => is_array($card['cardFaces'] ?? null) ? $card['cardFaces'] : [],
            'hasRulings' => (bool) ($card['hasRulings'] ?? false),
            'typeLine' => $card['typeLine'] ?? null,
            'manaCost' => $card['manaCost'] ?? null,
            'oracleText' => $card['oracleText'] ?? null,
            'colorIdentity' => $this->orderedColorIdentity(is_array($card['colorIdentity'] ?? null) ? $card['colorIdentity'] : []),
            'power' => $power,
            'toughness' => $toughness,
            'loyalty' => $loyalty,
            'defense' => $defense,
            'defaultPower' => $baseStats['power'],
            'defaultToughness' => $baseStats['toughness'],
            'defaultLoyalty' => $defaultLoyalty,
            'defaultDefense' => $defaultDefense,
            'tapped' => $tapped,
            'faceDown' => (bool) ($card['faceDown'] ?? false),
            'activeFaceIndex' => $this->activeFaceIndex($card),
            'revealedTo' => is_array($card['revealedTo'] ?? null) ? $card['revealedTo'] : [],
            'position' => $this->normalizedPosition($card['position'] ?? null),
            'rotation' => $tapped ? (int) ($card['rotation'] ?? 90) : 0,
            'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
            'zone' => $zone,
            'isToken' => (bool) ($card['isToken'] ?? false),
            'isTokenCopy' => (bool) ($card['isTokenCopy'] ?? false),
            'isCommander' => (bool) ($card['isCommander'] ?? $zone === 'command'),
        ];

        if (array_key_exists('layout', $card)) {
            $normalized['layout'] = $card['layout'];
        }
        if (array_key_exists('dungeonMarker', $card)) {
            $normalized['dungeonMarker'] = $this->normalizedDungeonMarker($card['dungeonMarker']);
        } elseif ($this->isDungeonCard($normalized)) {
            $normalized['dungeonMarker'] = $this->defaultDungeonMarker();
        }

        return $normalized;
    }

    /**
     * @param list<mixed> $messages
     *
     * @return list<array<string,mixed>>
     */
    private function normalizeChatMessages(array $messages): array
    {
        $normalized = [];
        foreach ($messages as $message) {
            if (!is_array($message)) {
                continue;
            }

            $createdAt = is_string($message['createdAt'] ?? null)
                ? $message['createdAt']
                : (new \DateTimeImmutable())->format(DATE_ATOM);
            $entry = [
                'id' => $this->chatMessageId($message),
                'userId' => (string) ($message['userId'] ?? ''),
                'displayName' => (string) ($message['displayName'] ?? ''),
                'message' => (string) ($message['message'] ?? ''),
                'createdAt' => $createdAt,
                'reactions' => $this->normalizeChatReactions($message['reactions'] ?? []),
            ];

            $targetPlayerId = $message['targetPlayerId'] ?? null;
            if (is_string($targetPlayerId) && $targetPlayerId !== '' && $targetPlayerId !== 'all') {
                $entry['targetPlayerId'] = $targetPlayerId;
                $entry['targetDisplayName'] = is_string($message['targetDisplayName'] ?? null)
                    ? $message['targetDisplayName']
                    : null;
            }

            $normalized[] = $entry;
        }

        return $normalized;
    }

    /**
     * @param array<string,mixed> $message
     */
    private function chatMessageId(array $message): string
    {
        $id = $message['id'] ?? null;
        if (is_string($id) && trim($id) !== '') {
            return $id;
        }

        return 'legacy-chat-'.substr(hash('sha256', json_encode([
            $message['createdAt'] ?? '',
            $message['userId'] ?? '',
            $message['targetPlayerId'] ?? 'all',
            $message['message'] ?? '',
        ], JSON_THROW_ON_ERROR)), 0, 24);
    }

    /**
     * @param mixed $reactions
     *
     * @return array<string,list<array{userId:string,displayName:string,createdAt:string}>>
     */
    private function normalizeChatReactions(mixed $reactions): array
    {
        if (!is_array($reactions)) {
            return [];
        }

        $normalized = [];
        foreach (self::CHAT_REACTIONS as $reaction) {
            $entries = $reactions[$reaction] ?? [];
            if (!is_array($entries)) {
                continue;
            }

            foreach ($entries as $entry) {
                if (!is_array($entry)) {
                    continue;
                }

                $userId = $entry['userId'] ?? null;
                if (!is_string($userId) || trim($userId) === '') {
                    continue;
                }

                $normalized[$reaction][] = [
                    'userId' => $userId,
                    'displayName' => is_string($entry['displayName'] ?? null) ? $entry['displayName'] : $userId,
                    'createdAt' => is_string($entry['createdAt'] ?? null) ? $entry['createdAt'] : (new \DateTimeImmutable())->format(DATE_ATOM),
                ];
            }
        }

        return array_filter($normalized, static fn (array $entries): bool => $entries !== []);
    }

    private function visualName(mixed $value, string $fallback): string
    {
        if (!is_string($value)) {
            return $fallback;
        }

        $name = trim($value);

        return $name === '' ? $fallback : $name;
    }

    private function applyGameConcede(array &$snapshot, User $actor): string
    {
        $playerId = $actor->id();
        if (!isset($snapshot['players'][$playerId])) {
            throw new \InvalidArgumentException('Actor is not a game player.');
        }
        $previousActivePlayerId = (string) ($snapshot['turn']['activePlayerId'] ?? '');

        $snapshot['players'][$playerId]['status'] = 'conceded';
        $snapshot['players'][$playerId]['concededAt'] = (new \DateTimeImmutable())->format(DATE_ATOM);
        GameTurnSuccession::advanceWhenActivePlayerLeaves($snapshot, $playerId, $previousActivePlayerId);
        $this->reassignMonarchWhenPlayerLeaves($snapshot, $playerId, $previousActivePlayerId);

        return sprintf('%s conceded.', $this->playerName($snapshot, $playerId));
    }

    private function applyGameClose(array &$snapshot, Game $game, User $actor): string
    {
        if ($game->room()->owner()->id() !== $actor->id()) {
            throw new \InvalidArgumentException('Only the room owner can close the game.');
        }

        $game->finish();

        return 'Closed the game.';
    }

    private function applyChatMessage(array &$snapshot, array $payload, User $actor): ?string
    {
        $message = trim((string) ($payload['message'] ?? ''));
        if ($message === '') {
            throw new \InvalidArgumentException('Message is required.');
        }

        $targetPlayerId = $this->chatTargetPlayerId($snapshot, $payload, $actor);
        $chatMessage = [
            'id' => Uuid::v7()->toRfc4122(),
            'userId' => $actor->id(),
            'displayName' => $actor->displayName(),
            'message' => mb_substr($message, 0, 800),
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
            'reactions' => [],
        ];
        if ($targetPlayerId !== null) {
            $chatMessage['targetPlayerId'] = $targetPlayerId;
            $chatMessage['targetDisplayName'] = $this->playerName($snapshot, $targetPlayerId);
        }

        $snapshot['chat'][] = $chatMessage;
        $snapshot['chat'] = array_slice($snapshot['chat'], -150);

        return null;
    }

    private function applyChatReactionToggled(array &$snapshot, array $payload, User $actor): ?string
    {
        $messageId = trim((string) ($payload['messageId'] ?? ''));
        $reaction = trim((string) ($payload['reaction'] ?? ''));
        if ($messageId === '' || !in_array($reaction, self::CHAT_REACTIONS, true)) {
            throw new \InvalidArgumentException('chat.reaction.toggled requires a valid messageId and reaction.');
        }

        foreach ($snapshot['chat'] as &$message) {
            if (!is_array($message) || ($message['id'] ?? null) !== $messageId) {
                continue;
            }

            if (!$this->canReactToChatMessage($message, $actor->id())) {
                throw new \InvalidArgumentException('You cannot react to this chat message.');
            }

            $message['reactions'] = $this->toggleChatReaction($message['reactions'] ?? [], $reaction, $actor);

            return null;
        }
        unset($message);

        throw new \InvalidArgumentException('Chat message not found.');
    }

    /**
     * @param mixed $reactions
     *
     * @return array<string,list<array{userId:string,displayName:string,createdAt:string}>>
     */
    private function toggleChatReaction(mixed $reactions, string $reaction, User $actor): array
    {
        $normalized = $this->normalizeChatReactions($reactions);
        $wasSelected = false;
        foreach ($normalized as $type => $entries) {
            $nextEntries = [];
            foreach ($entries as $entry) {
                if (($entry['userId'] ?? null) === $actor->id()) {
                    $wasSelected = $wasSelected || $type === $reaction;
                    continue;
                }
                $nextEntries[] = $entry;
            }
            $normalized[$type] = $nextEntries;
        }

        if (!$wasSelected) {
            $normalized[$reaction][] = [
                'userId' => $actor->id(),
                'displayName' => $actor->displayName(),
                'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
            ];
        }

        return array_filter($normalized, static fn (array $entries): bool => $entries !== []);
    }

    /**
     * @param array<string,mixed> $message
     */
    private function canReactToChatMessage(array $message, string $actorId): bool
    {
        if (($message['userId'] ?? null) === $actorId) {
            return false;
        }

        $targetPlayerId = $message['targetPlayerId'] ?? null;
        if (!is_string($targetPlayerId) || $targetPlayerId === '' || $targetPlayerId === 'all') {
            return true;
        }

        return $targetPlayerId === $actorId || ($message['userId'] ?? null) === $actorId;
    }

    private function applyDiceRolled(array $payload): string
    {
        $kind = trim((string) ($payload['kind'] ?? ''));
        if (!array_key_exists($kind, self::DICE_ROLL_LABELS)) {
            throw new \InvalidArgumentException('dice.rolled requires a supported kind.');
        }

        $finalResult = $this->randomizer->roll($kind);
        $this->pendingEventPayload = [
            'kind' => $kind,
            'finalResult' => (string) $finalResult,
        ];

        if ($kind === 'coin') {
            $result = match (strtolower((string) $finalResult)) {
                'cara' => 'Cara',
                'cruz' => 'Cruz',
                default => throw new \InvalidArgumentException('Invalid coin result.'),
            };

            return sprintf('ha tirado una %s, ha salido %s.', self::DICE_ROLL_LABELS[$kind], $result);
        }

        if (!is_int($finalResult)) {
            throw new \InvalidArgumentException('Invalid dice result.');
        }

        $sides = (int) substr($kind, 1);
        $result = $finalResult;
        if ($result < 1 || $result > $sides) {
            throw new \InvalidArgumentException('Invalid dice result.');
        }

        return sprintf('ha tirado un %s, ha salido un %d.', self::DICE_ROLL_LABELS[$kind], $result);
    }

    private function chatTargetPlayerId(array $snapshot, array $payload, User $actor): ?string
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

    private function chatEventPayload(array $payload): array
    {
        $targetPlayerId = $payload['targetPlayerId'] ?? null;

        return is_string($targetPlayerId) && $targetPlayerId !== '' && $targetPlayerId !== 'all'
            ? ['private' => true]
            : ['private' => false];
    }

    private function applyLifeChanged(array &$snapshot, array $payload): string
    {
        if (!array_key_exists('life', $payload) && !array_key_exists('delta', $payload)) {
            throw new \InvalidArgumentException('life.changed requires life or delta.');
        }

        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $oldLife = (int) ($snapshot['players'][$playerId]['life'] ?? 40);
        $newLife = array_key_exists('life', $payload)
            ? (int) $payload['life']
            : $oldLife + (int) ($payload['delta'] ?? 0);
        $snapshot['players'][$playerId]['life'] = $newLife;
        if ($oldLife <= 0 && !$this->hasPlayerDefeatedLog($snapshot, $playerId)) {
            $this->pendingDefeatedPlayerId = $playerId;
            $this->pendingDefeatPreexisted = true;
        } elseif ($oldLife > 0 && $newLife <= 0 && !$this->hasPlayerDefeatedLog($snapshot, $playerId)) {
            $this->pendingDefeatedPlayerId = $playerId;
        }

        return $this->lifeChangeLog($oldLife, $newLife);
    }

    private function applyCommanderDamageChanged(array &$snapshot, array $payload): string
    {
        $targetPlayerId = $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId');
        $sourcePlayerId = $this->requiredPlayerId($snapshot, $payload, 'sourcePlayerId');
        $commanderInstanceId = trim((string) ($payload['commanderInstanceId'] ?? ''));
        if ($targetPlayerId === $sourcePlayerId) {
            throw new \InvalidArgumentException('Commander damage source and target must differ.');
        }
        if ($commanderInstanceId === '') {
            throw new \InvalidArgumentException('commanderInstanceId is required.');
        }

        $commander = $this->requiredCommanderCard($snapshot, $sourcePlayerId, $commanderInstanceId);
        $current = (int) ($snapshot['players'][$targetPlayerId]['commanderDamage'][$commanderInstanceId] ?? 0);
        $damage = array_key_exists('damage', $payload)
            ? (int) $payload['damage']
            : $current + (int) ($payload['delta'] ?? 0);
        $nextDamage = max(0, $damage);
        $snapshot['players'][$targetPlayerId]['commanderDamage'][$commanderInstanceId] = $nextDamage;
        $this->pendingEventPayload = [
            ...$payload,
            'targetPlayerId' => $targetPlayerId,
            'sourcePlayerId' => $sourcePlayerId,
            'commanderInstanceId' => $commanderInstanceId,
            'damage' => $nextDamage,
        ];
        if ($current >= self::COMMANDER_DAMAGE_DEFEAT_THRESHOLD && !$this->hasPlayerDefeatedLog($snapshot, $targetPlayerId)) {
            $this->pendingDefeatedPlayerId = $targetPlayerId;
            $this->pendingDefeatPreexisted = true;
        } elseif ($current < self::COMMANDER_DAMAGE_DEFEAT_THRESHOLD
            && $nextDamage >= self::COMMANDER_DAMAGE_DEFEAT_THRESHOLD
            && !$this->hasPlayerDefeatedLog($snapshot, $targetPlayerId)
        ) {
            $this->pendingDefeatedPlayerId = $targetPlayerId;
        }

        return $this->commanderDamageLog(
            sprintf('%s (%s)', $this->cardLogName($commander), $this->playerName($snapshot, $sourcePlayerId)),
            $this->playerName($snapshot, $targetPlayerId),
            $current,
            $nextDamage,
        );
    }

    private function applyLegacyCounterChanged(array &$snapshot, array $payload): string
    {
        $scope = trim((string) ($payload['scope'] ?? 'global'));
        $key = trim((string) ($payload['key'] ?? ''));
        if ($key === '') {
            throw new \InvalidArgumentException('Counter key is required.');
        }
        if (str_starts_with($scope, 'player:')) {
            $playerId = substr($scope, strlen('player:'));
            if ($playerId === '' || !isset($snapshot['players'][$playerId])) {
                throw new \InvalidArgumentException('Player counter scope is invalid.');
            }
            if (!array_key_exists('value', $payload) && !array_key_exists('delta', $payload)) {
                throw new \InvalidArgumentException('Counter value or delta must be numeric.');
            }
            if (array_key_exists('value', $payload) && !is_numeric($payload['value'])) {
                throw new \InvalidArgumentException('Counter value or delta must be numeric.');
            }
            if (array_key_exists('delta', $payload) && !is_numeric($payload['delta'])) {
                throw new \InvalidArgumentException('Counter value or delta must be numeric.');
            }

            $previousValue = (int) ($snapshot['players'][$playerId]['counters'][$key] ?? 0);
            $value = array_key_exists('value', $payload)
                ? max(0, (int) $payload['value'])
                : max(0, $previousValue + (int) $payload['delta']);
            $snapshot['players'][$playerId]['counters'][$key] = $value;

            return $this->playerCounterLog($this->playerName($snapshot, $playerId), $key, $previousValue, $value);
        }

        if (!array_key_exists('value', $payload) || !is_numeric($payload['value'])) {
            throw new \InvalidArgumentException('Counter value must be numeric.');
        }

        $commander = null;
        if (str_starts_with($scope, 'commander:') && $key === 'casts') {
            [$scope, $commander] = $this->resolvedCommanderCounterScope($snapshot, $scope);
            $this->pendingEventPayload = [
                ...$payload,
                'scope' => $scope,
                'key' => $key,
            ];
        }

        $previousValue = (int) ($snapshot['counters'][$scope][$key] ?? 0);
        $value = str_starts_with($scope, 'commander:') && $key === 'casts'
            ? max(0, (int) $payload['value'])
            : (int) $payload['value'];
        $snapshot['counters'][$scope][$key] = $value;

        if (str_starts_with($scope, 'commander:') && $key === 'casts') {
            return $this->commanderCastCounterLog($previousValue, $value, $commander ? $this->cardLogName($commander) : null);
        }

        return sprintf('Set %s counter %s to %d.', $scope, $key, $value);
    }

    private function commanderDamageLog(string $sourceName, string $targetName, int $from, int $to): string
    {
        if ($to === $from) {
            return sprintf('Set commander damage from %s to %s to %d.', $sourceName, $targetName, $to);
        }

        return sprintf(
            'Commander damage from %s to %s %s from %d to %d.',
            $sourceName,
            $targetName,
            $to > $from ? 'increased' : 'decreased',
            $from,
            $to,
        );
    }

    private function lifeChangeLog(int $from, int $to): string
    {
        $amount = abs($to - $from);

        return $to < $from
            ? sprintf('Lost %d life (%d -> %d).', $amount, $from, $to)
            : sprintf('Gained %d life (%d -> %d).', $amount, $from, $to);
    }

    private function playerCounterLog(string $playerName, string $key, int $from, int $to): string
    {
        if ($to === $from) {
            return sprintf('Set %s %s counter to %d.', $playerName, $key, $to);
        }

        return sprintf(
            '%s %s counter %s from %d to %d.',
            $playerName,
            $key,
            $to > $from ? 'increased' : 'decreased',
            $from,
            $to,
        );
    }

    private function commanderCastCounterLog(int $previousValue, int $value, ?string $commanderName = null): string
    {
        $subject = $commanderName === null ? 'Commander cast count' : sprintf('%s cast count', $commanderName);
        if ($value > $previousValue) {
            return sprintf('%s increased from %d to %d.', $subject, $previousValue, $value);
        }

        if ($value < $previousValue) {
            return sprintf('%s decreased from %d to %d.', $subject, $previousValue, $value);
        }

        return '';
    }

    private function applyCardCounterChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $key = trim((string) ($payload['key'] ?? '+1/+1'));
        if ($key === '') {
            throw new \InvalidArgumentException('Counter key is required.');
        }

        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        if (($payload['remove'] ?? false) === true) {
            if (!array_key_exists($key, $card['counters'] ?? [])) {
                return '';
            }
            $previousValue = (int) ($card['counters'][$key] ?? 0);
            if ($this->isTheRingLevelCounter($card, $key)) {
                $card['counters'][$key] = 1;

                return sprintf('Set %s %s counters to 1.', $this->cardLogName($card), $key);
            }
            unset($card['counters'][$key]);
            $this->applyStatCounterDelta($card, $key, -$previousValue);

            return sprintf('Removed %s counter from %s.', $key, $this->cardLogName($card));
        }

        if (!array_key_exists($key, $card['counters'] ?? []) && count($card['counters'] ?? []) >= self::MAX_CARD_COUNTER_TYPES) {
            throw new \InvalidArgumentException(sprintf('Maximum %d different counters per card.', self::MAX_CARD_COUNTER_TYPES));
        }

        $value = array_key_exists('value', $payload)
            ? (int) $payload['value']
            : (int) ($card['counters'][$key] ?? 0) + (int) ($payload['delta'] ?? 0);
        $previousValue = (int) ($card['counters'][$key] ?? 0);
        $nextValue = $this->isTheRingLevelCounter($card, $key)
            ? max(1, min(4, $value))
            : max(0, $value);
        $card['counters'][$key] = $nextValue;
        $this->applyStatCounterDelta($card, $key, $nextValue - $previousValue);

        return sprintf('Set %s %s counters to %d.', $this->cardLogName($card), $key, $nextValue);
    }

    private function isTheRingLevelCounter(array $card, string $key): bool
    {
        return strtolower(trim($key)) === 'level' && $this->isTheRingCard($card);
    }

    private function applyPowerToughnessChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $previousPower = $card['power'] ?? null;
        $previousToughness = $card['toughness'] ?? null;
        $previousLoyalty = $card['loyalty'] ?? null;
        $previousDefense = $card['defense'] ?? null;
        $previousSaga = $card['saga'] ?? null;
        if (array_key_exists('power', $payload)) {
            $card['power'] = $payload['power'] === null ? null : (int) $payload['power'];
        }
        if (array_key_exists('toughness', $payload)) {
            $card['toughness'] = $payload['toughness'] === null ? null : (int) $payload['toughness'];
        }
        if (array_key_exists('loyalty', $payload)) {
            $card['loyalty'] = $payload['loyalty'] === null ? null : (int) $payload['loyalty'];
        }
        if (array_key_exists('defense', $payload)) {
            $card['defense'] = $payload['defense'] === null ? null : max(-1, min(99, (int) $payload['defense']));
        }
        if (array_key_exists('saga', $payload)) {
            $card['saga'] = $payload['saga'] === null ? null : max(1, min(9, (int) $payload['saga']));
        }

        if (array_key_exists('loyalty', $payload) && !array_key_exists('power', $payload) && !array_key_exists('toughness', $payload)) {
            $previous = $this->numericStat($previousLoyalty);
            $current = $this->numericStat($card['loyalty'] ?? null);
            $delta = $previous !== null && $current !== null ? $current - $previous : 0;
            $direction = $delta >= 0 ? 'increased' : 'decreased';
            $signedDelta = $delta > 0 ? sprintf('+%d', $delta) : (string) $delta;

            return sprintf(
                '%s loyalty %s from %s to %s (%s).',
                $this->cardLogName($card),
                $direction,
                $this->statLabel($previousLoyalty),
                $this->statLabel($card['loyalty'] ?? null),
                $signedDelta,
            );
        }

        if (array_key_exists('defense', $payload) && !array_key_exists('power', $payload) && !array_key_exists('toughness', $payload) && !array_key_exists('loyalty', $payload)) {
            $previous = $this->numericStat($previousDefense);
            $current = $this->numericStat($card['defense'] ?? null);
            $delta = $previous !== null && $current !== null ? $current - $previous : 0;
            $direction = $delta >= 0 ? 'increased' : 'decreased';
            $signedDelta = $delta > 0 ? sprintf('+%d', $delta) : (string) $delta;

            return sprintf(
                '%s defense %s from %s to %s (%s).',
                $this->cardLogName($card),
                $direction,
                $this->statLabel($previousDefense),
                $this->statLabel($card['defense'] ?? null),
                $signedDelta,
            );
        }

        if (array_key_exists('saga', $payload) && !array_key_exists('power', $payload) && !array_key_exists('toughness', $payload) && !array_key_exists('loyalty', $payload) && !array_key_exists('defense', $payload)) {
            $previous = $this->numericStat($previousSaga);
            $current = $this->numericStat($card['saga'] ?? null);
            $delta = $previous !== null && $current !== null ? $current - $previous : 0;
            $direction = $delta >= 0 ? 'increased' : 'decreased';
            $signedDelta = $delta > 0 ? sprintf('+%d', $delta) : (string) $delta;

            if ($delta === 0) {
                return sprintf(
                    '%s saga %s to %s.',
                    $this->cardLogName($card),
                    $direction,
                    $this->romanStatLabel($card['saga'] ?? null),
                );
            }

            return sprintf(
                '%s saga %s from %s to %s (%s).',
                $this->cardLogName($card),
                $direction,
                $this->romanStatLabel($previousSaga),
                $this->romanStatLabel($card['saga'] ?? null),
                $signedDelta,
            );
        }

        return sprintf(
            'Changed %s from %s/%s to %s/%s.',
            $this->cardLogName($card),
            $this->statLabel($previousPower),
            $this->statLabel($previousToughness),
            $this->statLabel($card['power'] ?? null),
            $this->statLabel($card['toughness'] ?? null),
        );
    }

    private function applyCardMoved(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $fromZone = $this->requiredZone($payload, 'fromZone');
        $toZone = $this->requiredZone($payload, 'toZone');
        $instanceId = trim((string) ($payload['instanceId'] ?? ''));
        if ($instanceId === '') {
            throw new \InvalidArgumentException('instanceId is required.');
        }

        $requestedTargetPlayerId = isset($payload['targetPlayerId'])
            ? $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId')
            : $playerId;
        $position = $payload['position'] ?? null;
        $movesWithinLibrary = $fromZone === 'library' && $toZone === 'library' && $position === 'bottom';
        if ($requestedTargetPlayerId === $playerId && $fromZone === $toZone && !$movesWithinLibrary) {
            return '';
        }

        $card = $this->takeCard($snapshot, $playerId, $fromZone, $instanceId);
        $faceDownLeavingBattlefield = $this->isFaceDownBattlefieldCardLeaving($fromZone, $toZone, $card);
        if (array_key_exists('faceDown', $payload)) {
            $card['faceDown'] = (bool) $payload['faceDown'];
            if ($card['faceDown']) {
                $card['revealedTo'] = [$playerId];
            }
        }
        if ($faceDownLeavingBattlefield) {
            $card['faceDown'] = false;
            $card['revealedTo'] = [];
        }
        if ($fromZone === 'library' && $toZone === 'hand') {
            $card['faceDown'] = false;
            $card['revealedTo'] = ($payload['reveal'] ?? false) === true ? ['all'] : [];
        }
        $targetPlayerId = $this->moveDestinationPlayerId($snapshot, $playerId, $fromZone, $toZone, $card, $requestedTargetPlayerId);
        $this->putCard(
            $snapshot,
            $targetPlayerId,
            $toZone,
            $card,
            $this->moveDestinationPosition($fromZone, $toZone, $payload),
            $fromZone === 'battlefield' && $toZone === 'battlefield',
        );

        if ($faceDownLeavingBattlefield) {
            return '';
        }

        if ($this->isEvaporatingTokenMove($card, $toZone)) {
            return sprintf('%s evaporated instead of moving to %s.', $this->cardLogName($card), $toZone);
        }

        if ($fromZone === 'hand' && $toZone === 'hand' && $targetPlayerId !== $playerId) {
            return sprintf(
                'Moved a card from %s hand to %s hand.',
                $this->possessivePlayerName($snapshot, $playerId),
                $this->possessivePlayerName($snapshot, $targetPlayerId),
            );
        }

        $libraryTopViewMessage = $fromZone === 'library'
            ? $this->libraryTopViewMoveMessage($payload, $toZone)
            : null;
        if ($libraryTopViewMessage !== null) {
            return $libraryTopViewMessage;
        }

        if ($fromZone === 'library' && $toZone === 'hand') {
            if (($payload['reveal'] ?? false) === true) {
                return sprintf(
                    'ha cogido %s de su library y la ha llevado a la mano revelada.',
                    $this->cardLogName($card),
                );
            }

            return 'ha cogido una carta mirando su library y la ha llevado a la mano.';
        }

        if ($movesWithinLibrary) {
            return sprintf('Moved a card to %s.', $this->libraryDestinationLabel($payload));
        }

        if ($toZone === 'library') {
            if ($this->shouldRevealLibraryMoveNames($fromZone, $toZone)) {
                return sprintf('Moved %s from %s to %s.', $this->cardLogName($card), $fromZone, $this->libraryDestinationLabel($payload));
            }

            return sprintf('Moved a card from %s to %s.', $fromZone, $this->libraryDestinationLabel($payload));
        }

        if ($fromZone === 'hand' && $toZone === 'battlefield' && ($card['faceDown'] ?? false) === true) {
            return 'Played a card face down.';
        }

        return sprintf('Moved %s from %s to %s.', $this->cardLogName($card), $fromZone, $toZone);
    }

    private function libraryTopViewMoveMessage(array $payload, string $toZone): ?string
    {
        $sourceContext = $payload['sourceContext'] ?? null;
        if (!is_array($sourceContext) || ($sourceContext['type'] ?? null) !== 'libraryTopView') {
            return null;
        }

        $count = (int) ($sourceContext['count'] ?? 0);
        if ($count < 1) {
            return null;
        }

        $destination = $toZone === 'library'
            ? $this->libraryDestinationLabel($payload)
            : $toZone;

        return sprintf(
            'Moved a card from the viewed top %d library %s to %s.',
            $count,
            $count === 1 ? 'card' : 'cards',
            $destination,
        );
    }

    private function applyCardsMoved(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $fromZone = $this->requiredZone($payload, 'fromZone');
        $toZone = $this->requiredZone($payload, 'toZone');
        $instanceIds = $payload['instanceIds'] ?? [];
        if (!is_array($instanceIds) || $instanceIds === []) {
            throw new \InvalidArgumentException('instanceIds are required.');
        }
        $requestedTargetPlayerId = isset($payload['targetPlayerId'])
            ? $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId')
            : $playerId;
        if ($requestedTargetPlayerId === $playerId && $fromZone === $toZone) {
            return '';
        }

        $moves = [];
        $movedCardNames = [];
        foreach ($instanceIds as $instanceId) {
            if (!is_string($instanceId) || $instanceId === '') {
                continue;
            }
            $card = $this->takeCard($snapshot, $playerId, $fromZone, $instanceId);
            $faceDownLeavingBattlefield = $this->isFaceDownBattlefieldCardLeaving($fromZone, $toZone, $card);
            if ($faceDownLeavingBattlefield) {
                $card['faceDown'] = false;
                $card['revealedTo'] = [];
            } else {
                $movedCardNames[] = $this->cardLogName($card);
            }
            $targetPlayerId = $this->moveDestinationPlayerId($snapshot, $playerId, $fromZone, $toZone, $card, $requestedTargetPlayerId);
            $moves[] = [$targetPlayerId, $card, $faceDownLeavingBattlefield];
        }

        $randomOrder = ($payload['randomOrder'] ?? false) === true && $toZone === 'library' && count($moves) > 1;
        if ($randomOrder) {
            $moves = $this->randomizer->shuffle($moves);
        }

        $moved = 0;
        $silentFaceDownMoves = 0;
        foreach ($moves as [$targetPlayerId, $card, $faceDownLeavingBattlefield]) {
            $this->putCard(
                $snapshot,
                $targetPlayerId,
                $toZone,
                $card,
                $this->moveDestinationPosition($fromZone, $toZone, $payload),
                $fromZone === 'battlefield' && $toZone === 'battlefield',
            );
            ++$moved;
            if ($faceDownLeavingBattlefield) {
                ++$silentFaceDownMoves;
            }
        }

        if ($moved > 0 && $silentFaceDownMoves === $moved) {
            return '';
        }

        if ($moved > 1 && ($toZone !== 'library' || $this->shouldRevealLibraryMoveNames($fromZone, $toZone))) {
            $this->pendingLogContext = ['cardNames' => $movedCardNames];
        }

        if ($randomOrder) {
            return $toZone === 'library'
                ? sprintf('Moved %d cards from %s to %s in random order.', $moved, $fromZone, $this->libraryDestinationLabel($payload))
                : sprintf('Moved %d cards from %s to %s in random order.', $moved, $fromZone, $toZone);
        }

        if ($toZone === 'library') {
            return sprintf('Moved %d cards from %s to %s.', $moved, $fromZone, $this->libraryDestinationLabel($payload));
        }

        return sprintf('Moved %d cards from %s to %s.', $moved, $fromZone, $toZone);
    }

    private function applyCardTapped(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['tapped'] = (bool) ($payload['tapped'] ?? !($card['tapped'] ?? false));
        $card['rotation'] = $card['tapped'] ? 90 : 0;

        return sprintf('%s %s.', $card['tapped'] ? 'Tapped' : 'Untapped', $this->cardLogName($card));
    }

    private function applyCardPositionChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        if ($location['zone'] !== 'battlefield') {
            throw new \InvalidArgumentException('Only battlefield cards can be freely positioned.');
        }

        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        if ($this->isDayNightCard($card)) {
            $card['position'] = $this->dayNightFixedPosition();

            return sprintf('Moved %s on battlefield.', $this->cardLogName($card));
        }

        $card['position'] = $this->normalizedPosition($payload['position'] ?? null);

        return sprintf('Moved %s on battlefield.', $this->cardLogName($card));
    }

    private function applyDungeonMarkerChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        if ($location['zone'] !== 'battlefield') {
            throw new \InvalidArgumentException('Only battlefield dungeon cards can have a dungeon marker.');
        }

        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        if (!$this->isDungeonCard($card)) {
            throw new \InvalidArgumentException('Only dungeon cards can have a dungeon marker.');
        }

        $card['dungeonMarker'] = $this->normalizedDungeonMarker($payload['position'] ?? null);

        return sprintf('Moved dungeon marker on %s.', $this->cardLogName($card));
    }

    private function applyCardsPositionChanged(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $zone = $this->requiredZone($payload);
        if ($zone !== 'battlefield') {
            throw new \InvalidArgumentException('Only battlefield cards can be freely positioned.');
        }

        $positions = $payload['positions'] ?? null;
        if (!is_array($positions) || $positions === []) {
            throw new \InvalidArgumentException('positions must contain at least one card position.');
        }

        $moved = 0;
        foreach ($positions as $positionPayload) {
            if (!is_array($positionPayload)) {
                throw new \InvalidArgumentException('Each position entry must be an object.');
            }

            $location = $this->requiredCardLocation($snapshot, [
                'playerId' => $playerId,
                'zone' => $zone,
                'instanceId' => $positionPayload['instanceId'] ?? null,
            ]);
            $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
            if ($this->isDayNightCard($card)) {
                $card['position'] = $this->dayNightFixedPosition();
                unset($card);
                continue;
            }

            $card['position'] = $this->normalizedPosition($positionPayload['position'] ?? null);
            unset($card);
            ++$moved;
        }

        return sprintf('Moved %d cards on battlefield.', $moved);
    }

    private function applyCardFaceDown(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['faceDown'] = (bool) ($payload['faceDown'] ?? !($card['faceDown'] ?? false));
        if ($card['faceDown']) {
            $card['revealedTo'] = [$location['playerId']];
        }

        return sprintf('%s %s.', $card['faceDown'] ? 'Turned face down' : 'Turned face up', $this->cardLogName($card));
    }

    private function applyCardFaceChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $faces = is_array($card['cardFaces'] ?? null) ? array_values($card['cardFaces']) : [];
        if (count($faces) < 2) {
            throw new \InvalidArgumentException('Card does not have multiple faces.');
        }

        $faceIndex = $this->positiveInt($payload['faceIndex'] ?? 0, 0, count($faces) - 1);
        $previousFaceName = $this->cardFaceLogName($card, $this->activeFaceIndex($card));
        $card['activeFaceIndex'] = $faceIndex;
        $nextFaceName = $this->cardFaceLogName($card, $faceIndex);

        if ($location['zone'] !== 'battlefield') {
            return '';
        }

        return sprintf('Flipped %s to %s.', $previousFaceName, $nextFaceName);
    }

    private function applyCardRevealed(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $targets = $this->visibilityTargets($snapshot, $payload['to'] ?? 'all');
        $card['revealedTo'] = $targets;

        return sprintf('ha revelado una carta a %s.', $this->visibilityTargetLabel($snapshot, $targets));
    }

    private function applyTokenCopyCreated(array &$snapshot, array $payload, User $actor): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $source = $this->normalizeCard(
            $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']],
            $location['playerId'],
            $location['zone'],
        );
        $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']] = $source;
        $targetPlayerId = isset($payload['targetPlayerId'])
            ? $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId')
            : $actor->id();
        if (!isset($snapshot['players'][$targetPlayerId])) {
            $targetPlayerId = $location['playerId'];
        }

        $copy = $this->normalizeCard([
            ...$source,
            'instanceId' => Uuid::v7()->toRfc4122(),
            'ownerId' => $targetPlayerId,
            'controllerId' => $targetPlayerId,
            'power' => $source['defaultPower'] ?? null,
            'toughness' => $source['defaultToughness'] ?? null,
            'loyalty' => $source['defaultLoyalty'] ?? null,
            'counters' => [],
            'zone' => 'battlefield',
            'isToken' => true,
            'isTokenCopy' => true,
        ], $targetPlayerId, 'battlefield');
        $copy['position'] = $this->tokenCopyPosition(
            $source['position'] ?? null,
            $snapshot['players'][$targetPlayerId]['zones']['battlefield'] ?? [],
        );
        $this->resetMutableStats($copy);
        $copy['counters'] = [];
        $snapshot['players'][$targetPlayerId]['zones']['battlefield'][] = $copy;

        return sprintf('Created Token Copy Of %s.', $this->cardBaseName($source));
    }

    private function applyTokenCreated(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $card = is_array($payload['card'] ?? null) ? $payload['card'] : [];
        $hasCardPayload = $card !== [];
        $name = $this->visualName($card['name'] ?? $payload['name'] ?? null, 'Token');
        $isTheRing = $this->isTheRingCard($card);
        $isDungeon = $this->isDungeonCard($card);
        $isEmblem = $this->isEmblemCard($card);
        $quantity = $isDungeon ? 1 : $this->positiveInt($payload['quantity'] ?? 1, 1, self::MAX_TOKEN_CREATE_QUANTITY);
        $tokens = [];
        $position = $quantity === 1 && array_key_exists('position', $payload)
            ? $this->normalizedPosition($payload['position'])
            : null;

        for ($index = 0; $index < $quantity; $index++) {
            $tokens[] = $this->normalizeCard([
                ...$card,
                'instanceId' => Uuid::v7()->toRfc4122(),
                'ownerId' => $playerId,
                'controllerId' => $playerId,
                'name' => $name,
                'typeLine' => $card['typeLine'] ?? 'Token Creature',
                'power' => $card['power'] ?? ($hasCardPayload ? null : 1),
                'toughness' => $card['toughness'] ?? ($hasCardPayload ? null : 1),
                'defaultPower' => $card['power'] ?? ($hasCardPayload ? null : 1),
                'defaultToughness' => $card['toughness'] ?? ($hasCardPayload ? null : 1),
                'tapped' => false,
                'position' => $position ?? $this->tokenPosition($index, $quantity),
                'zone' => 'battlefield',
                'isToken' => true,
                'isTokenCopy' => false,
                'isCommander' => false,
            ], $playerId, 'battlefield');
            if ($isTheRing) {
                $tokens[$index]['counters'] = ['Level' => 1];
            }
        }

        if ($isDungeon) {
            $this->removePlayerBattlefieldDungeons($snapshot, $playerId);
        }
        if ($isTheRing) {
            $this->removePlayerBattlefieldTheRingCards($snapshot, $playerId);
        }
        array_push($snapshot['players'][$playerId]['zones']['battlefield'], ...$tokens);
        if ($isDungeon || $isTheRing) {
            $this->pruneBattlefieldRelations($snapshot);
        }

        if ($quantity === 1 && $isEmblem) {
            return sprintf('%s gets emblem %s.', $this->playerName($snapshot, $playerId), $this->cardBaseName($tokens[0]));
        }

        if ($quantity === 1 && $isTheRing) {
            return sprintf('Created %s.', $this->cardBaseName($tokens[0]));
        }

        return $quantity === 1
            ? sprintf('Created %s.', $this->cardBaseName($tokens[0]))
            : sprintf('Created %d %s.', $quantity, $this->pluralCardName($this->cardBaseName($tokens[0])));
    }

    private function syncInitiativeUndercityFromHelperCreate(array &$snapshot, array $eventPayload): void
    {
        if (($eventPayload['template'] ?? null) !== 'initiative') {
            return;
        }

        $playerId = $this->resolveSnapshotPlayerId($snapshot, $eventPayload['ownerPlayerId'] ?? null);
        if ($playerId === null || $this->playerHasActiveDungeon($snapshot, $playerId)) {
            return;
        }

        $initiativeCard = is_array($eventPayload['card'] ?? null) ? $eventPayload['card'] : null;
        $undercity = $this->undercityCardFromInitiativeRef($initiativeCard, $playerId);
        if ($undercity === null) {
            return;
        }

        $this->removePlayerBattlefieldDungeons($snapshot, $playerId);
        $snapshot['players'][$playerId]['zones']['battlefield'][] = $undercity;
        $this->pruneBattlefieldRelations($snapshot);
    }

    /**
     * @param array<string,mixed>|null $initiativeCard
     *
     * @return array<string,mixed>|null
     */
    private function undercityCardFromInitiativeRef(?array $initiativeCard, string $playerId): ?array
    {
        if ($initiativeCard === null) {
            return null;
        }

        $faces = is_array($initiativeCard['cardFaces'] ?? null) ? array_values($initiativeCard['cardFaces']) : [];
        $undercityFace = is_array($faces[0] ?? null) ? $faces[0] : null;
        $faceName = trim((string) ($undercityFace['name'] ?? ''));
        if ($faceName === '') {
            return null;
        }

        $imageUris = is_array($undercityFace['imageUris'] ?? null)
            ? $undercityFace['imageUris']
            : (is_array($initiativeCard['imageUris'] ?? null) ? $initiativeCard['imageUris'] : []);

        return $this->normalizeCard([
            'instanceId' => Uuid::v7()->toRfc4122(),
            'ownerId' => $playerId,
            'controllerId' => $playerId,
            'scryfallId' => (string) ($initiativeCard['scryfallId'] ?? 'initiative-undercity'),
            'name' => $faceName,
            'imageUris' => $imageUris,
            'cardFaces' => $faces,
            'typeLine' => is_string($undercityFace['typeLine'] ?? null) ? $undercityFace['typeLine'] : 'Dungeon',
            'manaCost' => null,
            'oracleText' => is_string($undercityFace['oracleText'] ?? null) ? $undercityFace['oracleText'] : null,
            'colorIdentity' => [],
            'power' => null,
            'toughness' => null,
            'loyalty' => null,
            'tapped' => false,
            'activeFaceIndex' => 0,
            'position' => ['x' => 0, 'y' => 0, 'unit' => 'ratio'],
            'zone' => 'battlefield',
            'isToken' => true,
            'isTokenCopy' => false,
            'isCommander' => false,
            'layout' => 'dungeon',
        ], $playerId, 'battlefield');
    }

    private function applyControllerChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        if ($location['zone'] !== 'battlefield') {
            throw new \InvalidArgumentException('Only battlefield cards can change controller.');
        }

        $targetPlayerId = $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId');
        if ($targetPlayerId === $location['playerId']) {
            return '';
        }

        $card = $this->takeCard($snapshot, $location['playerId'], 'battlefield', (string) $payload['instanceId']);
        $this->putCard(
            $snapshot,
            $targetPlayerId,
            'battlefield',
            $card,
            $this->battlefieldCenterPosition(),
            true,
        );

        return sprintf('Gave %s to %s.', $this->cardLogName($card), $this->playerName($snapshot, $targetPlayerId));
    }

    private function applyTurnChanged(array &$snapshot, array $payload): string
    {
        if (!array_key_exists('activePlayerId', $payload)
            && !array_key_exists('phase', $payload)
            && !array_key_exists('number', $payload)) {
            throw new \InvalidArgumentException('turn.changed requires activePlayerId, phase, or number.');
        }

        $previousPhase = (string) ($snapshot['turn']['phase'] ?? '');
        $previousActivePlayerId = (string) ($snapshot['turn']['activePlayerId'] ?? '');
        $allowed = array_intersect_key($payload, array_flip(['activePlayerId', 'phase', 'number']));
        if (isset($allowed['activePlayerId'])) {
            $this->requiredPlayerId($snapshot, ['playerId' => $allowed['activePlayerId']]);
        }
        if (isset($allowed['phase']) && trim((string) $allowed['phase']) === '') {
            throw new \InvalidArgumentException('phase must not be empty.');
        }
        if (isset($allowed['number'])) {
            $allowed['number'] = max(1, (int) $allowed['number']);
        }
        $snapshot['turn'] = array_replace($snapshot['turn'] ?? [], $allowed);
        if (array_key_exists('activePlayerId', $allowed)) {
            $snapshot['turn']['activePlayerId'] = GameTurnSuccession::eligiblePlayerId(
                $snapshot,
                (string) $snapshot['turn']['activePlayerId'],
            );
        }

        $phase = (string) ($snapshot['turn']['phase'] ?? $previousPhase);
        $activePlayerId = (string) ($snapshot['turn']['activePlayerId'] ?? $previousActivePlayerId);
        if ($activePlayerId !== $previousActivePlayerId) {
            return sprintf(
                'Turno %d: empieza el turno de %s. Fase %s.',
                (int) ($snapshot['turn']['number'] ?? 1),
                $this->playerName($snapshot, $activePlayerId),
                $phase,
            );
        }

        if ($phase !== $previousPhase || array_key_exists('phase', $allowed)) {
            return sprintf('Fase %s.', $phase);
        }

        return sprintf('Turno %d.', (int) ($snapshot['turn']['number'] ?? 1));
    }

    private function applyZoneChanged(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $zone = $this->requiredZone($payload);
        if (!isset($payload['cards']) || !is_array($payload['cards'])) {
            throw new \InvalidArgumentException('cards are required.');
        }
        $existingCards = $snapshot['players'][$playerId]['zones'][$zone] ?? [];
        $existingIds = array_values(array_filter(array_map(
            static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
            $existingCards,
        )));
        $incomingIds = [];
        foreach ($payload['cards'] as $card) {
            if (!is_array($card)) {
                throw new \InvalidArgumentException('cards must be card objects.');
            }
            $instanceId = trim((string) ($card['instanceId'] ?? ''));
            if ($instanceId === '') {
                throw new \InvalidArgumentException('cards must include instanceId.');
            }
            $incomingIds[] = $instanceId;
        }
        sort($existingIds);
        sort($incomingIds);
        if ($existingIds !== $incomingIds) {
            throw new \InvalidArgumentException('zone.changed can only reorder existing cards.');
        }

        $snapshot['players'][$playerId]['zones'][$zone] = array_values(array_map(
            fn (array $card): array => $this->normalizeCard($card, $playerId, $zone),
            $payload['cards'],
        ));

        return sprintf('Reordered %s.', $zone);
    }

    private function applyBattlefieldUntapAll(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $battlefield =& $snapshot['players'][$playerId]['zones']['battlefield'];
        $untapped = 0;
        foreach ($battlefield as &$card) {
            if (($card['tapped'] ?? false) !== true) {
                continue;
            }

            $card['tapped'] = false;
            ++$untapped;
        }
        unset($card);

        if ($untapped === 0) {
            return '';
        }

        return sprintf('Untapped %d battlefield card%s.', $untapped, $untapped === 1 ? '' : 's');
    }

    private function applyZoneMoveAll(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $fromZone = $this->requiredZone($payload, 'fromZone');
        $toZone = $this->requiredZone($payload, 'toZone');
        if ($fromZone === $toZone) {
            return '';
        }

        $cards = $snapshot['players'][$playerId]['zones'][$fromZone];
        if ($cards === []) {
            return '';
        }

        $snapshot['players'][$playerId]['zones'][$fromZone] = [];
        foreach ($cards as $card) {
            $this->putCard(
                $snapshot,
                $playerId,
                $toZone,
                $card,
                $this->moveDestinationPosition($fromZone, $toZone, $payload),
                $fromZone === 'battlefield' && $toZone === 'battlefield',
            );
        }

        return $toZone === 'library'
            ? sprintf('Moved all cards from %s to %s.', $fromZone, $this->libraryDestinationLabel($payload))
            : sprintf('Moved all cards from %s to %s.', $fromZone, $toZone);
    }

    private function applyZoneRandomCardSelected(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $zone = $this->requiredZone($payload);
        if (!in_array($zone, ['library', 'hand', 'graveyard', 'exile'], true)) {
            throw new \InvalidArgumentException('zone does not support random selection.');
        }

        $cards = array_values(array_filter(
            $snapshot['players'][$playerId]['zones'][$zone] ?? [],
            static fn (mixed $card): bool => is_array($card),
        ));
        if ($cards === []) {
            return '';
        }

        $requestedInstanceId = trim((string) ($payload['instanceId'] ?? ''));
        $card = $requestedInstanceId !== ''
            ? $this->cardByInstanceId($cards, $requestedInstanceId)
            : $this->randomizer->pickOne($cards);
        $this->pendingEventPayload = [
            'playerId' => $playerId,
            'zone' => $zone,
            'instanceId' => (string) ($card['instanceId'] ?? ''),
        ];
        $this->pendingLogContext = [
            'cardInstanceId' => (string) ($card['instanceId'] ?? ''),
            'cardPlayerId' => $playerId,
            'cardZone' => $zone,
        ];

        return sprintf(
            'ha seleccionado al azar %s de %s.',
            $this->cardLogName($card),
            $this->zoneLogName($zone),
        );
    }

    private function applyMulliganTake(array &$snapshot, User $actor): string
    {
        $playerId = $this->mulliganActorPlayerId($snapshot, $actor);
        $this->assertMulliganStatus($snapshot, $playerId, self::MULLIGAN_STATUS_DECIDING);
        $currentState = $this->currentMulliganState($snapshot, $playerId);
        if (($currentState['canTakeAnotherMulligan'] ?? false) !== true) {
            throw new \InvalidArgumentException('Cannot take another mulligan.');
        }

        $this->returnHandToLibraryAndShuffle($snapshot, $playerId);
        $mulligansTaken = ((int) ($currentState['mulligansTaken'] ?? 0)) + 1;
        $this->refreshPlayerMulliganState($snapshot, $playerId, $mulligansTaken, self::MULLIGAN_STATUS_DECIDING);
        $nextState = $this->currentMulliganState($snapshot, $playerId);
        $this->drawMulliganHand($snapshot, $playerId, (int) $nextState['drawCount']);

        return 'ha hecho mulligan.';
    }

    private function applyMulliganKeep(array &$snapshot, array $payload, User $actor): string
    {
        $playerId = $this->mulliganActorPlayerId($snapshot, $actor);
        $this->assertMulliganStatus($snapshot, $playerId, self::MULLIGAN_STATUS_DECIDING);
        $state = $this->currentMulliganState($snapshot, $playerId);
        $rule = (string) $state['rule'];
        $bottomSelectionCount = (int) $state['bottomSelectionCount'];
        $bottomCardInstanceIds = $this->bottomCardInstanceIds($payload);

        if (in_array($rule, [Room::MULLIGAN_VANCOUVER, Room::MULLIGAN_PARIS], true) && $bottomCardInstanceIds !== []) {
            throw new \InvalidArgumentException('This mulligan rule does not allow bottom card selections.');
        }
        if ($bottomSelectionCount === 0 && $bottomCardInstanceIds !== []) {
            throw new \InvalidArgumentException('No bottom card selections are required.');
        }
        if ($bottomSelectionCount > 0 && count($bottomCardInstanceIds) !== $bottomSelectionCount) {
            throw new \InvalidArgumentException('Incorrect number of bottom cards selected.');
        }
        if ($bottomSelectionCount > 0) {
            $this->assertCardsAreInHand($snapshot, $playerId, $bottomCardInstanceIds);
            $selectedCards = [];
            foreach ($bottomCardInstanceIds as $instanceId) {
                $selectedCards[] = $this->takeCard($snapshot, $playerId, 'hand', $instanceId);
            }
            if ($rule === Room::MULLIGAN_GENEROUS) {
                $selectedCards = $this->randomizer->shuffle($selectedCards);
            }
            foreach ($selectedCards as $card) {
                $this->putCard($snapshot, $playerId, 'library', $card, 'bottom');
            }
        }
        $this->pendingEventPayload = [
            'bottomCardCount' => count($bottomCardInstanceIds),
        ];

        if (($state['needsScryAfterKeep'] ?? false) === true) {
            $topCard = $snapshot['players'][$playerId]['zones']['library'][0] ?? null;
            if (!is_array($topCard)) {
                $this->refreshPlayerMulliganState($snapshot, $playerId, (int) $state['mulligansTaken'], self::MULLIGAN_STATUS_READY);

                return $this->advanceGamePhaseIfMulliganReady($snapshot)
                    ? 'Mulligan phase completed.'
                    : 'ha hecho keep.';
            }
            $this->refreshPlayerMulliganState(
                $snapshot,
                $playerId,
                (int) $state['mulligansTaken'],
                self::MULLIGAN_STATUS_SCRYING,
                (string) ($topCard['instanceId'] ?? ''),
            );

            return 'ha hecho keep y debe hacer scry 1.';
        }

        $this->refreshPlayerMulliganState($snapshot, $playerId, (int) $state['mulligansTaken'], self::MULLIGAN_STATUS_READY);

        return $this->advanceGamePhaseIfMulliganReady($snapshot)
            ? 'Mulligan phase completed.'
            : 'ha hecho keep.';
    }

    private function applyMulliganScryConfirm(array &$snapshot, array $payload, User $actor): string
    {
        $playerId = $this->mulliganActorPlayerId($snapshot, $actor);
        $this->assertMulliganStatus($snapshot, $playerId, self::MULLIGAN_STATUS_SCRYING);
        $state = $this->currentMulliganState($snapshot, $playerId);
        if (($state['rule'] ?? null) !== Room::MULLIGAN_VANCOUVER) {
            throw new \InvalidArgumentException('Only Vancouver mulligan can confirm scry.');
        }
        $destination = $payload['destination'] ?? null;
        if (!in_array($destination, ['TOP', 'BOTTOM'], true)) {
            throw new \InvalidArgumentException('Scry destination is invalid.');
        }
        $this->pendingEventPayload = [];
        $scryCardInstanceId = is_string($state['scryCardInstanceId'] ?? null) ? $state['scryCardInstanceId'] : '';
        if ($scryCardInstanceId === '') {
            throw new \InvalidArgumentException('No scry card is pending.');
        }
        $topCard = $snapshot['players'][$playerId]['zones']['library'][0] ?? null;
        if (!is_array($topCard) || (string) ($topCard['instanceId'] ?? '') !== $scryCardInstanceId) {
            throw new \InvalidArgumentException('Pending scry card is not on top of the library.');
        }
        if ($destination === 'BOTTOM') {
            $card = $this->takeCard($snapshot, $playerId, 'library', $scryCardInstanceId);
            $this->putCard($snapshot, $playerId, 'library', $card, 'bottom');
        }

        $this->refreshPlayerMulliganState($snapshot, $playerId, (int) $state['mulligansTaken'], self::MULLIGAN_STATUS_READY);

        return $this->advanceGamePhaseIfMulliganReady($snapshot)
            ? 'Mulligan phase completed.'
            : 'ha confirmado scry 1.';
    }

    private function applyLibraryDraw(array &$snapshot, array $payload, int $count): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $drawn = 0;
        for ($i = 0; $i < $count; ++$i) {
            $card = $this->takeTopLibraryCard($snapshot, $playerId);
            if (!is_array($card)) {
                break;
            }
            $this->putCard($snapshot, $playerId, 'hand', $card);
            ++$drawn;
        }

        return sprintf('ha robado %d carta%s.', $drawn, $drawn === 1 ? '' : 's');
    }

    private function applyLibraryShuffle(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $snapshot['players'][$playerId]['zones']['library'] = $this->randomizer->shuffle($snapshot['players'][$playerId]['zones']['library']);
        foreach ($snapshot['players'][$playerId]['zones']['library'] as &$card) {
            $card['revealedTo'] = [];
        }
        unset($card);
        $snapshot['players'][$playerId]['revealedLibraryTo'] = [];

        return 'ha hecho shuffle a su library.';
    }

    private function applyLibraryMoveTop(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $toZone = $this->requiredZone($payload, 'toZone');
        $targetPlayerId = isset($payload['targetPlayerId'])
            ? $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId')
            : $playerId;
        $count = $this->positiveInt($payload['count'] ?? 1, 1, 99);
        $moved = 0;
        $movedCardNames = [];
        for ($i = 0; $i < $count; ++$i) {
            $card = $this->takeTopLibraryCard($snapshot, $playerId);
            if (!is_array($card)) {
                break;
            }
            $movedCardNames[] = $this->cardLogName($card);
            $this->putCard(
                $snapshot,
                $targetPlayerId,
                $toZone,
                $card,
                $this->moveDestinationPosition('library', $toZone, $payload),
            );
            ++$moved;
        }

        if ($toZone === 'hand' && $targetPlayerId !== $playerId) {
            return sprintf(
                'Moved top %d library card%s to %s hand.',
                $moved,
                $moved === 1 ? '' : 's',
                $this->possessivePlayerName($snapshot, $targetPlayerId),
            );
        }
        if ($toZone === 'library' && ($payload['position'] ?? null) === 'bottom') {
            return sprintf('Moved top %d card%s to bottom of library.', $moved, $moved === 1 ? '' : 's');
        }
        if ($toZone === 'battlefield' && $moved > 0) {
            $this->pendingLogContext = ['cardNames' => $movedCardNames];

            return sprintf(
                'Moved top %d library card%s to %s battlefield.',
                $moved,
                $moved === 1 ? '' : 's',
                $this->possessivePlayerName($snapshot, $targetPlayerId),
            );
        }

        return $toZone === 'library'
            ? sprintf('Moved top %d card%s to %s.', $moved, $moved === 1 ? '' : 's', $this->libraryDestinationLabel($payload))
            : sprintf('Moved top %d card%s to %s.', $moved, $moved === 1 ? '' : 's', $toZone);
    }

    private function applyLibraryRevealTop(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $count = $this->positiveInt($payload['count'] ?? 1, 1, 99);
        $targets = $this->visibilityTargets($snapshot, $payload['to'] ?? 'all');
        $library =& $snapshot['players'][$playerId]['zones']['library'];
        $revealed = 0;
        foreach ($library as &$card) {
            $card['revealedTo'] = [];
        }
        unset($card);

        for ($i = 0; $i < $count; ++$i) {
            if (!isset($library[$i])) {
                break;
            }
            $library[$i]['faceDown'] = false;
            $library[$i]['revealedTo'] = $targets;
            ++$revealed;
        }

        return sprintf(
            'Revealed top %d library card%s to %s.',
            $revealed,
            $revealed === 1 ? '' : 's',
            $this->visibilityTargetLabel($snapshot, $targets),
        );
    }

    private function applyLibraryReveal(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $targets = $this->visibilityTargets($snapshot, $payload['to'] ?? 'all');
        foreach ($snapshot['players'][$playerId]['zones']['library'] as &$card) {
            $card['faceDown'] = false;
            $card['revealedTo'] = $targets;
        }
        unset($card);
        $snapshot['players'][$playerId]['revealedLibraryTo'] = $targets;

        return sprintf(
            'ha revelado su library a %s.',
            $this->visibilityTargetLabel($snapshot, $targets),
        );
    }

    private function applyLibraryView(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $count = isset($payload['count'])
            ? $this->positiveInt($payload['count'], 1, 99)
            : null;

        return $count === null
            ? 'ha mirado el orden de su library.'
            : sprintf('ha mirado sus proximos %d robos en library.', $count);
    }

    private function applyLibraryPlayTopRevealed(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $enabled = (bool) ($payload['enabled'] ?? true);
        $snapshot['players'][$playerId]['playTopLibraryRevealed'] = $enabled;

        return $enabled
            ? 'juega con la top card de su library revelada.'
            : 'deja de jugar con la top card de su library revelada.';
    }

    private function applyLibraryReorderTop(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $instanceIds = $payload['instanceIds'] ?? [];
        if (!is_array($instanceIds) || $instanceIds === []) {
            throw new \InvalidArgumentException('instanceIds are required.');
        }

        $requestedIds = array_values(array_filter(
            array_map(static fn (mixed $id): string => is_string($id) ? trim($id) : '', $instanceIds),
            static fn (string $id): bool => $id !== '',
        ));
        if ($requestedIds === []) {
            throw new \InvalidArgumentException('instanceIds are required.');
        }

        $library =& $snapshot['players'][$playerId]['zones']['library'];
        $count = count($requestedIds);
        if (count($library) < $count) {
            throw new \InvalidArgumentException('Library does not contain enough cards.');
        }

        $topCards = array_slice($library, 0, $count);
        $topById = [];
        foreach ($topCards as $card) {
            $instanceId = (string) ($card['instanceId'] ?? '');
            if ($instanceId !== '') {
                $topById[$instanceId] = $card;
            }
        }

        $currentIds = array_keys($topById);
        $sortedCurrentIds = $currentIds;
        $sortedRequestedIds = $requestedIds;
        sort($sortedCurrentIds);
        sort($sortedRequestedIds);
        if ($sortedCurrentIds !== $sortedRequestedIds) {
            throw new \InvalidArgumentException('Can only reorder the currently viewed top library cards.');
        }

        $reorderedTop = array_map(static fn (string $id): array => $topById[$id], $requestedIds);
        $library = array_values([...$reorderedTop, ...array_slice($library, $count)]);

        return sprintf('ha alterado el orden de sus proximos %d robos.', $count);
    }

    private function takeTopLibraryCard(array &$snapshot, string $playerId): ?array
    {
        $library =& $snapshot['players'][$playerId]['zones']['library'];
        if ($library === []) {
            return null;
        }

        $card = array_shift($library);

        return is_array($card) ? $card : null;
    }

    private function applyStackCardAdded(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card = $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $snapshot['stack'][] = [
            'id' => Uuid::v7()->toRfc4122(),
            'kind' => 'card',
            'card' => $card,
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];

        return sprintf('Added %s to stack.', $this->cardLogName($card));
    }

    private function applyStackItemRemoved(array &$snapshot, array $payload): string
    {
        $id = trim((string) ($payload['id'] ?? ''));
        if ($id === '') {
            throw new \InvalidArgumentException('id is required.');
        }
        $snapshot['stack'] = array_values(array_filter(
            $snapshot['stack'],
            static fn (array $item): bool => ($item['id'] ?? null) !== $id,
        ));

        return 'Removed item from stack.';
    }

    private function applyArrowCreated(array &$snapshot, array $payload, User $actor): string
    {
        $fromInstanceId = trim((string) ($payload['fromInstanceId'] ?? ''));
        $toInstanceId = trim((string) ($payload['toInstanceId'] ?? ''));
        if ($fromInstanceId === '' || $toInstanceId === '') {
            throw new \InvalidArgumentException('fromInstanceId and toInstanceId are required.');
        }
        if (!$this->battlefieldContainsInstance($snapshot, $fromInstanceId) || !$this->battlefieldContainsInstance($snapshot, $toInstanceId)) {
            throw new \InvalidArgumentException('Arrow endpoints must be battlefield cards.');
        }

        $snapshot['arrows'][] = [
            'id' => Uuid::v7()->toRfc4122(),
            'ownerId' => $actor->id(),
            'fromInstanceId' => $fromInstanceId,
            'toInstanceId' => $toInstanceId,
            'color' => trim((string) ($payload['color'] ?? 'yellow')),
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];

        return 'Created arrow.';
    }

    private function applyArrowRemoved(array &$snapshot, array $payload, User $actor): string
    {
        $id = trim((string) ($payload['id'] ?? ''));
        if ($id === '') {
            throw new \InvalidArgumentException('id is required.');
        }
        foreach ($snapshot['arrows'] as $arrow) {
            if (($arrow['id'] ?? null) !== $id) {
                continue;
            }
            if (isset($arrow['ownerId']) && (string) $arrow['ownerId'] !== $actor->id()) {
                throw new \InvalidArgumentException('Only the arrow owner can remove it.');
            }
            break;
        }
        $snapshot['arrows'] = array_values(array_filter(
            $snapshot['arrows'],
            static fn (array $arrow): bool => ($arrow['id'] ?? null) !== $id,
        ));

        return 'Removed arrow.';
    }

    private function applyAttachmentCreated(array &$snapshot, array $payload, User $actor): ?string
    {
        $equipmentInstanceId = trim((string) ($payload['equipmentInstanceId'] ?? ''));
        $attachedToInstanceId = trim((string) ($payload['attachedToInstanceId'] ?? ''));
        if ($equipmentInstanceId === '' || $attachedToInstanceId === '') {
            throw new \InvalidArgumentException('equipmentInstanceId and attachedToInstanceId are required.');
        }
        if ($equipmentInstanceId === $attachedToInstanceId) {
            throw new \InvalidArgumentException('A card cannot be attached to itself.');
        }
        $equipmentLocation = $this->battlefieldCardLocationByInstance($snapshot, $equipmentInstanceId);
        $attachedToLocation = $this->battlefieldCardLocationByInstance($snapshot, $attachedToInstanceId);
        $equipmentCard = $equipmentLocation['card'] ?? null;
        $attachedToCard = $attachedToLocation['card'] ?? null;
        if ($equipmentCard === null || $attachedToCard === null) {
            throw new \InvalidArgumentException('Attachment endpoints must be battlefield cards.');
        }
        if (($equipmentLocation['playerId'] ?? null) !== ($attachedToLocation['playerId'] ?? null)) {
            throw new \InvalidArgumentException('Attachments must stay on the same battlefield.');
        }
        if (($equipmentLocation['playerId'] ?? null) !== $actor->id()) {
            throw new \InvalidArgumentException('You can only attach cards on your battlefield.');
        }
        if ($this->isLandCard($equipmentCard)) {
            throw new \InvalidArgumentException('Lands cannot be attached to another permanent.');
        }
        if ($this->isGameplayCard($equipmentCard)) {
            throw new \InvalidArgumentException(sprintf('%s cannot be attached to another permanent.', $this->gameplayCardLabel($equipmentCard)));
        }
        if ($this->isTheRingCard($attachedToCard)) {
            throw new \InvalidArgumentException('The Ring cannot be an attachment target.');
        }
        if ($this->isGameplayCard($attachedToCard)) {
            throw new \InvalidArgumentException(sprintf('%s cannot be attachment targets.', $this->gameplayCardLabel($attachedToCard)));
        }
        foreach ($snapshot['attachments'] ?? [] as $attachment) {
            if (($attachment['attachedToInstanceId'] ?? null) === $equipmentInstanceId) {
                throw new \InvalidArgumentException('Cards with attached permanents cannot be attached to another permanent.');
            }
        }

        $snapshot['attachments'] = array_values(array_filter(
            $snapshot['attachments'] ?? [],
            static fn (array $attachment): bool => ($attachment['equipmentInstanceId'] ?? null) !== $equipmentInstanceId,
        ));
        $snapshot['attachments'][] = [
            'id' => Uuid::v7()->toRfc4122(),
            'ownerId' => $actor->id(),
            'equipmentInstanceId' => $equipmentInstanceId,
            'attachedToInstanceId' => $attachedToInstanceId,
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];

        return null;
    }

    private function applyAttachmentRemoved(array &$snapshot, array $payload, User $actor): ?string
    {
        $id = trim((string) ($payload['id'] ?? ''));
        $equipmentInstanceId = trim((string) ($payload['equipmentInstanceId'] ?? ''));
        if ($id === '' && $equipmentInstanceId === '') {
            throw new \InvalidArgumentException('id or equipmentInstanceId is required.');
        }

        foreach ($snapshot['attachments'] ?? [] as $attachment) {
            $matches = $id !== ''
                ? ($attachment['id'] ?? null) === $id
                : ($attachment['equipmentInstanceId'] ?? null) === $equipmentInstanceId;
            if (!$matches) {
                continue;
            }
            if (isset($attachment['ownerId']) && (string) $attachment['ownerId'] !== $actor->id()) {
                throw new \InvalidArgumentException('Only the attachment owner can remove it.');
            }
            break;
        }

        $snapshot['attachments'] = array_values(array_filter(
            $snapshot['attachments'] ?? [],
            static fn (array $attachment): bool => $id !== ''
                ? ($attachment['id'] ?? null) !== $id
                : ($attachment['equipmentInstanceId'] ?? null) !== $equipmentInstanceId,
        ));

        return null;
    }

    private function battlefieldContainsInstance(array $snapshot, string $instanceId): bool
    {
        return $this->battlefieldCardByInstance($snapshot, $instanceId) !== null;
    }

    /**
     * @return array<string,mixed>|null
     */
    private function battlefieldCardByInstance(array $snapshot, string $instanceId): ?array
    {
        $location = $this->battlefieldCardLocationByInstance($snapshot, $instanceId);

        return $location['card'] ?? null;
    }

    /**
     * @return array{playerId:string,card:array<string,mixed>}|null
     */
    private function battlefieldCardLocationByInstance(array $snapshot, string $instanceId): ?array
    {
        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            foreach (($player['zones']['battlefield'] ?? []) as $card) {
                if (($card['instanceId'] ?? null) === $instanceId) {
                    return ['playerId' => (string) $playerId, 'card' => $card];
                }
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isLandCard(array $card): bool
    {
        return preg_match('/\bland\b/i', (string) ($card['typeLine'] ?? '')) === 1;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isDungeonCard(array $card): bool
    {
        if (strtolower((string) ($card['layout'] ?? '')) === 'dungeon') {
            return true;
        }

        return str_starts_with(strtolower(trim((string) ($card['typeLine'] ?? ''))), 'dungeon');
    }

    private function playerHasActiveDungeon(array $snapshot, string $playerId): bool
    {
        $battlefield = $snapshot['players'][$playerId]['zones']['battlefield'] ?? [];
        if (!is_array($battlefield)) {
            return false;
        }

        foreach ($battlefield as $card) {
            if (is_array($card) && $this->isDungeonCard($card)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isEmblemCard(array $card): bool
    {
        if ($this->isTheRingCard($card)) {
            return false;
        }

        if (strtolower((string) ($card['layout'] ?? '')) === 'emblem') {
            return true;
        }

        $typeLine = strtolower(trim((string) ($card['typeLine'] ?? '')));

        return $typeLine === 'emblem' || str_starts_with($typeLine, 'emblem ');
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isDayNightCard(array $card): bool
    {
        return trim((string) ($card['name'] ?? '')) === 'Day // Night'
            && strtolower(trim((string) ($card['layout'] ?? ''))) === 'double_faced_token';
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isTheRingCard(array $card): bool
    {
        if (strtolower(trim((string) ($card['layout'] ?? ''))) !== 'double_faced_token') {
            return false;
        }

        if (strtolower(trim((string) ($card['scryfallId'] ?? ''))) === self::THE_RING_SCRYFALL_ID) {
            return true;
        }

        $name = strtolower(trim((string) ($card['name'] ?? '')));

        return $name === 'the ring' || $name === 'the ring // the ring tempts you';
    }

    /**
     * @return array{x:int,y:int,unit:string}
     */
    private function dayNightFixedPosition(): array
    {
        return ['x' => 1, 'y' => 0, 'unit' => 'ratio'];
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isGameplayCard(array $card): bool
    {
        return $this->isEmblemCard($card) || $this->isDungeonCard($card);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function gameplayCardLabel(array $card): string
    {
        return $this->isDungeonCard($card) ? 'Dungeons' : 'Emblems';
    }

    private function removePlayerBattlefieldDungeons(array &$snapshot, string $playerId): void
    {
        $battlefield = $snapshot['players'][$playerId]['zones']['battlefield'] ?? [];
        if (!is_array($battlefield)) {
            return;
        }

        $snapshot['players'][$playerId]['zones']['battlefield'] = array_values(array_filter(
            $battlefield,
            fn (mixed $card): bool => !is_array($card) || !$this->isDungeonCard($card),
        ));
    }

    private function removePlayerBattlefieldTheRingCards(array &$snapshot, string $playerId): void
    {
        $battlefield = $snapshot['players'][$playerId]['zones']['battlefield'] ?? [];
        if (!is_array($battlefield)) {
            return;
        }

        $snapshot['players'][$playerId]['zones']['battlefield'] = array_values(array_filter(
            $battlefield,
            fn (mixed $card): bool => !is_array($card) || !$this->isTheRingCard($card),
        ));
    }

    private function pruneBattlefieldRelations(array &$snapshot): void
    {
        $battlefieldInstanceIds = $this->battlefieldInstanceIds($snapshot);

        $snapshot['arrows'] = array_values(array_filter(
            $snapshot['arrows'] ?? [],
            static fn (array $arrow): bool => isset($battlefieldInstanceIds[(string) ($arrow['fromInstanceId'] ?? '')])
                && isset($battlefieldInstanceIds[(string) ($arrow['toInstanceId'] ?? '')]),
        ));
        $snapshot['attachments'] = array_values(array_filter(
            $snapshot['attachments'] ?? [],
            static fn (array $attachment): bool => isset($battlefieldInstanceIds[(string) ($attachment['equipmentInstanceId'] ?? '')])
                && isset($battlefieldInstanceIds[(string) ($attachment['attachedToInstanceId'] ?? '')]),
        ));
    }

    /**
     * @return array<string,true>
     */
    private function battlefieldInstanceIds(array $snapshot): array
    {
        $battlefieldInstanceIds = [];
        foreach ($snapshot['players'] ?? [] as $player) {
            foreach (($player['zones']['battlefield'] ?? []) as $card) {
                $instanceId = (string) ($card['instanceId'] ?? '');
                if ($instanceId !== '') {
                    $battlefieldInstanceIds[$instanceId] = true;
                }
            }
        }

        return $battlefieldInstanceIds;
    }

    private function commit(array &$snapshot, string $type, ?string $message, User $actor): void
    {
        $snapshot['version'] = ((int) ($snapshot['version'] ?? 1)) + 1;
        $snapshot['updatedAt'] = (new \DateTimeImmutable())->format(DATE_ATOM);

        $actorId = $actor->id();
        $actorIsDefeated = $this->playerIsDefeated($snapshot, $actorId);
        $deathAlreadyLogged = $this->hasPlayerDefeatedLog($snapshot, $actorId);
        $deathPending = $this->pendingDefeatedPlayerId === $actorId && !$deathAlreadyLogged;
        if ($deathAlreadyLogged) {
            $this->pendingLogContext = [];
            $this->pendingEventPayload = null;
            $this->pendingDefeatedPlayerId = null;
            $this->pendingDefeatPreexisted = false;
            return;
        }

        if ($this->pendingDefeatPreexisted && $deathPending) {
            $this->appendLogEntry($snapshot, 'player.defeated', $this->playerDefeatedMessage($snapshot, $actorId), $actor);
            $this->pendingLogContext = [];
            $this->pendingEventPayload = null;
            $this->pendingDefeatedPlayerId = null;
            $this->pendingDefeatPreexisted = false;
            return;
        }

        if ($actorIsDefeated && !$deathPending) {
            $this->appendLogEntry($snapshot, 'player.defeated', $this->playerDefeatedMessage($snapshot, $actorId), $actor);
            $this->pendingLogContext = [];
            $this->pendingEventPayload = null;
            $this->pendingDefeatedPlayerId = null;
            $this->pendingDefeatPreexisted = false;
            return;
        }

        if ($message !== null && $message !== '') {
            $this->appendLogEntry($snapshot, $type, $message, $actor, $this->pendingLogContext);
        }
        if ($deathPending) {
            $this->appendLogEntry($snapshot, 'player.defeated', $this->playerDefeatedMessage($snapshot, $actorId), $actor);
        }
        $this->pendingLogContext = [];
        $this->pendingEventPayload = null;
        $this->pendingDefeatedPlayerId = null;
        $this->pendingDefeatPreexisted = false;
    }

    /**
     * @param array<string,mixed> $context
     */
    private function appendLogEntry(array &$snapshot, string $type, string $message, User $actor, array $context = []): void
    {
        if (!$this->preservesActorPrefix($message)) {
            $message = $this->messageWithoutActorPrefix($message, $actor);
        }
        $entry = [
            'id' => Uuid::v7()->toRfc4122(),
            'type' => $type,
            'message' => $message,
            'actorId' => $actor->id(),
            'displayName' => $actor->displayName(),
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
        if ($context !== []) {
            $entry = [...$entry, ...$context];
        }

        $snapshot['eventLog'][] = $entry;
        $snapshot['eventLog'] = array_slice($snapshot['eventLog'], -250);
    }

    private function preservesActorPrefix(string $message): bool
    {
        return str_contains($message, ' gets emblem ');
    }

    private function messageWithoutActorPrefix(string $message, User $actor): string
    {
        foreach ([$actor->displayName(), $actor->id()] as $actorLabel) {
            $actorLabel = trim((string) $actorLabel);
            if ($actorLabel === '') {
                continue;
            }

            $message = preg_replace(
                '/^'.preg_quote($actorLabel, '/').'(?:\\s+|:\\s*|-\\s*)/u',
                '',
                $message,
            ) ?? $message;
        }

        return trim($message);
    }

    private function hasPlayerDefeatedLog(array $snapshot, string $playerId): bool
    {
        foreach ($snapshot['eventLog'] ?? [] as $entry) {
            if (($entry['type'] ?? null) === 'player.defeated' && ($entry['actorId'] ?? null) === $playerId) {
                return true;
            }
        }

        return false;
    }

    private function playerIsDefeated(array $snapshot, string $playerId): bool
    {
        return GameTurnSuccession::playerIsDefeated($snapshot, $playerId);
    }

    private function playerDefeatedMessage(array $snapshot, string $playerId): string
    {
        return sprintf('%s ha muerto.', $this->playerName($snapshot, $playerId));
    }

    private function playerIsAliveForTurn(array $snapshot, string $playerId): bool
    {
        return GameTurnSuccession::playerIsAliveForTurn($snapshot, $playerId);
    }

    private function takeCard(array &$snapshot, string $playerId, string $zone, string $instanceId): array
    {
        foreach ($snapshot['players'][$playerId]['zones'][$zone] as $index => $card) {
            if (($card['instanceId'] ?? null) === $instanceId) {
                array_splice($snapshot['players'][$playerId]['zones'][$zone], $index, 1);

                return $card;
            }
        }

        throw new \InvalidArgumentException('Card not found.');
    }

    private function mulliganActorPlayerId(array $snapshot, User $actor): string
    {
        if (($snapshot['gamePhase'] ?? null) !== self::GAME_PHASE_MULLIGAN) {
            throw new \InvalidArgumentException('Game is not in mulligan phase.');
        }
        $playerId = $this->resolveSnapshotPlayerId($snapshot, $actor->id());
        if ($playerId === null) {
            throw new \InvalidArgumentException('Actor is not a game player.');
        }

        return $playerId;
    }

    private function assertMulliganStatus(array $snapshot, string $playerId, string $expectedStatus): void
    {
        $status = $snapshot['players'][$playerId]['mulligan']['status'] ?? self::MULLIGAN_STATUS_DECIDING;
        if ($status !== $expectedStatus) {
            throw new \InvalidArgumentException(sprintf('Player is not %s for mulligan.', strtolower($expectedStatus)));
        }
    }

    /**
     * @return array<string,mixed>
     */
    private function currentMulliganState(array $snapshot, string $playerId): array
    {
        $mulligan = $snapshot['players'][$playerId]['mulligan'] ?? [];

        return is_array($mulligan) ? $mulligan : [];
    }

    private function refreshPlayerMulliganState(
        array &$snapshot,
        string $playerId,
        int $mulligansTaken,
        string $status,
        ?string $scryCardInstanceId = null,
    ): void {
        $rule = (string) ($snapshot['mulligan']['rule'] ?? Room::DEFAULT_MULLIGAN_RULE);
        $firstMulliganFree = (bool) ($snapshot['mulligan']['firstMulliganFree'] ?? false);
        $state = GameMulliganRules::calculateMulliganState($rule, $firstMulliganFree, $mulligansTaken);
        $snapshot['players'][$playerId]['mulligan'] = [
            ...$state,
            'status' => $status,
            'ready' => $status === self::MULLIGAN_STATUS_READY,
            'scryCardInstanceId' => $status === self::MULLIGAN_STATUS_SCRYING && $scryCardInstanceId !== ''
                ? $scryCardInstanceId
                : null,
        ];
    }

    private function returnHandToLibraryAndShuffle(array &$snapshot, string $playerId): void
    {
        $hand = array_values($snapshot['players'][$playerId]['zones']['hand'] ?? []);
        $snapshot['players'][$playerId]['zones']['hand'] = [];
        foreach ($hand as $card) {
            if (is_array($card)) {
                $this->putCard($snapshot, $playerId, 'library', $card, 'bottom');
            }
        }
        $snapshot['players'][$playerId]['zones']['library'] = $this->randomizer->shuffle($snapshot['players'][$playerId]['zones']['library']);
        foreach ($snapshot['players'][$playerId]['zones']['library'] as &$card) {
            if (is_array($card)) {
                $card['revealedTo'] = [];
            }
        }
        unset($card);
        $snapshot['players'][$playerId]['revealedLibraryTo'] = [];
    }

    private function drawMulliganHand(array &$snapshot, string $playerId, int $drawCount): void
    {
        for ($index = 0; $index < $drawCount; ++$index) {
            $card = $this->takeTopLibraryCard($snapshot, $playerId);
            if (!is_array($card)) {
                return;
            }
            $this->putCard($snapshot, $playerId, 'hand', $card);
        }
    }

    /**
     * @return list<string>
     */
    private function bottomCardInstanceIds(array $payload): array
    {
        $ids = $payload['bottomCardInstanceIds'] ?? [];
        if ($ids === null) {
            return [];
        }
        if (!is_array($ids)) {
            throw new \InvalidArgumentException('bottomCardInstanceIds must be an array.');
        }

        $normalized = [];
        foreach ($ids as $id) {
            if (!is_string($id) || trim($id) === '') {
                throw new \InvalidArgumentException('bottomCardInstanceIds must contain only card ids.');
            }
            $normalized[] = trim($id);
        }
        if (count(array_unique($normalized)) !== count($normalized)) {
            throw new \InvalidArgumentException('bottomCardInstanceIds must not contain duplicates.');
        }

        return $normalized;
    }

    /**
     * @param list<string> $instanceIds
     */
    private function assertCardsAreInHand(array $snapshot, string $playerId, array $instanceIds): void
    {
        $handCardsById = [];
        foreach ($snapshot['players'][$playerId]['zones']['hand'] ?? [] as $card) {
            if (is_array($card) && is_string($card['instanceId'] ?? null)) {
                $handCardsById[$card['instanceId']] = true;
            }
        }

        foreach ($instanceIds as $instanceId) {
            if (!isset($handCardsById[$instanceId])) {
                throw new \InvalidArgumentException('Selected bottom card is not in hand.');
            }
        }
    }

    private function advanceGamePhaseIfMulliganReady(array &$snapshot): bool
    {
        if (($snapshot['gamePhase'] ?? null) !== self::GAME_PHASE_MULLIGAN) {
            return false;
        }
        foreach ($snapshot['players'] ?? [] as $player) {
            if (!is_array($player) || ($player['mulligan']['status'] ?? null) !== self::MULLIGAN_STATUS_READY) {
                return false;
            }
        }

        $snapshot['gamePhase'] = self::GAME_PHASE_PLAYING;

        return true;
    }

    /**
     * @param string|array<string,mixed> $position
     */
    private function putCard(
        array &$snapshot,
        string $playerId,
        string $zone,
        array $card,
        string|array $position = 'top',
        bool $preserveBattlefieldStats = false,
    ): void
    {
        $card = $this->normalizeCard($card, (string) ($card['ownerId'] ?? $playerId), $zone);
        if (($card['isToken'] ?? false) && $zone !== 'battlefield') {
            return;
        }

        $card['controllerId'] = $this->destinationControllerId($playerId, $zone, $card);
        $card['zone'] = $zone;
        if ($zone !== 'battlefield' || !$preserveBattlefieldStats) {
            $this->resetMutableStats($card);
            $this->resetTappedState($card);
            $card['saga'] = $zone === 'battlefield' && $this->isSagaCard($card) ? 1 : null;
        }
        if ($zone !== 'battlefield') {
            $card['counters'] = [];
        }
        if ($zone === 'battlefield' && is_array($position)) {
            $card['position'] = $this->normalizedPosition($position);
        } elseif ($zone !== 'battlefield') {
            $card['position'] = ['x' => 0, 'y' => 0];
        }
        if (!in_array($zone, self::HIDDEN_ZONES, true) && !($zone === 'battlefield' && ($card['faceDown'] ?? false))) {
            $card['revealedTo'] = [];
        }

        if ($zone === 'library' && $position === 'top') {
            array_unshift($snapshot['players'][$playerId]['zones'][$zone], $card);

            return;
        }

        $snapshot['players'][$playerId]['zones'][$zone][] = $card;
    }

    private function moveDestinationPlayerId(
        array $snapshot,
        string $sourcePlayerId,
        string $fromZone,
        string $toZone,
        array $card,
        string $requestedTargetPlayerId,
    ): string {
        if ($fromZone === 'battlefield' && $toZone !== 'battlefield') {
            $ownerId = (string) ($card['ownerId'] ?? '');

            return isset($snapshot['players'][$ownerId]) ? $ownerId : $sourcePlayerId;
        }

        return $requestedTargetPlayerId;
    }

    /**
     * @return string|array<string,mixed>
     */
    private function moveDestinationPosition(string $fromZone, string $toZone, array $payload): string|array
    {
        if (array_key_exists('position', $payload)) {
            $position = $payload['position'];

            return is_array($position) ? $position : (string) $position;
        }

        return $toZone === 'battlefield' && $fromZone !== 'battlefield'
            ? $this->battlefieldCenterPosition()
            : 'top';
    }

    private function libraryDestinationLabel(array $payload): string
    {
        return ($payload['position'] ?? 'top') === 'bottom' ? 'bottom of library' : 'top of library';
    }

    private function shouldRevealLibraryMoveNames(string $fromZone, string $toZone): bool
    {
        return $toZone === 'library' && !in_array($fromZone, self::HIDDEN_ZONES, true);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function destinationControllerId(string $playerId, string $zone, array $card): string
    {
        if ($zone === 'battlefield' || $zone === 'hand') {
            return $playerId;
        }

        return (string) ($card['ownerId'] ?? $playerId);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isFaceDownBattlefieldCardLeaving(string $fromZone, string $toZone, array $card): bool
    {
        return $fromZone === 'battlefield'
            && $toZone !== 'battlefield'
            && ($card['faceDown'] ?? false) === true;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isEvaporatingTokenMove(array $card, string $toZone): bool
    {
        return ($card['isToken'] ?? false) === true && $toZone !== 'battlefield';
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardLogName(array $card): string
    {
        $name = $this->cardBaseName($card);

        return ($card['isTokenCopy'] ?? false) === true ? sprintf('Token Copy %s', $name) : $name;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardFaceLogName(array $card, int $faceIndex): string
    {
        $faces = is_array($card['cardFaces'] ?? null) ? array_values($card['cardFaces']) : [];
        $face = $faces[$faceIndex] ?? null;
        $name = is_array($face) ? trim((string) ($face['name'] ?? '')) : '';
        $name = $name === '' ? $this->cardBaseName($card) : $name;

        return ($card['isTokenCopy'] ?? false) === true ? sprintf('Token Copy %s', $name) : $name;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardBaseName(array $card): string
    {
        $name = trim((string) ($card['name'] ?? ''));

        return $name === '' ? 'Unknown card' : $name;
    }

    private function pluralCardName(string $name): string
    {
        return str_ends_with($name, 's') ? $name : $name.'s';
    }

    private function zoneLogName(string $zone): string
    {
        return match ($zone) {
            'library' => 'library',
            'hand' => 'hand',
            'graveyard' => 'graveyard',
            'exile' => 'exile',
            'battlefield' => 'battlefield',
            'command' => 'command zone',
            default => $zone,
        };
    }

    /**
     * @param list<array<string,mixed>> $cards
     *
     * @return array<string,mixed>
     */
    private function cardByInstanceId(array $cards, string $instanceId): array
    {
        foreach ($cards as $card) {
            if (($card['instanceId'] ?? null) === $instanceId) {
                return $card;
            }
        }

        throw new \InvalidArgumentException('Random selected card not found.');
    }

    /**
     * @return array<string,mixed>
     */
    private function requiredCommanderCard(array $snapshot, string $sourcePlayerId, string $commanderInstanceId): array
    {
        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            foreach (self::ZONES as $zone) {
                foreach (($player['zones'][$zone] ?? []) as $card) {
                    if (!is_array($card) || (string) ($card['instanceId'] ?? '') !== $commanderInstanceId) {
                        continue;
                    }
                    if (($card['isCommander'] ?? false) !== true || (string) ($card['ownerId'] ?? $playerId) !== $sourcePlayerId) {
                        throw new \InvalidArgumentException('Commander damage source card is invalid.');
                    }

                    return $card;
                }
            }
        }

        throw new \InvalidArgumentException('Commander damage source card was not found.');
    }

    /**
     * @return array{0:string,1:array<string,mixed>}
     */
    private function resolvedCommanderCounterScope(array $snapshot, string $scope): array
    {
        $id = substr($scope, strlen('commander:'));
        if ($id === '') {
            throw new \InvalidArgumentException('Commander counter scope is invalid.');
        }

        $commandersByPlayer = $this->commanderCardsByPlayer($snapshot);
        if (isset($commandersByPlayer[$id][0])) {
            $commander = $commandersByPlayer[$id][0];

            return ['commander:'.(string) $commander['instanceId'], $commander];
        }

        foreach ($commandersByPlayer as $commanders) {
            foreach ($commanders as $commander) {
                if ((string) ($commander['instanceId'] ?? '') === $id) {
                    return [$scope, $commander];
                }
            }
        }

        throw new \InvalidArgumentException('Commander counter scope is invalid.');
    }

    private function possessivePlayerName(array $snapshot, string $playerId): string
    {
        $name = $this->playerName($snapshot, $playerId);

        return str_ends_with($name, 's') ? $name."'" : $name."'s";
    }

    /**
     * @param mixed $position
     *
     * @param list<array<string,mixed>> $battlefield
     *
     * @return array<string,mixed>
     */
    private function tokenCopyPosition(mixed $position, array $battlefield): array
    {
        $source = $this->normalizedPosition($position);
        if (($source['unit'] ?? null) === self::POSITION_UNIT_RATIO) {
            foreach ($this->tokenCopyPositionCandidates($source, self::TOKEN_COPY_RATIO_OFFSET_X, self::TOKEN_COPY_RATIO_OFFSET_X, self::POSITION_UNIT_RATIO) as $candidate) {
                $normalized = $this->normalizedPosition($candidate);
                if (!$this->tokenCopyPositionConflicts($normalized, $battlefield, self::TOKEN_COPY_RATIO_OFFSET_X, self::TOKEN_COPY_RATIO_OFFSET_X)) {
                    return $normalized;
                }
            }

            return $this->normalizedPosition([
                'x' => $source['x'],
                'y' => $source['y'],
                'unit' => self::POSITION_UNIT_RATIO,
            ]);
        }

        foreach ($this->tokenCopyPositionCandidates($source, self::TOKEN_COPY_LEGACY_OFFSET_X, self::TOKEN_COPY_LEGACY_OFFSET_X, null) as $candidate) {
            $normalized = $this->normalizedPosition($candidate);
            if (!$this->tokenCopyPositionConflicts($normalized, $battlefield, self::TOKEN_COPY_LEGACY_OFFSET_X, self::TOKEN_COPY_LEGACY_OFFSET_X)) {
                return $normalized;
            }
        }

        return $this->normalizedPosition($source);
    }

    /**
     * @param array<string,mixed> $source
     *
     * @return list<array<string,mixed>>
     */
    private function tokenCopyPositionCandidates(array $source, float|int $offsetX, float|int $offsetY, ?string $unit): array
    {
        $candidates = [
            ['x' => $source['x'] + $offsetX, 'y' => $source['y']],
            ['x' => $source['x'] - $offsetX, 'y' => $source['y']],
            ['x' => $source['x'], 'y' => $source['y'] + $offsetY],
            ['x' => $source['x'], 'y' => $source['y'] - $offsetY],
            ['x' => $source['x'] + $offsetX, 'y' => $source['y'] + $offsetY],
            ['x' => $source['x'] - $offsetX, 'y' => $source['y'] + $offsetY],
            ['x' => $source['x'] + $offsetX, 'y' => $source['y'] - $offsetY],
            ['x' => $source['x'] - $offsetX, 'y' => $source['y'] - $offsetY],
        ];

        if ($unit === null) {
            return $candidates;
        }

        return array_map(static fn (array $candidate): array => [...$candidate, 'unit' => $unit], $candidates);
    }

    /**
     * @param array<string,mixed> $position
     * @param list<array<string,mixed>> $battlefield
     */
    private function tokenCopyPositionConflicts(array $position, array $battlefield, float|int $offsetX, float|int $offsetY): bool
    {
        foreach ($battlefield as $card) {
            $occupied = $this->normalizedPosition($card['position'] ?? null);
            if (($occupied['unit'] ?? null) !== ($position['unit'] ?? null)) {
                continue;
            }

            if (
                abs((float) $occupied['x'] - (float) $position['x']) < ((float) $offsetX * 0.75)
                && abs((float) $occupied['y'] - (float) $position['y']) < ((float) $offsetY * 0.75)
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{x:float,y:float,unit:string}
     */
    private function battlefieldCenterPosition(): array
    {
        return ['x' => 0.5, 'y' => 0.5, 'unit' => self::POSITION_UNIT_RATIO];
    }

    /**
     * @return array{x:float,y:float,unit:string}
     */
    private function tokenPosition(int $index, int $quantity): array
    {
        if ($quantity <= 1) {
            return $this->battlefieldCenterPosition();
        }

        $column = $index % 5;
        $row = intdiv($index, 5);
        $columns = min($quantity, 5);
        $rows = (int) ceil($quantity / 5);
        $x = 0.5 + ($column - (($columns - 1) / 2)) * 0.028;
        $y = 0.5 + ($row - (($rows - 1) / 2)) * 0.04;

        return [
            'x' => max(0.08, min(0.92, $x)),
            'y' => max(0.12, min(0.88, $y)),
            'unit' => self::POSITION_UNIT_RATIO,
        ];
    }

    private function resetMutableStats(array &$card): void
    {
        $card['power'] = $this->gameplayStat($card['defaultPower'] ?? null);
        $card['toughness'] = $this->gameplayStat($card['defaultToughness'] ?? null);
        $card['loyalty'] = $this->gameplayStat($card['defaultLoyalty'] ?? null);
        $card['defense'] = $this->gameplayStat($card['defaultDefense'] ?? null);
    }

    private function resetTappedState(array &$card): void
    {
        $card['tapped'] = false;
        $card['rotation'] = 0;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function applyStatCounterDelta(array &$card, string $key, int $delta): void
    {
        if ($delta === 0) {
            return;
        }

        $modifier = match ($key) {
            '+1/+1' => 1,
            '-1/-1' => -1,
            default => 0,
        };
        if ($modifier === 0) {
            return;
        }

        $card['power'] = (int) ($this->numericStat($card['power'] ?? null) ?? $this->numericStat($card['defaultPower'] ?? null) ?? 0)
            + ($delta * $modifier);
        $card['toughness'] = (int) ($this->numericStat($card['toughness'] ?? null) ?? $this->numericStat($card['defaultToughness'] ?? null) ?? 0)
            + ($delta * $modifier);
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:int|string|null,toughness:int|string|null}
     */
    private function baseStats(array $card, mixed $power, mixed $toughness): array
    {
        $resolved = $this->baseStatsResolver?->baseStats($card);
        if ($resolved !== null) {
            return $resolved;
        }

        if (array_key_exists('defaultPower', $card) || array_key_exists('defaultToughness', $card)) {
            return [
                'power' => $this->powerToughnessStat($card['defaultPower'] ?? null),
                'toughness' => $this->powerToughnessStat($card['defaultToughness'] ?? null),
            ];
        }

        if (array_key_exists('basePower', $card) || array_key_exists('baseToughness', $card)) {
            return [
                'power' => $this->powerToughnessStat($card['basePower'] ?? null),
                'toughness' => $this->powerToughnessStat($card['baseToughness'] ?? null),
            ];
        }

        $faceStats = $this->powerToughnessFromFaces($card);
        if ($faceStats !== null) {
            return $faceStats;
        }

        return [
            'power' => $this->powerToughnessStat($power),
            'toughness' => $this->powerToughnessStat($toughness),
        ];
    }

    /**
     * @param array<string,mixed> $card
     */
    private function defaultLoyalty(array $card, mixed $loyalty): int|string|null
    {
        $resolved = $this->baseStatsResolver?->baseLoyalty($card);
        if ($resolved !== null) {
            return $resolved;
        }

        if (array_key_exists('defaultLoyalty', $card)) {
            $defaultLoyalty = $this->printedStat($card['defaultLoyalty']);
            if ($defaultLoyalty !== null) {
                return $defaultLoyalty;
            }
        }

        if (array_key_exists('baseLoyalty', $card)) {
            $baseLoyalty = $this->printedStat($card['baseLoyalty']);
            if ($baseLoyalty !== null) {
                return $baseLoyalty;
            }
        }

        return $this->loyaltyFromFaceStats($card)
            ?? $this->printedStat($loyalty)
            ?? $this->loyaltyFromFaces($card);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function defaultDefense(array $card, mixed $defense): int|string|null
    {
        $resolved = $this->baseStatsResolver?->baseDefense($card);
        if ($resolved !== null) {
            return $resolved;
        }

        if (array_key_exists('defaultDefense', $card)) {
            $defaultDefense = $this->printedStat($card['defaultDefense']);
            if ($defaultDefense !== null) {
                return $defaultDefense;
            }
        }

        if (array_key_exists('baseDefense', $card)) {
            $baseDefense = $this->printedStat($card['baseDefense']);
            if ($baseDefense !== null) {
                return $baseDefense;
            }
        }

        return $this->defenseFromFaceStats($card)
            ?? $this->printedStat($defense)
            ?? $this->defenseFromFaces($card);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function loyaltyFromFaceStats(array $card): int|string|null
    {
        $faceStats = $card['faceStats'] ?? null;
        if (!is_array($faceStats)) {
            return null;
        }

        $root = $faceStats['root'] ?? null;
        if (is_array($root)) {
            $rootLoyalty = $this->printedStat($root['loyalty'] ?? null);
            if ($rootLoyalty !== null) {
                return $rootLoyalty;
            }
        }

        $faces = $faceStats['faces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $loyalty = $this->printedStat($face['loyalty'] ?? null);
            if ($loyalty !== null) {
                return $loyalty;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function loyaltyFromFaces(array $card): int|string|null
    {
        $faces = $card['cardFaces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $loyalty = $this->printedStat($face['loyalty'] ?? null);
            if ($loyalty !== null) {
                return $loyalty;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function defenseFromFaceStats(array $card): int|string|null
    {
        $faceStats = $card['faceStats'] ?? null;
        if (!is_array($faceStats)) {
            return null;
        }

        $root = $faceStats['root'] ?? null;
        if (is_array($root)) {
            $rootDefense = $this->printedStat($root['defense'] ?? null);
            if ($rootDefense !== null) {
                return $rootDefense;
            }
        }

        $faces = $faceStats['faces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $defense = $this->printedStat($face['defense'] ?? null);
            if ($defense !== null) {
                return $defense;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function defenseFromFaces(array $card): int|string|null
    {
        $faces = $card['cardFaces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $defense = $this->printedStat($face['defense'] ?? null);
            if ($defense !== null) {
                return $defense;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:int|string|null,toughness:int|string|null}|null
     */
    private function powerToughnessFromFaces(array $card): ?array
    {
        $faces = $card['cardFaces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $power = $this->powerToughnessStat($face['power'] ?? null);
            $toughness = $this->powerToughnessStat($face['toughness'] ?? null);
            if ($power !== null || $toughness !== null) {
                return ['power' => $power, 'toughness' => $toughness];
            }
        }

        return null;
    }

    private function requiredCardLocation(array $snapshot, array $payload): array
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $zone = isset($payload['zone']) ? $this->requiredZone($payload) : null;
        $instanceId = trim((string) ($payload['instanceId'] ?? ''));
        if ($instanceId === '') {
            throw new \InvalidArgumentException('instanceId is required.');
        }

        $zones = $zone === null ? self::ZONES : [$zone];
        foreach ($zones as $candidateZone) {
            foreach ($snapshot['players'][$playerId]['zones'][$candidateZone] ?? [] as $index => $card) {
                if (($card['instanceId'] ?? null) === $instanceId) {
                    return ['playerId' => $playerId, 'zone' => $candidateZone, 'index' => $index];
                }
            }
        }

        throw new \InvalidArgumentException('Card not found.');
    }

    private function requiredPlayerId(array $snapshot, array $payload, string $key = 'playerId'): string
    {
        $playerId = $this->resolveSnapshotPlayerId($snapshot, $payload[$key] ?? null);
        if ($playerId === null) {
            throw new \InvalidArgumentException(sprintf('%s is invalid.', $key));
        }

        return $playerId;
    }

    private function requiredZone(array $payload, string $key = 'zone'): string
    {
        $zone = trim((string) ($payload[$key] ?? ''));
        if (!in_array($zone, self::ZONES, true)) {
            throw new \InvalidArgumentException(sprintf('%s is invalid.', $key));
        }

        return $zone;
    }

    /**
     * @return array<string,int|float|string>
     */
    private function normalizedPosition(mixed $position): array
    {
        if (!is_array($position)) {
            return ['x' => 0, 'y' => 0];
        }

        if (($position['unit'] ?? null) === self::POSITION_UNIT_RATIO) {
            return [
                'x' => max(0.0, min(1.0, (float) ($position['x'] ?? 0))),
                'y' => max(0.0, min(1.0, (float) ($position['y'] ?? 0))),
                'unit' => self::POSITION_UNIT_RATIO,
            ];
        }

        return [
            'x' => max(0, min(3000, (int) ($position['x'] ?? 0))),
            'y' => max(0, min(2000, (int) ($position['y'] ?? 0))),
        ];
    }

    /**
     * @return array{x:float,y:float}
     */
    private function normalizedDungeonMarker(mixed $position): array
    {
        if (!is_array($position)) {
            return $this->defaultDungeonMarker();
        }

        return [
            'x' => max(0.0, min(1.0, (float) ($position['x'] ?? 0.5))),
            'y' => max(0.0, min(1.0, (float) ($position['y'] ?? 0.5))),
        ];
    }

    /**
     * @return array{x:float,y:float}
     */
    private function defaultDungeonMarker(): array
    {
        return ['x' => 0.5, 'y' => 0.5];
    }

    private function activeFaceIndex(array $card): int
    {
        $faces = is_array($card['cardFaces'] ?? null) ? $card['cardFaces'] : [];
        if (count($faces) < 2) {
            return 0;
        }

        return $this->positiveInt($card['activeFaceIndex'] ?? 0, 0, count($faces) - 1);
    }

    private function reassignMonarchWhenPlayerLeaves(array &$snapshot, string $leavingPlayerId, string $previousActivePlayerId): void
    {
        GameGlobalDesignationSuccession::reassignWhenPlayerLeaves(
            $snapshot,
            $leavingPlayerId,
            $previousActivePlayerId,
            ['monarch', 'initiative'],
            fn (string $playerId): bool => $this->playerIsAliveForTurn($snapshot, $playerId),
        );
    }

    private function assertActorCanApply(array $snapshot, string $type, array $payload, User $actor): void
    {
        $actorId = $actor->id();
        $actorPlayerId = $this->resolveSnapshotPlayerId($snapshot, $actorId);
        if ($actorPlayerId === null) {
            throw new \InvalidArgumentException('Actor is not a game player.');
        }
        if ($type === 'game.concede' || $type === 'game.close') {
            return;
        }
        if (($snapshot['players'][$actorPlayerId]['status'] ?? 'active') === 'conceded' && !in_array($type, ['chat.message', 'chat.reaction.toggled', 'game.close'], true)) {
            throw new \InvalidArgumentException('Conceded players cannot perform game actions.');
        }

        if ($this->specialEntityCommandHandler->supports($type)) {
            $this->specialEntityCommandHandler->assertActorCanApply($snapshot, $type, $payload, $actor);

            return;
        }

        if ($type === 'life.changed') {
            $this->assertActorPlayer($snapshot, $payload, $actor, 'playerId', 'You can only change your own life total.');
            return;
        }

        if ($type === 'commander.damage.changed') {
            $this->assertActorPlayer($snapshot, $payload, $actor, 'targetPlayerId', 'You can only change your own commander damage.');
            return;
        }

        $counterScopePlayerId = $type === 'counter.changed'
            ? $this->resolveSnapshotPlayerId($snapshot, $this->counterScopePlayerId($payload))
            : null;
        if ($counterScopePlayerId !== null) {
            if ($counterScopePlayerId !== $actorPlayerId) {
                throw new \InvalidArgumentException('You can only change your own player counters.');
            }

            return;
        }
        $commanderCounterOwnerId = $type === 'counter.changed'
            ? $this->resolveSnapshotPlayerId($snapshot, $this->commanderCounterOwnerId($snapshot, $payload))
            : null;
        if ($commanderCounterOwnerId !== null) {
            if ($commanderCounterOwnerId !== $actorPlayerId) {
                throw new \InvalidArgumentException('You can only change your own commander cast count.');
            }

            return;
        }

        if ($type === 'library.shuffle' && $this->canActorCloseRevealedLibrary($snapshot, $payload, $actor)) {
            return;
        }

        if (str_starts_with($type, 'library.') || in_array($type, self::ACTOR_OWN_PLAYER_COMMANDS, true)) {
            $this->assertActorPlayer($snapshot, $payload, $actor, 'playerId');
            return;
        }
        if ($type === 'turn.changed') {
            $activePlayerId = (string) ($snapshot['turn']['activePlayerId'] ?? '');
            if ($activePlayerId === '' || $activePlayerId !== $actorPlayerId) {
                throw new \InvalidArgumentException('Only the active turn player can advance the turn.');
            }
        }
    }

    private function assertGamePhaseAllowsCommand(array $snapshot, string $type): void
    {
        $gamePhase = $snapshot['gamePhase'] ?? self::GAME_PHASE_PLAYING;
        $isMulliganCommand = in_array($type, self::MULLIGAN_COMMANDS, true);
        if ($gamePhase === self::GAME_PHASE_MULLIGAN) {
            if ($isMulliganCommand || in_array($type, ['game.concede', 'game.close', 'chat.message', 'chat.reaction.toggled'], true)) {
                return;
            }

            throw new \InvalidArgumentException('Game is in mulligan phase.');
        }

        if ($isMulliganCommand) {
            throw new \InvalidArgumentException('Mulligan phase has ended.');
        }
    }

    private function assertActorPlayer(array $snapshot, array $payload, User $actor, string $key, string $message = 'You can only perform this action on your own hidden zones.'): void
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload, $key);
        $actorPlayerId = $this->resolveSnapshotPlayerId($snapshot, $actor->id());
        if ($actorPlayerId === null || $playerId !== $actorPlayerId) {
            throw new \InvalidArgumentException($message);
        }
    }

    private function canActorCloseRevealedLibrary(array $snapshot, array $payload, User $actor): bool
    {
        if (($payload['reason'] ?? null) !== 'revealed-library-closed') {
            return false;
        }

        $actorPlayerId = $this->resolveSnapshotPlayerId($snapshot, $actor->id());
        $playerId = $this->resolveSnapshotPlayerId($snapshot, $payload['playerId'] ?? null);
        if ($playerId === null || $actorPlayerId === null || $playerId === $actorPlayerId) {
            return false;
        }

        $library = $snapshot['players'][$playerId]['zones']['library'] ?? [];
        if (!is_array($library) || $library === []) {
            return false;
        }

        foreach ($library as $card) {
            if (!is_array($card)) {
                return false;
            }

            $revealedTo = $card['revealedTo'] ?? [];
            if (!is_array($revealedTo) || (!in_array('all', $revealedTo, true) && !in_array($actor->id(), $revealedTo, true))) {
                return false;
            }
        }

        return true;
    }

    private function counterScopePlayerId(array $payload): ?string
    {
        $scope = trim((string) ($payload['scope'] ?? 'global'));
        if (!str_starts_with($scope, 'player:')) {
            return null;
        }

        $playerId = substr($scope, strlen('player:'));

        return $playerId === '' ? null : $playerId;
    }

    private function commanderCounterOwnerId(array $snapshot, array $payload): ?string
    {
        $scope = trim((string) ($payload['scope'] ?? 'global'));
        $key = trim((string) ($payload['key'] ?? ''));
        if ($key !== 'casts' || !str_starts_with($scope, 'commander:')) {
            return null;
        }

        [$resolvedScope, $commander] = $this->resolvedCommanderCounterScope($snapshot, $scope);
        unset($resolvedScope);

        return (string) ($commander['ownerId'] ?? '');
    }

    private function resolveSnapshotPlayerId(array $snapshot, mixed $candidate): ?string
    {
        $value = is_scalar($candidate) ? trim((string) $candidate) : '';
        if ($value === '') {
            return null;
        }

        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return null;
        }

        if (isset($players[$value])) {
            return $value;
        }

        foreach ($players as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player)) {
                continue;
            }

            $user = is_array($player['user'] ?? null) ? $player['user'] : null;
            $userId = is_scalar($user['id'] ?? null) ? trim((string) $user['id']) : '';
            if ($userId !== '' && $userId === $value) {
                return $playerId;
            }
        }

        return null;
    }

    /**
     * @param list<mixed> $colors
     *
     * @return list<string>
     */
    private function orderedColorIdentity(array $colors): array
    {
        $colors = array_values(array_unique(array_filter($colors, static fn (mixed $color): bool => is_string($color))));

        return array_values(array_filter(['W', 'U', 'B', 'R', 'G'], static fn (string $color): bool => in_array($color, $colors, true)));
    }

    private function visibilityTargets(array $snapshot, mixed $target): array
    {
        if ($target === 'all') {
            return ['all'];
        }
        if (is_array($target)) {
            $targets = array_values(array_filter(
                $target,
                static fn (mixed $playerId): bool => is_string($playerId) && isset($snapshot['players'][$playerId]),
            ));

            return $targets === [] ? ['all'] : $targets;
        }
        if (is_string($target) && isset($snapshot['players'][$target])) {
            return [$target];
        }

        return ['all'];
    }

    /**
     * @param list<string> $targets
     */
    private function visibilityTargetLabel(array $snapshot, array $targets): string
    {
        if (in_array('all', $targets, true)) {
            return 'todos';
        }

        $names = array_values(array_map(fn (string $playerId): string => $this->playerName($snapshot, $playerId), $targets));

        return $names === [] ? 'todos' : implode(', ', $names);
    }

    private function playerName(array $snapshot, string $playerId): string
    {
        $displayName = trim((string) ($snapshot['players'][$playerId]['user']['displayName'] ?? ''));

        return $displayName !== '' ? $displayName : $playerId;
    }

    private function positiveInt(mixed $value, int $min, int $max): int
    {
        $number = filter_var($value, FILTER_VALIDATE_INT);

        return is_int($number) ? max($min, min($max, $number)) : $min;
    }

    private function statLabel(mixed $value): string
    {
        if ($value === null || $value === '') {
            return '-';
        }

        return is_numeric($value) ? (string) (int) $value : (string) $value;
    }

    private function romanStatLabel(mixed $value): string
    {
        $number = $this->numericStat($value);
        if ($number === null) {
            return '-';
        }

        if ($number <= 0) {
            return (string) $number;
        }

        $ones = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
        $clamped = min(9, $number);

        return $ones[$clamped];
    }

    private function isSagaCard(array $card): bool
    {
        return stripos((string) ($card['typeLine'] ?? ''), 'saga') !== false;
    }

    private function numericStat(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    private function printedStat(mixed $value): int|string|null
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (int) $value : (string) $value;
    }

    private function gameplayStat(mixed $value): int|string|null
    {
        $printed = $this->printedStat($value);
        if (!is_string($printed)) {
            return $printed;
        }

        return $this->isVariablePrintedStat($printed) ? 0 : $printed;
    }

    private function powerToughnessStat(mixed $value): int|string|null
    {
        return $this->printedStat($value);
    }

    private function isVariablePrintedStat(string $value): bool
    {
        return str_contains(strtolower($value), 'x') || str_contains($value, '*');
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function commandMetricsPayload(array $snapshot, int $snapshotBytesBefore, float $normalizeMs, float $commandApplyMs): array
    {
        return [
            'normalize_ms' => round(max(0, $normalizeMs), 2),
            'command_apply_ms' => round(max(0, $commandApplyMs), 2),
            'snapshot_bytes_before' => $snapshotBytesBefore,
            'snapshot_bytes_after' => $this->metricsInspector->jsonBytes($snapshot),
            'number_of_players' => $this->metricsInspector->countPlayers($snapshot),
            'number_of_instances' => $this->metricsInspector->countInstances($snapshot),
        ];
    }

    private function elapsedMs(float $startedAt): float
    {
        return round(max(0, (microtime(true) - $startedAt) * 1000), 2);
    }

    private function snapshotForPersistence(array $snapshotBefore, array $snapshot): array
    {
        if (!$this->compactRuntimeFlags->enabled() && !$this->compactStateMapper->isCompactSnapshot($snapshotBefore)) {
            return $snapshot;
        }

        return $this->compactStateMapper->compactSnapshot($snapshot);
    }
}
