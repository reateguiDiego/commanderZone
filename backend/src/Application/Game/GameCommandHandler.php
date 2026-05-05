<?php

namespace App\Application\Game;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\User\User;
use Symfony\Component\Uid\Uuid;

class GameCommandHandler
{
    private const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
    private const HIDDEN_ZONES = ['library', 'hand'];
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
        'card.revealed',
        'card.token_copy.created',
        'card.controller.changed',
        'card.power_toughness.changed',
        'card.counter.changed',
        'stack.card_added',
    ];

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
            'arrow.created' => $log = $this->applyArrowCreated($snapshot, $payload),
            'arrow.removed' => $log = $this->applyArrowRemoved($snapshot, $payload),
            default => throw new \InvalidArgumentException(sprintf('Unknown game command: %s', $type)),
        };

        $this->commit($snapshot, $type, $log, $actor);
        $game->replaceSnapshot($snapshot);
        $event = new GameEvent($game, $type, $payload, $actor, $clientActionId);
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
            $player['status'] = in_array($player['status'] ?? 'active', ['active', 'conceded'], true) ? $player['status'] : 'active';
            $player['concededAt'] ??= null;
            $player['colorIdentity'] = $this->orderedColorIdentity(is_array($player['colorIdentity'] ?? null) ? $player['colorIdentity'] : []);
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

        return $snapshot;
    }

    private function normalizeCard(array $card, string $ownerId, string $zone): array
    {
        return [
            'instanceId' => (string) ($card['instanceId'] ?? Uuid::v7()->toRfc4122()),
            'ownerId' => (string) ($card['ownerId'] ?? $ownerId),
            'controllerId' => (string) ($card['controllerId'] ?? $ownerId),
            'scryfallId' => (string) ($card['scryfallId'] ?? ''),
            'name' => (string) ($card['name'] ?? 'Unknown card'),
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
            'typeLine' => $card['typeLine'] ?? null,
            'manaCost' => $card['manaCost'] ?? null,
            'colorIdentity' => $this->orderedColorIdentity(is_array($card['colorIdentity'] ?? null) ? $card['colorIdentity'] : []),
            'power' => $card['power'] ?? null,
            'toughness' => $card['toughness'] ?? null,
            'loyalty' => $card['loyalty'] ?? null,
            'tapped' => (bool) ($card['tapped'] ?? false),
            'faceDown' => (bool) ($card['faceDown'] ?? false),
            'revealedTo' => is_array($card['revealedTo'] ?? null) ? $card['revealedTo'] : [],
            'position' => is_array($card['position'] ?? null) ? $card['position'] : ['x' => 0, 'y' => 0],
            'rotation' => (int) ($card['rotation'] ?? 0),
            'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
            'zone' => $zone,
        ];
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
        $game->room()->archive();

        return 'Closed and archived the game.';
    }

    private function applyChatMessage(array &$snapshot, array $payload, User $actor): ?string
    {
        $message = trim((string) ($payload['message'] ?? ''));
        if ($message === '') {
            throw new \InvalidArgumentException('Message is required.');
        }

        $snapshot['chat'][] = [
            'userId' => $actor->id(),
            'displayName' => $actor->displayName(),
            'message' => mb_substr($message, 0, 800),
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
        $snapshot['chat'] = array_slice($snapshot['chat'], -150);

        return null;
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
        $snapshot['players'][$targetPlayerId]['commanderDamage'][$sourcePlayerId] = max(0, $damage);

        return sprintf(
            'Set commander damage from %s to %s to %d.',
            $this->playerName($snapshot, $sourcePlayerId),
            $this->playerName($snapshot, $targetPlayerId),
            max(0, $damage),
        );
    }

    private function applyLegacyCounterChanged(array &$snapshot, array $payload): string
    {
        $scope = trim((string) ($payload['scope'] ?? 'global'));
        $key = trim((string) ($payload['key'] ?? ''));
        if ($key === '') {
            throw new \InvalidArgumentException('Counter key is required.');
        }
        if (!array_key_exists('value', $payload) || !is_numeric($payload['value'])) {
            throw new \InvalidArgumentException('Counter value must be numeric.');
        }

        $value = (int) $payload['value'];
        $snapshot['counters'][$scope][$key] = $value;

        return sprintf('Set %s counter %s to %d.', $scope, $key, $value);
    }

    private function applyCardCounterChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $key = trim((string) ($payload['key'] ?? '+1/+1'));
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $value = array_key_exists('value', $payload)
            ? (int) $payload['value']
            : (int) ($card['counters'][$key] ?? 0) + (int) ($payload['delta'] ?? 0);
        $card['counters'][$key] = max(0, $value);

        return sprintf('Set %s %s counters to %d.', $card['name'], $key, max(0, $value));
    }

    private function applyPowerToughnessChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        if (array_key_exists('power', $payload)) {
            $card['power'] = (int) $payload['power'];
        }
        if (array_key_exists('toughness', $payload)) {
            $card['toughness'] = (int) $payload['toughness'];
        }
        if (array_key_exists('loyalty', $payload)) {
            $card['loyalty'] = (int) $payload['loyalty'];
        }

        return sprintf('Updated %s stats.', $card['name']);
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

        $card = $this->takeCard($snapshot, $playerId, $fromZone, $instanceId);
        $targetPlayerId = isset($payload['targetPlayerId'])
            ? $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId')
            : $playerId;
        $this->putCard($snapshot, $targetPlayerId, $toZone, $card, $payload['position'] ?? 'top');

        return sprintf('Moved %s from %s to %s.', $card['name'], $fromZone, $toZone);
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

        $moved = 0;
        foreach ($instanceIds as $instanceId) {
            if (!is_string($instanceId) || $instanceId === '') {
                continue;
            }
            $card = $this->takeCard($snapshot, $playerId, $fromZone, $instanceId);
            $this->putCard($snapshot, $playerId, $toZone, $card, $payload['position'] ?? 'top');
            ++$moved;
        }

        return sprintf('Moved %d cards from %s to %s.', $moved, $fromZone, $toZone);
    }

    private function applyCardTapped(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['tapped'] = (bool) ($payload['tapped'] ?? !($card['tapped'] ?? false));
        $card['rotation'] = $card['tapped'] ? 90 : 0;

        return sprintf('%s %s.', $card['tapped'] ? 'Tapped' : 'Untapped', $card['name']);
    }

    private function applyCardPositionChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        if ($location['zone'] !== 'battlefield') {
            throw new \InvalidArgumentException('Only battlefield cards can be freely positioned.');
        }

        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['position'] = $this->normalizedPosition($payload['position'] ?? null);

        return sprintf('Moved %s on battlefield.', $card['name']);
    }

    private function applyCardFaceDown(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['faceDown'] = (bool) ($payload['faceDown'] ?? !($card['faceDown'] ?? false));
        if ($card['faceDown']) {
            $card['revealedTo'] = [$location['playerId']];
        }

        return sprintf('%s %s.', $card['faceDown'] ? 'Turned face down' : 'Turned face up', $card['name']);
    }

    private function applyCardRevealed(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['revealedTo'] = $this->visibilityTargets($snapshot, $payload['to'] ?? 'all');

        return sprintf('Revealed %s.', $card['name']);
    }

    private function applyTokenCopyCreated(array &$snapshot, array $payload, User $actor): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $source = $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $targetPlayerId = isset($payload['targetPlayerId'])
            ? $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId')
            : $actor->id();
        if (!isset($snapshot['players'][$targetPlayerId])) {
            $targetPlayerId = $location['playerId'];
        }

        $copy = [
            ...$source,
            'instanceId' => Uuid::v7()->toRfc4122(),
            'ownerId' => $targetPlayerId,
            'controllerId' => $targetPlayerId,
            'tapped' => false,
            'faceDown' => false,
            'revealedTo' => [],
            'counters' => [],
            'zone' => 'battlefield',
            'isToken' => true,
        ];
        $snapshot['players'][$targetPlayerId]['zones']['battlefield'][] = $copy;

        return sprintf('Created token copy of %s.', $source['name']);
    }

    private function applyControllerChanged(array &$snapshot, array $payload): string
    {
        $location = $this->requiredCardLocation($snapshot, $payload);
        $targetPlayerId = $this->requiredPlayerId($snapshot, $payload, 'targetPlayerId');
        $card =& $snapshot['players'][$location['playerId']]['zones'][$location['zone']][$location['index']];
        $card['controllerId'] = $targetPlayerId;

        return sprintf('Gave %s to %s.', $card['name'], $this->playerName($snapshot, $targetPlayerId));
    }

    private function applyTurnChanged(array &$snapshot, array $payload): string
    {
        if (!array_key_exists('activePlayerId', $payload)
            && !array_key_exists('phase', $payload)
            && !array_key_exists('number', $payload)) {
            throw new \InvalidArgumentException('turn.changed requires activePlayerId, phase, or number.');
        }

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

        return 'Changed turn.';
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
        $cards = $snapshot['players'][$playerId]['zones'][$fromZone];
        $snapshot['players'][$playerId]['zones'][$fromZone] = [];
        foreach ($cards as $card) {
            $this->putCard($snapshot, $playerId, $toZone, $card, $payload['position'] ?? 'top');
        }

        return sprintf('Moved all cards from %s to %s.', $fromZone, $toZone);
    }

    private function applyLibraryDraw(array &$snapshot, array $payload, int $count): string
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload);
        $drawn = 0;
        for ($i = 0; $i < $count; ++$i) {
            $card = array_pop($snapshot['players'][$playerId]['zones']['library']);
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
            $card = array_pop($snapshot['players'][$playerId]['zones']['library']);
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
            $index = count($library) - 1 - $i;
            if (!isset($library[$index])) {
                break;
            }
            $library[$index]['revealedTo'] = $targets;
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
        $card = array_pop($snapshot['players'][$playerId]['zones']['library']);
        if (!is_array($card)) {
            throw new \InvalidArgumentException('Library is empty.');
        }
        $this->putCard($snapshot, $playerId, 'battlefield', $card);

        return sprintf('Played %s from top of library.', $card['name']);
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

        return sprintf('Added %s to stack.', $card['name']);
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

    private function applyArrowCreated(array &$snapshot, array $payload): string
    {
        $fromInstanceId = trim((string) ($payload['fromInstanceId'] ?? ''));
        $toInstanceId = trim((string) ($payload['toInstanceId'] ?? ''));
        if ($fromInstanceId === '' || $toInstanceId === '') {
            throw new \InvalidArgumentException('fromInstanceId and toInstanceId are required.');
        }

        $snapshot['arrows'][] = [
            'id' => Uuid::v7()->toRfc4122(),
            'fromInstanceId' => $fromInstanceId,
            'toInstanceId' => $toInstanceId,
            'color' => trim((string) ($payload['color'] ?? 'yellow')),
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];

        return 'Created arrow.';
    }

    private function applyArrowRemoved(array &$snapshot, array $payload): string
    {
        $id = trim((string) ($payload['id'] ?? ''));
        if ($id === '') {
            throw new \InvalidArgumentException('id is required.');
        }
        $snapshot['arrows'] = array_values(array_filter(
            $snapshot['arrows'],
            static fn (array $arrow): bool => ($arrow['id'] ?? null) !== $id,
        ));

        return 'Removed arrow.';
    }

    private function commit(array &$snapshot, string $type, ?string $message, User $actor): void
    {
        $snapshot['version'] = ((int) ($snapshot['version'] ?? 1)) + 1;
        $snapshot['updatedAt'] = (new \DateTimeImmutable())->format(DATE_ATOM);

        if ($message !== null && $message !== '') {
            $snapshot['eventLog'][] = [
                'id' => Uuid::v7()->toRfc4122(),
                'type' => $type,
                'message' => $message,
                'actorId' => $actor->id(),
                'displayName' => $actor->displayName(),
                'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
            ];
            $snapshot['eventLog'] = array_slice($snapshot['eventLog'], -250);
        }
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
    private function putCard(array &$snapshot, string $playerId, string $zone, array $card, string|array $position = 'top'): void
    {
        $card = $this->normalizeCard($card, (string) ($card['ownerId'] ?? $playerId), $zone);
        $card['zone'] = $zone;
        if ($zone === 'battlefield' && is_array($position)) {
            $card['position'] = $this->normalizedPosition($position);
        } elseif ($zone !== 'battlefield') {
            $card['position'] = ['x' => 0, 'y' => 0];
        }
        if (!in_array($zone, self::HIDDEN_ZONES, true)) {
            $card['revealedTo'] = [];
        }

        if ($zone === 'library' && $position === 'bottom') {
            array_unshift($snapshot['players'][$playerId]['zones'][$zone], $card);

            return;
        }

        $snapshot['players'][$playerId]['zones'][$zone][] = $card;
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
     * @return array{x:int,y:int}
     */
    private function normalizedPosition(mixed $position): array
    {
        if (!is_array($position)) {
            return ['x' => 0, 'y' => 0];
        }

        return [
            'x' => max(0, min(3000, (int) ($position['x'] ?? 0))),
            'y' => max(0, min(2000, (int) ($position['y'] ?? 0))),
        ];
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

        if (str_starts_with($type, 'library.') || in_array($type, self::ACTOR_OWN_PLAYER_COMMANDS, true)) {
            $this->assertActorPlayer($snapshot, $payload, $actor, 'playerId');
            return;
        }
    }

    private function assertActorPlayer(array $snapshot, array $payload, User $actor, string $key): void
    {
        $playerId = $this->requiredPlayerId($snapshot, $payload, $key);
        if ($playerId !== $actor->id()) {
            throw new \InvalidArgumentException('You can only perform this action on your own hidden zones.');
        }
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
}
