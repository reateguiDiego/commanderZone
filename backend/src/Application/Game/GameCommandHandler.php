<?php

namespace App\Application\Game;

use App\Domain\Deck\Deck;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\User\User;
use Symfony\Component\Uid\Uuid;

class GameCommandHandler
{
    private const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
    private const HIDDEN_ZONES = ['library', 'hand'];
    private const MAX_CARD_COUNTER_TYPES = 5;
    private const COMMANDER_DAMAGE_DEFEAT_THRESHOLD = 21;
    private const POSITION_UNIT_RATIO = 'ratio';
    private const TOKEN_COPY_LEGACY_OFFSET_X = 132;
    private const TOKEN_COPY_RATIO_OFFSET_X = 0.1683673469387755;
    private const SUPPORTED_COMMANDS = [
        'game.concede',
        'game.close',
        'chat.message',
        'life.changed',
        'commander.damage.changed',
        'counter.changed',
        'card.counter.changed',
        'card.power_toughness.changed',
        'card.moved',
        'cards.moved',
        'card.tapped',
        'card.position.changed',
        'card.face_down.changed',
        'card.face.changed',
        'card.revealed',
        'card.token_copy.created',
        'card.controller.changed',
        'turn.changed',
        'zone.changed',
        'zone.move_all',
        'library.draw',
        'library.draw_many',
        'library.shuffle',
        'library.move_top',
        'library.reveal_top',
        'library.reveal',
        'library.play_top_revealed',
        'stack.card_added',
        'stack.item_removed',
        'arrow.created',
        'arrow.removed',
    ];
    private const COMMANDS_ALLOWED_WHEN_FINISHED = [
        'chat.message',
    ];
    private const ACTOR_OWN_PLAYER_COMMANDS = [
        'zone.changed',
        'zone.move_all',
        'card.moved',
        'cards.moved',
        'card.tapped',
        'card.position.changed',
        'card.face_down.changed',
        'card.face.changed',
        'card.revealed',
        'card.token_copy.created',
        'card.controller.changed',
        'card.power_toughness.changed',
        'card.counter.changed',
        'stack.card_added',
    ];

    /**
     * @var array<string,mixed>
     */
    private array $pendingLogContext = [];
    private ?string $pendingDefeatedPlayerId = null;
    private bool $pendingDefeatPreexisted = false;

    public function __construct(private readonly ?GameCardBaseStatsResolver $baseStatsResolver = null)
    {
    }

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

        $snapshot = $this->normalizeSnapshot($game->snapshot());
        $log = null;
        $this->pendingLogContext = [];
        $this->pendingDefeatedPlayerId = null;
        $this->pendingDefeatPreexisted = false;
        $this->assertActorCanApply($snapshot, $type, $payload, $actor);

        match ($type) {
            'game.concede' => $log = $this->applyGameConcede($snapshot, $actor),
            'game.close' => $log = $this->applyGameClose($snapshot, $game, $actor),
            'chat.message' => $log = $this->applyChatMessage($snapshot, $payload, $actor),
            'life.changed' => $log = $this->applyLifeChanged($snapshot, $payload),
            'commander.damage.changed' => $log = $this->applyCommanderDamageChanged($snapshot, $payload),
            'counter.changed' => $log = $this->applyLegacyCounterChanged($snapshot, $payload),
            'card.counter.changed' => $log = $this->applyCardCounterChanged($snapshot, $payload),
            'card.power_toughness.changed' => $log = $this->applyPowerToughnessChanged($snapshot, $payload),
            'card.moved' => $log = $this->applyCardMoved($snapshot, $payload),
            'cards.moved' => $log = $this->applyCardsMoved($snapshot, $payload),
            'card.tapped' => $log = $this->applyCardTapped($snapshot, $payload),
            'card.position.changed' => $log = $this->applyCardPositionChanged($snapshot, $payload),
            'card.face_down.changed' => $log = $this->applyCardFaceDown($snapshot, $payload),
            'card.face.changed' => $log = $this->applyCardFaceChanged($snapshot, $payload),
            'card.revealed' => $log = $this->applyCardRevealed($snapshot, $payload),
            'card.token_copy.created' => $log = $this->applyTokenCopyCreated($snapshot, $payload, $actor),
            'card.controller.changed' => $log = $this->applyControllerChanged($snapshot, $payload),
            'turn.changed' => $log = $this->applyTurnChanged($snapshot, $payload),
            'zone.changed' => $log = $this->applyZoneChanged($snapshot, $payload),
            'zone.move_all' => $log = $this->applyZoneMoveAll($snapshot, $payload),
            'library.draw' => $log = $this->applyLibraryDraw($snapshot, $payload, 1),
            'library.draw_many' => $log = $this->applyLibraryDraw($snapshot, $payload, $this->positiveInt($payload['count'] ?? 1, 1, 99)),
            'library.shuffle' => $log = $this->applyLibraryShuffle($snapshot, $payload),
            'library.move_top' => $log = $this->applyLibraryMoveTop($snapshot, $payload),
            'library.reveal_top' => $log = $this->applyLibraryRevealTop($snapshot, $payload),
            'library.reveal' => $log = $this->applyLibraryReveal($snapshot, $payload),
            'library.play_top_revealed' => $log = $this->applyLibraryPlayTopRevealed($snapshot, $payload),
            'stack.card_added' => $log = $this->applyStackCardAdded($snapshot, $payload),
            'stack.item_removed' => $log = $this->applyStackItemRemoved($snapshot, $payload),
            'arrow.created' => $log = $this->applyArrowCreated($snapshot, $payload, $actor),
            'arrow.removed' => $log = $this->applyArrowRemoved($snapshot, $payload, $actor),
            default => throw new \InvalidArgumentException(sprintf('Unknown game command: %s', $type)),
        };

        $this->pruneBattlefieldArrows($snapshot);
        $eventPayload = $type === 'chat.message' ? $this->chatEventPayload($payload) : $payload;
        $this->commit($snapshot, $type, $log, $actor);
        $game->replaceSnapshot($snapshot);
        $event = new GameEvent($game, $type, $eventPayload, $actor, $clientActionId);
        $game->addEvent($event);

        return $event;
    }

    public function normalizeSnapshot(array $snapshot): array
    {
        $snapshot['version'] = max(1, (int) ($snapshot['version'] ?? 1));
        $snapshot['ownerId'] = (string) ($snapshot['ownerId'] ?? '');
        $snapshot['stack'] ??= [];
        $snapshot['arrows'] ??= [];
        $snapshot['chat'] ??= [];
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
            $player['counters'] ??= [];
            $player['commanderDamage'] ??= [];
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

        $this->pruneBattlefieldArrows($snapshot);

        return $snapshot;
    }

    private function normalizeCard(array $card, string $ownerId, string $zone): array
    {
        $power = $this->numericStat($card['power'] ?? null);
        $toughness = $this->numericStat($card['toughness'] ?? null);
        $baseStats = $this->baseStats($card, $power, $toughness);
        $loyalty = array_key_exists('loyalty', $card) ? $this->numericStat($card['loyalty']) : null;
        $defaultLoyalty = $this->defaultLoyalty($card, $loyalty);
        $loyalty ??= $defaultLoyalty;

        return [
            'instanceId' => (string) ($card['instanceId'] ?? Uuid::v7()->toRfc4122()),
            'ownerId' => (string) ($card['ownerId'] ?? $ownerId),
            'controllerId' => (string) ($card['controllerId'] ?? $ownerId),
            'scryfallId' => (string) ($card['scryfallId'] ?? ''),
            'name' => (string) ($card['name'] ?? 'Unknown card'),
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
            'cardFaces' => is_array($card['cardFaces'] ?? null) ? $card['cardFaces'] : [],
            'typeLine' => $card['typeLine'] ?? null,
            'manaCost' => $card['manaCost'] ?? null,
            'oracleText' => $card['oracleText'] ?? null,
            'colorIdentity' => $this->orderedColorIdentity(is_array($card['colorIdentity'] ?? null) ? $card['colorIdentity'] : []),
            'power' => $power,
            'toughness' => $toughness,
            'loyalty' => $loyalty,
            'defaultPower' => $baseStats['power'],
            'defaultToughness' => $baseStats['toughness'],
            'defaultLoyalty' => $defaultLoyalty,
            'tapped' => (bool) ($card['tapped'] ?? false),
            'faceDown' => (bool) ($card['faceDown'] ?? false),
            'activeFaceIndex' => $this->activeFaceIndex($card),
            'revealedTo' => is_array($card['revealedTo'] ?? null) ? $card['revealedTo'] : [],
            'position' => $this->normalizedPosition($card['position'] ?? null),
            'rotation' => (int) ($card['rotation'] ?? 0),
            'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
            'zone' => $zone,
            'isToken' => (bool) ($card['isToken'] ?? false),
            'isCommander' => (bool) ($card['isCommander'] ?? $zone === 'command'),
        ];
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

        $snapshot['players'][$playerId]['status'] = 'conceded';
        $snapshot['players'][$playerId]['concededAt'] = (new \DateTimeImmutable())->format(DATE_ATOM);

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
            'userId' => $actor->id(),
            'displayName' => $actor->displayName(),
            'message' => mb_substr($message, 0, 800),
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
        if ($targetPlayerId !== null) {
            $chatMessage['targetPlayerId'] = $targetPlayerId;
            $chatMessage['targetDisplayName'] = $this->playerName($snapshot, $targetPlayerId);
        }

        $snapshot['chat'][] = $chatMessage;
        $snapshot['chat'] = array_slice($snapshot['chat'], -150);

        return null;
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

        return sprintf('Set %s life to %d.', $this->playerName($snapshot, $playerId), $newLife);
    }

    private function applyCommanderDamageChanged(array &$snapshot, array $payload): string
    {
        $targetPlayerId = $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId');
        $sourcePlayerId = $this->requiredPlayerId($snapshot, $payload, 'sourcePlayerId');
        if ($targetPlayerId === $sourcePlayerId) {
            throw new \InvalidArgumentException('Commander damage source and target must differ.');
        }

        $current = (int) ($snapshot['players'][$targetPlayerId]['commanderDamage'][$sourcePlayerId] ?? 0);
        $damage = array_key_exists('damage', $payload)
            ? (int) $payload['damage']
            : $current + (int) ($payload['delta'] ?? 0);
        $nextDamage = max(0, $damage);
        $snapshot['players'][$targetPlayerId]['commanderDamage'][$sourcePlayerId] = $nextDamage;
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
            $this->playerName($snapshot, $sourcePlayerId),
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

        $previousValue = (int) ($snapshot['counters'][$scope][$key] ?? 0);
        $value = str_starts_with($scope, 'commander:') && $key === 'casts'
            ? max(0, (int) $payload['value'])
            : (int) $payload['value'];
        $snapshot['counters'][$scope][$key] = $value;

        if (str_starts_with($scope, 'commander:') && $key === 'casts') {
            return $this->commanderCastCounterLog($previousValue, $value);
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

    private function commanderCastCounterLog(int $previousValue, int $value): string
    {
        if ($value > $previousValue) {
            return sprintf('Commander cast count increased from %d to %d.', $previousValue, $value);
        }

        if ($value < $previousValue) {
            return sprintf('Commander cast count decreased from %d to %d.', $previousValue, $value);
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
        $nextValue = max(0, $value);
        $card['counters'][$key] = $nextValue;
        $this->applyStatCounterDelta($card, $key, $nextValue - $previousValue);

        return sprintf('Set %s %s counters to %d.', $this->cardLogName($card), $key, $nextValue);
    }

    private function applyPowerToughnessChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $previousPower = $card['power'] ?? null;
        $previousToughness = $card['toughness'] ?? null;
        $previousLoyalty = $card['loyalty'] ?? null;
        if (array_key_exists('power', $payload)) {
            $card['power'] = $payload['power'] === null ? null : (int) $payload['power'];
        }
        if (array_key_exists('toughness', $payload)) {
            $card['toughness'] = $payload['toughness'] === null ? null : (int) $payload['toughness'];
        }
        if (array_key_exists('loyalty', $payload)) {
            $card['loyalty'] = $payload['loyalty'] === null ? null : (int) $payload['loyalty'];
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
        if ($requestedTargetPlayerId === $playerId && $fromZone === $toZone) {
            return '';
        }

        $card = $this->takeCard($snapshot, $playerId, $fromZone, $instanceId);
        $targetPlayerId = $this->moveDestinationPlayerId($snapshot, $playerId, $fromZone, $toZone, $card, $requestedTargetPlayerId);
        $this->putCard(
            $snapshot,
            $targetPlayerId,
            $toZone,
            $card,
            $payload['position'] ?? 'top',
            $fromZone === 'battlefield' && $toZone === 'battlefield',
        );

        if ($this->isEvaporatingTokenMove($card, $toZone)) {
            return sprintf('%s evaporated instead of moving to %s.', $this->cardLogName($card), $toZone);
        }

        return sprintf('Moved %s from %s to %s.', $this->cardLogName($card), $fromZone, $toZone);
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
            $movedCardNames[] = $this->cardLogName($card);
            $targetPlayerId = $this->moveDestinationPlayerId($snapshot, $playerId, $fromZone, $toZone, $card, $requestedTargetPlayerId);
            $moves[] = [$targetPlayerId, $card];
        }

        $randomOrder = ($payload['randomOrder'] ?? false) === true && $toZone === 'library' && count($moves) > 1;
        if ($randomOrder) {
            shuffle($moves);
        }

        $moved = 0;
        foreach ($moves as [$targetPlayerId, $card]) {
            $this->putCard(
                $snapshot,
                $targetPlayerId,
                $toZone,
                $card,
                $payload['position'] ?? 'top',
                $fromZone === 'battlefield' && $toZone === 'battlefield',
            );
            ++$moved;
        }

        if ($moved > 1) {
            $this->pendingLogContext = ['cardNames' => $movedCardNames];
        }

        if ($randomOrder) {
            return sprintf('Moved %d cards from %s to %s in random order.', $moved, $fromZone, $toZone);
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
        $card['position'] = $this->normalizedPosition($payload['position'] ?? null);

        return sprintf('Moved %s on battlefield.', $this->cardLogName($card));
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
        $card['activeFaceIndex'] = $faceIndex;

        if ($location['zone'] !== 'battlefield') {
            return '';
        }

        return sprintf('Flipped %s to face %d.', $this->cardLogName($card), $faceIndex + 1);
    }

    private function applyCardRevealed(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['revealedTo'] = $this->visibilityTargets($snapshot, $payload['to'] ?? 'all');

        return sprintf('Revealed %s.', $this->cardLogName($card));
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
            $snapshot['turn']['activePlayerId'] = $this->turnEligiblePlayerId(
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
                $payload['position'] ?? 'top',
                $fromZone === 'battlefield' && $toZone === 'battlefield',
            );
        }

        return sprintf('Moved all cards from %s to %s.', $fromZone, $toZone);
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

        return sprintf('Drew %d card%s.', $drawn, $drawn === 1 ? '' : 's');
    }

    private function applyLibraryShuffle(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        shuffle($snapshot['players'][$playerId]['zones']['library']);

        return sprintf('Shuffled %s library.', $this->playerName($snapshot, $playerId));
    }

    private function applyLibraryMoveTop(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $toZone = $this->requiredZone($payload, 'toZone');
        $count = $this->positiveInt($payload['count'] ?? 1, 1, 99);
        $moved = 0;
        for ($i = 0; $i < $count; ++$i) {
            $card = $this->takeTopLibraryCard($snapshot, $playerId);
            if (!is_array($card)) {
                break;
            }
            $this->putCard($snapshot, $playerId, $toZone, $card, $payload['position'] ?? 'top');
            ++$moved;
        }

        return sprintf('Moved top %d card%s to %s.', $moved, $moved === 1 ? '' : 's', $toZone);
    }

    private function applyLibraryRevealTop(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $count = $this->positiveInt($payload['count'] ?? 1, 1, 99);
        $targets = $this->visibilityTargets($snapshot, $payload['to'] ?? 'all');
        $library =& $snapshot['players'][$playerId]['zones']['library'];
        $revealed = 0;
        for ($i = 0; $i < $count; ++$i) {
            if (!isset($library[$i])) {
                break;
            }
            $library[$i]['revealedTo'] = $targets;
            ++$revealed;
        }

        return sprintf('Revealed top %d library card%s.', $revealed, $revealed === 1 ? '' : 's');
    }

    private function applyLibraryReveal(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $targets = $this->visibilityTargets($snapshot, $payload['to'] ?? 'all');
        foreach ($snapshot['players'][$playerId]['zones']['library'] as &$card) {
            $card['revealedTo'] = $targets;
        }
        unset($card);

        return sprintf('Revealed %s library.', $this->playerName($snapshot, $playerId));
    }

    private function applyLibraryPlayTopRevealed(array &$snapshot, array $payload): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $card = $this->takeTopLibraryCard($snapshot, $playerId);
        if (!is_array($card)) {
            throw new \InvalidArgumentException('Library is empty.');
        }
        $this->putCard($snapshot, $playerId, 'battlefield', $card);

        return sprintf('Played %s from top of library.', $this->cardLogName($card));
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

    private function battlefieldContainsInstance(array $snapshot, string $instanceId): bool
    {
        foreach ($snapshot['players'] ?? [] as $player) {
            foreach (($player['zones']['battlefield'] ?? []) as $card) {
                if (($card['instanceId'] ?? null) === $instanceId) {
                    return true;
                }
            }
        }

        return false;
    }

    private function pruneBattlefieldArrows(array &$snapshot): void
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

        $snapshot['arrows'] = array_values(array_filter(
            $snapshot['arrows'] ?? [],
            static fn (array $arrow): bool => isset($battlefieldInstanceIds[(string) ($arrow['fromInstanceId'] ?? '')])
                && isset($battlefieldInstanceIds[(string) ($arrow['toInstanceId'] ?? '')]),
        ));
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
            $this->pendingDefeatedPlayerId = null;
            $this->pendingDefeatPreexisted = false;
            return;
        }

        if ($this->pendingDefeatPreexisted && $deathPending) {
            $this->appendLogEntry($snapshot, 'player.defeated', $this->playerDefeatedMessage($snapshot, $actorId), $actor);
            $this->pendingLogContext = [];
            $this->pendingDefeatedPlayerId = null;
            $this->pendingDefeatPreexisted = false;
            return;
        }

        if ($actorIsDefeated && !$deathPending) {
            $this->appendLogEntry($snapshot, 'player.defeated', $this->playerDefeatedMessage($snapshot, $actorId), $actor);
            $this->pendingLogContext = [];
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
        $this->pendingDefeatedPlayerId = null;
        $this->pendingDefeatPreexisted = false;
    }

    /**
     * @param array<string,mixed> $context
     */
    private function appendLogEntry(array &$snapshot, string $type, string $message, User $actor, array $context = []): void
    {
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

    private function hasPlayerDefeatedLog(array $snapshot, string $playerId): bool
    {
        foreach ($snapshot['eventLog'] ?? [] as $entry) {
            if (($entry['type'] ?? null) === 'player.defeated' && ($entry['actorId'] ?? null) === $playerId) {
                return true;
            }
        }

        return false;
    }

    private function playerLife(array $snapshot, string $playerId): int
    {
        return (int) ($snapshot['players'][$playerId]['life'] ?? 40);
    }

    private function playerIsDefeated(array $snapshot, string $playerId): bool
    {
        return $this->playerLife($snapshot, $playerId) <= 0 || $this->hasLethalCommanderDamage($snapshot, $playerId);
    }

    private function hasLethalCommanderDamage(array $snapshot, string $playerId): bool
    {
        foreach (($snapshot['players'][$playerId]['commanderDamage'] ?? []) as $damage) {
            if ((int) $damage >= self::COMMANDER_DAMAGE_DEFEAT_THRESHOLD) {
                return true;
            }
        }

        return false;
    }

    private function playerDefeatedMessage(array $snapshot, string $playerId): string
    {
        return sprintf('%s ha muerto.', $this->playerName($snapshot, $playerId));
    }

    private function turnEligiblePlayerId(array $snapshot, string $requestedPlayerId): string
    {
        $players = is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [];
        $alivePlayerIds = array_values(array_filter(
            array_keys($players),
            fn (string $playerId): bool => $this->playerIsAliveForTurn($snapshot, $playerId),
        ));
        if (count($alivePlayerIds) < 2 || $this->playerIsAliveForTurn($snapshot, $requestedPlayerId)) {
            return $requestedPlayerId;
        }

        $playerIds = array_keys($players);
        $requestedIndex = array_search($requestedPlayerId, $playerIds, true);
        $startIndex = $requestedIndex === false ? -1 : $requestedIndex;
        $playerCount = count($playerIds);
        for ($offset = 1; $offset <= $playerCount; ++$offset) {
            $candidateId = $playerIds[($startIndex + $offset) % $playerCount] ?? null;
            if (is_string($candidateId) && $this->playerIsAliveForTurn($snapshot, $candidateId)) {
                return $candidateId;
            }
        }

        return $requestedPlayerId;
    }

    private function playerIsAliveForTurn(array $snapshot, string $playerId): bool
    {
        return ($snapshot['players'][$playerId]['status'] ?? 'active') === 'active'
            && !$this->playerIsDefeated($snapshot, $playerId);
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

        $card['controllerId'] = $zone === 'battlefield' ? $playerId : $card['ownerId'];
        $card['zone'] = $zone;
        if ($zone !== 'battlefield' || !$preserveBattlefieldStats) {
            $this->resetMutableStats($card);
        }
        if ($zone === 'battlefield' && is_array($position)) {
            $card['position'] = $this->normalizedPosition($position);
        } elseif ($zone !== 'battlefield') {
            $card['position'] = ['x' => 0, 'y' => 0];
        }
        if (!in_array($zone, self::HIDDEN_ZONES, true)) {
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

        return ($card['isToken'] ?? false) === true ? sprintf('Token Copy %s', $name) : $name;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardBaseName(array $card): string
    {
        $name = trim((string) ($card['name'] ?? ''));

        return $name === '' ? 'Unknown card' : $name;
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
     * @return array{x:int,y:int}
     */
    private function battlefieldCenterPosition(): array
    {
        return ['x' => 0.5, 'y' => 0.5, 'unit' => self::POSITION_UNIT_RATIO];
    }

    private function resetMutableStats(array &$card): void
    {
        $card['power'] = $card['defaultPower'] ?? null;
        $card['toughness'] = $card['defaultToughness'] ?? null;
        $card['loyalty'] = $card['defaultLoyalty'] ?? null;
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
     * @return array{power:?int,toughness:?int}
     */
    private function baseStats(array $card, mixed $power, mixed $toughness): array
    {
        $resolved = $this->baseStatsResolver?->baseStats($card);
        if ($resolved !== null) {
            return $resolved;
        }

        if (array_key_exists('defaultPower', $card) || array_key_exists('defaultToughness', $card)) {
            return [
                'power' => $this->numericStat($card['defaultPower'] ?? null),
                'toughness' => $this->numericStat($card['defaultToughness'] ?? null),
            ];
        }

        if (array_key_exists('basePower', $card) || array_key_exists('baseToughness', $card)) {
            return [
                'power' => $this->numericStat($card['basePower'] ?? null),
                'toughness' => $this->numericStat($card['baseToughness'] ?? null),
            ];
        }

        $faceStats = $this->powerToughnessFromFaces($card);
        if ($faceStats !== null) {
            return $faceStats;
        }

        return [
            'power' => $this->numericStat($power),
            'toughness' => $this->numericStat($toughness),
        ];
    }

    /**
     * @param array<string,mixed> $card
     */
    private function defaultLoyalty(array $card, mixed $loyalty): ?int
    {
        $resolved = $this->baseStatsResolver?->baseLoyalty($card);
        if ($resolved !== null) {
            return $resolved;
        }

        if (array_key_exists('defaultLoyalty', $card)) {
            $defaultLoyalty = $this->numericStat($card['defaultLoyalty']);
            if ($defaultLoyalty !== null) {
                return $defaultLoyalty;
            }
        }

        if (array_key_exists('baseLoyalty', $card)) {
            $baseLoyalty = $this->numericStat($card['baseLoyalty']);
            if ($baseLoyalty !== null) {
                return $baseLoyalty;
            }
        }

        return $this->loyaltyFromFaceStats($card)
            ?? $this->numericStat($loyalty)
            ?? $this->loyaltyFromFaces($card);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function loyaltyFromFaceStats(array $card): ?int
    {
        $faceStats = $card['faceStats'] ?? null;
        if (!is_array($faceStats)) {
            return null;
        }

        $root = $faceStats['root'] ?? null;
        if (is_array($root)) {
            $rootLoyalty = $this->numericStat($root['loyalty'] ?? null);
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

            $loyalty = $this->numericStat($face['loyalty'] ?? null);
            if ($loyalty !== null) {
                return $loyalty;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function loyaltyFromFaces(array $card): ?int
    {
        $faces = $card['cardFaces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $loyalty = $this->numericStat($face['loyalty'] ?? null);
            if ($loyalty !== null) {
                return $loyalty;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:?int,toughness:?int}|null
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

            $power = $this->numericStat($face['power'] ?? null);
            $toughness = $this->numericStat($face['toughness'] ?? null);
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
        $playerId = trim((string) ($payload[$key] ?? ''));
        if ($playerId === '' || !isset($snapshot['players'][$playerId])) {
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

    private function activeFaceIndex(array $card): int
    {
        $faces = is_array($card['cardFaces'] ?? null) ? $card['cardFaces'] : [];
        if (count($faces) < 2) {
            return 0;
        }

        return $this->positiveInt($card['activeFaceIndex'] ?? 0, 0, count($faces) - 1);
    }

    private function assertActorCanApply(array $snapshot, string $type, array $payload, User $actor): void
    {
        $actorId = $actor->id();
        if (!isset($snapshot['players'][$actorId])) {
            throw new \InvalidArgumentException('Actor is not a game player.');
        }
        if ($type === 'game.concede' || $type === 'game.close') {
            return;
        }
        if (($snapshot['players'][$actorId]['status'] ?? 'active') === 'conceded' && !in_array($type, ['chat.message', 'game.close'], true)) {
            throw new \InvalidArgumentException('Conceded players cannot perform game actions.');
        }

        if ($type === 'life.changed') {
            $this->assertActorPlayer($snapshot, $payload, $actor, 'playerId', 'You can only change your own life total.');
            return;
        }

        if ($type === 'commander.damage.changed') {
            $this->assertActorPlayer($snapshot, $payload, $actor, 'targetPlayerId', 'You can only change your own commander damage.');
            return;
        }

        $counterScopePlayerId = $type === 'counter.changed' ? $this->counterScopePlayerId($payload) : null;
        if ($counterScopePlayerId !== null) {
            if ($counterScopePlayerId !== $actorId) {
                throw new \InvalidArgumentException('You can only change your own player counters.');
            }

            return;
        }

        if (str_starts_with($type, 'library.') || in_array($type, self::ACTOR_OWN_PLAYER_COMMANDS, true)) {
            $this->assertActorPlayer($snapshot, $payload, $actor, 'playerId');
            return;
        }
        if ($type === 'turn.changed') {
            $activePlayerId = (string) ($snapshot['turn']['activePlayerId'] ?? '');
            if ($activePlayerId === '' || $activePlayerId !== $actorId) {
                throw new \InvalidArgumentException('Only the active turn player can advance the turn.');
            }
        }
    }

    private function assertActorPlayer(array $snapshot, array $payload, User $actor, string $key, string $message = 'You can only perform this action on your own hidden zones.'): void
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload, $key);
        if ($playerId !== $actor->id()) {
            throw new \InvalidArgumentException($message);
        }
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
            return array_values(array_filter(
                $target,
                static fn (mixed $playerId): bool => is_string($playerId) && isset($snapshot['players'][$playerId]),
            ));
        }
        if (is_string($target) && isset($snapshot['players'][$target])) {
            return [$target];
        }

        return ['all'];
    }

    private function playerName(array $snapshot, string $playerId): string
    {
        return (string) ($snapshot['players'][$playerId]['user']['displayName'] ?? $playerId);
    }

    private function positiveInt(mixed $value, int $min, int $max): int
    {
        $number = filter_var($value, FILTER_VALIDATE_INT);

        return is_int($number) ? max($min, min($max, $number)) : $min;
    }

    private function statLabel(mixed $value): string
    {
        return is_numeric($value) ? (string) (int) $value : '-';
    }

    private function numericStat(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }
}
