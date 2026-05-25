<?php

namespace App\Application\Game\WebSocket;

use App\Domain\Game\GameEvent;

final readonly class GameWebsocketPatchBuilder
{
    private const HIDDEN_ZONES = ['hand', 'library'];
    private const MAX_MOVE_OPERATIONS = 40;
    private const MAX_STATE_OPERATIONS = 40;
    private const MAX_VISIBLE_ZONE_CARDS = 40;
    private const MAX_SHARED_COLLECTION_ITEMS = 40;

    public function __construct(private GameWebsocketMessageFactory $messages)
    {
    }

    /**
     * @param array<string,mixed> $previousSnapshot
     * @param array<string,mixed> $nextSnapshot
     *
     * @return array<string,mixed>
     */
    /**
     * @param array<string,mixed>|null $eventPayload
     */
    public function build(string $gameId, array $previousSnapshot, array $nextSnapshot, GameEvent $event, ?array $eventPayload = null, ?string $viewerId = null): array
    {
        $baseVersion = $this->snapshotVersion($previousSnapshot);
        $version = $this->snapshotVersion($nextSnapshot);
        $clientActionId = $event->clientActionId();
        if ($version !== $baseVersion + 1) {
            return $this->messages->resyncRequired($gameId, $version, 'projection_unavailable', $clientActionId);
        }

        $operations = $this->operations($previousSnapshot, $nextSnapshot, $event, $eventPayload, $viewerId);
        if ($operations === null) {
            return $this->messages->resyncRequired($gameId, $version, 'projection_unavailable', $clientActionId);
        }

        return $this->messages->gamePatch(
            $gameId,
            $baseVersion,
            $version,
            $operations,
            $event,
            $this->sanitizedEventPayload($event, $eventPayload, $viewerId),
        );
    }

    /**
     * @param array<string,mixed> $previousSnapshot
     * @param array<string,mixed> $nextSnapshot
     *
     * @return list<array<string,mixed>>|null
     */
    /**
     * @param array<string,mixed>|null $eventPayload
     *
     * @return list<array<string,mixed>>|null
     */
    private function operations(array $previousSnapshot, array $nextSnapshot, GameEvent $event, ?array $eventPayload = null, ?string $viewerId = null): ?array
    {
        $eventData = $event->toArray();
        $type = (string) ($eventData['type'] ?? '');
        $payload = $eventPayload ?? (is_array($eventData['payload'] ?? null) ? $eventData['payload'] : []);

        return match ($type) {
            'life.changed' => $this->lifeChanged($nextSnapshot, $payload),
            'commander.damage.changed' => $this->commanderDamageChanged($nextSnapshot, $payload),
            'counter.changed' => $this->counterChanged($nextSnapshot, $payload),
            'chat.message' => $this->chatMessage($previousSnapshot, $nextSnapshot, $payload),
            'dice.rolled' => $this->eventLogOnly($previousSnapshot, $nextSnapshot),
            'turn.changed' => $this->turnChanged($previousSnapshot, $nextSnapshot),
            'card.position.changed' => $this->cardPositionChanged($nextSnapshot, $payload),
            'cards.position.changed' => $this->cardsPositionChanged($nextSnapshot, $payload),
            'card.tapped' => $this->cardTapped($nextSnapshot, $payload),
            'card.moved' => $this->cardMoved($previousSnapshot, $nextSnapshot, $payload),
            'cards.moved' => $this->cardsMoved($previousSnapshot, $nextSnapshot, $payload),
            'zone.changed' => $this->zoneChanged($previousSnapshot, $nextSnapshot, $payload),
            'zone.move_all' => $this->zoneMoveAll($previousSnapshot, $nextSnapshot, $payload),
            'zone.random_card.selected' => $this->zoneRandomCardSelected($previousSnapshot, $nextSnapshot, $payload, $viewerId),
            'library.draw' => $this->libraryDraw($previousSnapshot, $nextSnapshot, $payload, 1),
            'library.draw_many' => $this->libraryDraw($previousSnapshot, $nextSnapshot, $payload, max(1, (int) ($payload['count'] ?? 1))),
            'library.shuffle' => $this->libraryShuffle($previousSnapshot, $nextSnapshot, $payload),
            'library.move_top' => $this->libraryMoveTop($previousSnapshot, $nextSnapshot, $payload),
            'library.reveal_top' => $this->libraryRevealTop($previousSnapshot, $nextSnapshot, $payload, $viewerId),
            'library.reveal' => $this->libraryReveal($previousSnapshot, $nextSnapshot, $payload, $viewerId),
            'library.view' => $this->libraryView($previousSnapshot, $nextSnapshot, $payload, $viewerId),
            'library.play_top_revealed' => $this->libraryPlayTopRevealed($previousSnapshot, $nextSnapshot, $payload, $viewerId),
            'library.reorder_top' => $this->libraryReorderTop($previousSnapshot, $nextSnapshot, $payload, $viewerId),
            'card.face_down.changed' => $this->cardProjectionChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.face.changed' => $this->cardProjectionChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.revealed' => $this->cardProjectionChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.counter.changed' => $this->cardCounterChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.power_toughness.changed' => $this->cardStatsChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.controller.changed' => $this->cardControllerChanged($previousSnapshot, $nextSnapshot, $payload),
            'battlefield.untap_all' => $this->battlefieldUntapAll($previousSnapshot, $nextSnapshot, $payload),
            'card.token.created' => $this->tokenCreated($previousSnapshot, $nextSnapshot),
            'card.token_copy.created' => $this->tokenCreated($previousSnapshot, $nextSnapshot),
            'stack.card_added' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'stack', 'stack.item.add', 'stack.item.remove', 'stack.set', 'item', 'stack'),
            'stack.item_removed' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'stack', 'stack.item.add', 'stack.item.remove', 'stack.set', 'item', 'stack'),
            'arrow.created' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'arrows', 'arrow.add', 'arrow.remove', 'arrows.set', 'arrow', 'arrows'),
            'arrow.removed' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'arrows', 'arrow.add', 'arrow.remove', 'arrows.set', 'arrow', 'arrows'),
            'attachment.created' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'attachments', 'attachment.add', 'attachment.remove', 'attachments.set', 'attachment', 'attachments'),
            'attachment.removed' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'attachments', 'attachment.add', 'attachment.remove', 'attachments.set', 'attachment', 'attachments'),
            'game.concede' => $this->gameConcede($previousSnapshot, $nextSnapshot, $eventData),
            'game.close' => $this->eventLogOnly($previousSnapshot, $nextSnapshot),
            'disconnect.vote.updated' => $this->disconnectVoteUpdated($previousSnapshot, $nextSnapshot),
            default => null,
        };
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function lifeChanged(array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null || !isset($nextSnapshot['players'][$playerId]['life'])) {
            return null;
        }

        return [[
            'op' => 'player.life.set',
            'playerId' => $playerId,
            'value' => (int) $nextSnapshot['players'][$playerId]['life'],
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function commanderDamageChanged(array $nextSnapshot, array $payload): ?array
    {
        $targetPlayerId = $this->payloadString($payload, 'targetPlayerId');
        if ($targetPlayerId === null || !isset($nextSnapshot['players'][$targetPlayerId]['commanderDamage'])) {
            return null;
        }

        return [[
            'op' => 'player.commanderDamage.set',
            'playerId' => $targetPlayerId,
            'commanderDamage' => $this->stringIntMap($nextSnapshot['players'][$targetPlayerId]['commanderDamage']),
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function counterChanged(array $nextSnapshot, array $payload): ?array
    {
        $scope = $this->payloadString($payload, 'scope');
        if ($scope === null) {
            return null;
        }

        if (str_starts_with($scope, 'player:')) {
            $playerId = substr($scope, strlen('player:'));
            if ($playerId === '' || !isset($nextSnapshot['players'][$playerId]['counters'])) {
                return null;
            }

            return [[
                'op' => 'player.counters.set',
                'playerId' => $playerId,
                'counters' => $this->stringIntMap($nextSnapshot['players'][$playerId]['counters']),
            ]];
        }

        $countersByScope = $nextSnapshot['counters'] ?? [];
        if (!is_array($countersByScope)) {
            return null;
        }
        $scopeCounters = $countersByScope[$scope] ?? [];
        if (!is_array($scopeCounters)) {
            $scopeCounters = [];
        }

        return [[
            'op' => 'game.counters.set',
            'scope' => $scope,
            'counters' => $this->stringIntMap($scopeCounters),
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function chatMessage(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $chatEntries = $this->appendedEntries($previousSnapshot, $nextSnapshot, 'chat');
        $operations = [];
        if ($chatEntries !== null && $chatEntries !== []) {
            $operations[] = [
                'op' => 'chat.append',
                'entries' => $chatEntries,
            ];
        }
        $eventLogEntries = $this->appendedEntries($previousSnapshot, $nextSnapshot, 'eventLog');
        if ($eventLogEntries !== null && $eventLogEntries !== []) {
            $operations[] = [
                'op' => 'eventLog.append',
                'entries' => $eventLogEntries,
            ];
        }

        return $operations;
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function eventLogOnly(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $eventLogEntries = $this->appendedEntries($previousSnapshot, $nextSnapshot, 'eventLog');
        if ($eventLogEntries === null || $eventLogEntries === []) {
            return null;
        }

        return [[
            'op' => 'eventLog.append',
            'entries' => $eventLogEntries,
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function turnChanged(array $previousSnapshot, array $nextSnapshot): ?array
    {
        if (!is_array($nextSnapshot['turn'] ?? null)) {
            return null;
        }

        $operations = [[
            'op' => 'turn.set',
            'turn' => $nextSnapshot['turn'],
        ]];
        $eventLogEntries = $this->appendedEntries($previousSnapshot, $nextSnapshot, 'eventLog');
        if ($eventLogEntries !== null && $eventLogEntries !== []) {
            $operations[] = [
                'op' => 'eventLog.append',
                'entries' => $eventLogEntries,
            ];
        }

        return $operations;
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardPositionChanged(array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $zone = $this->payloadString($payload, 'zone');
        $instanceId = $this->payloadString($payload, 'instanceId');
        if ($playerId === null || $zone === null || $instanceId === null) {
            return null;
        }

        $card = $this->card($nextSnapshot, $playerId, $zone, $instanceId);
        if ($card === null || !is_array($card['position'] ?? null)) {
            return null;
        }

        return [[
            'op' => 'card.position.set',
            'playerId' => $playerId,
            'zone' => $zone,
            'instanceId' => $instanceId,
            'position' => $card['position'],
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardsPositionChanged(array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $zone = $this->payloadString($payload, 'zone');
        $positionPayloads = $payload['positions'] ?? null;
        if ($playerId === null || $zone === null || !is_array($positionPayloads) || $positionPayloads === []) {
            return null;
        }

        $positions = [];
        foreach ($positionPayloads as $positionPayload) {
            if (!is_array($positionPayload)) {
                return null;
            }

            $instanceId = $this->payloadString($positionPayload, 'instanceId');
            if ($instanceId === null) {
                return null;
            }

            $card = $this->card($nextSnapshot, $playerId, $zone, $instanceId);
            if ($card === null || !is_array($card['position'] ?? null)) {
                return null;
            }

            $positions[] = [
                'instanceId' => $instanceId,
                'position' => $card['position'],
            ];
        }

        return [[
            'op' => 'cards.position.set',
            'playerId' => $playerId,
            'zone' => $zone,
            'positions' => $positions,
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardTapped(array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $zone = $this->payloadString($payload, 'zone');
        $instanceId = $this->payloadString($payload, 'instanceId');
        if ($playerId === null || $zone === null || $instanceId === null) {
            return null;
        }

        $card = $this->card($nextSnapshot, $playerId, $zone, $instanceId);
        if ($card === null) {
            return null;
        }

        return [[
            'op' => 'card.state.set',
            'playerId' => $playerId,
            'zone' => $zone,
            'instanceId' => $instanceId,
            'tapped' => (bool) ($card['tapped'] ?? false),
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardMoved(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $fromZone = $this->payloadString($payload, 'fromZone');
        $toZone = $this->payloadString($payload, 'toZone');
        $instanceId = $this->payloadString($payload, 'instanceId');
        if ($playerId === null || $fromZone === null || $toZone === null || $instanceId === null) {
            return null;
        }

        $moves = $this->moveOperations($previousSnapshot, $nextSnapshot, [[
            'instanceId' => $instanceId,
            'fromPlayerId' => $playerId,
            'fromZone' => $fromZone,
            'toPlayerId' => $this->payloadString($payload, 'targetPlayerId') ?? $this->nextCardPlayerId($nextSnapshot, $instanceId) ?? $playerId,
            'toZone' => $toZone,
        ]]);
        if ($moves === null) {
            return null;
        }

        return $this->withSharedMovementOperations($previousSnapshot, $nextSnapshot, $moves);
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardsMoved(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $fromZone = $this->payloadString($payload, 'fromZone');
        $toZone = $this->payloadString($payload, 'toZone');
        $instanceIds = $payload['instanceIds'] ?? null;
        if ($playerId === null || $fromZone === null || $toZone === null || !is_array($instanceIds) || $instanceIds === []) {
            return null;
        }

        $moves = [];
        foreach ($instanceIds as $instanceId) {
            if (!is_string($instanceId) || trim($instanceId) === '') {
                return null;
            }

            $moves[] = [
                'instanceId' => $instanceId,
                'fromPlayerId' => $playerId,
                'fromZone' => $fromZone,
                'toPlayerId' => $this->nextCardPlayerId($nextSnapshot, $instanceId) ?? $this->payloadString($payload, 'targetPlayerId') ?? $playerId,
                'toZone' => $toZone,
            ];
        }

        $operations = $this->moveOperations($previousSnapshot, $nextSnapshot, $moves);
        if ($operations === null) {
            return null;
        }

        return $this->withSharedMovementOperations($previousSnapshot, $nextSnapshot, $operations);
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function zoneMoveAll(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $fromZone = $this->payloadString($payload, 'fromZone');
        $toZone = $this->payloadString($payload, 'toZone');
        if ($playerId === null || $fromZone === null || $toZone === null) {
            return null;
        }

        $sourceCards = $previousSnapshot['players'][$playerId]['zones'][$fromZone] ?? null;
        if (!is_array($sourceCards)) {
            return null;
        }

        if (count($sourceCards) > self::MAX_MOVE_OPERATIONS) {
            return null;
        }

        $moves = [];
        foreach ($sourceCards as $card) {
            if (!is_array($card) || !is_string($card['instanceId'] ?? null) || $card['instanceId'] === '') {
                return null;
            }

            $moves[] = [
                'instanceId' => $card['instanceId'],
                'fromPlayerId' => $playerId,
                'fromZone' => $fromZone,
                'toPlayerId' => $this->nextCardPlayerId($nextSnapshot, $card['instanceId']) ?? $playerId,
                'toZone' => $toZone,
            ];
        }

        $operations = $this->moveOperations($previousSnapshot, $nextSnapshot, $moves);
        if ($operations === null) {
            return null;
        }

        return $this->withSharedMovementOperations($previousSnapshot, $nextSnapshot, $operations);
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function zoneChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $zone = $this->payloadString($payload, 'zone');
        $instanceIds = $payload['instanceIds'] ?? null;
        if ($playerId === null || $zone === null || !is_array($instanceIds) || $instanceIds === []) {
            return null;
        }

        if ($this->isHiddenZone($zone) && !$this->projectionContainsInstanceIds($previousSnapshot, $playerId, $zone, $instanceIds)) {
            return [
                ...$this->zoneCountOperations($previousSnapshot, $nextSnapshot),
                ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
            ];
        }

        $operations = [];
        foreach (array_values($instanceIds) as $index => $instanceId) {
            if (!is_string($instanceId) || trim($instanceId) === '') {
                return null;
            }

            if ($this->card($previousSnapshot, $playerId, $zone, $instanceId) === null) {
                return null;
            }

            $operations[] = [
                'op' => 'card.move',
                'instanceId' => $instanceId,
                'from' => ['playerId' => $playerId, 'zone' => $zone],
                'to' => ['playerId' => $playerId, 'zone' => $zone, 'index' => $index],
            ];
        }

        return $this->withSharedMovementOperations($previousSnapshot, $nextSnapshot, $operations);
    }

    /**
     * @param array<mixed> $instanceIds
     */
    private function projectionContainsInstanceIds(array $snapshot, string $playerId, string $zone, array $instanceIds): bool
    {
        foreach ($instanceIds as $instanceId) {
            if (!is_string($instanceId) || trim($instanceId) === '') {
                return false;
            }

            if ($this->card($snapshot, $playerId, $zone, $instanceId) === null) {
                return false;
            }
        }

        return true;
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function zoneRandomCardSelected(array $previousSnapshot, array $nextSnapshot, array $payload, ?string $viewerId): ?array
    {
        return $this->eventLogAppendOperation(
            $previousSnapshot,
            $nextSnapshot,
            $this->shouldSanitizeHiddenZonePayload($payload, $viewerId),
        );
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function libraryDraw(array $previousSnapshot, array $nextSnapshot, array $payload, int $count): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null) {
            return null;
        }
        if ($count > self::MAX_MOVE_OPERATIONS) {
            return null;
        }

        $moves = [];
        foreach ($this->topProjectedCards($previousSnapshot, $playerId, min($count, self::MAX_MOVE_OPERATIONS)) as $card) {
            $instanceId = $this->cardInstanceId($card);
            if ($instanceId === null) {
                return null;
            }

            $moves[] = [
                'instanceId' => $instanceId,
                'fromPlayerId' => $playerId,
                'fromZone' => 'library',
                'toPlayerId' => $playerId,
                'toZone' => 'hand',
            ];
        }

        $operations = $moves === [] ? [] : $this->moveOperations($previousSnapshot, $nextSnapshot, $moves);
        if ($operations === null) {
            return null;
        }

        return $this->withSharedMovementOperations($previousSnapshot, $nextSnapshot, $operations);
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function libraryMoveTop(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $toZone = $this->payloadString($payload, 'toZone');
        if ($playerId === null || $toZone === null) {
            return null;
        }

        $targetPlayerId = $this->payloadString($payload, 'targetPlayerId') ?? $playerId;
        $count = max(1, (int) ($payload['count'] ?? 1));
        if ($count > self::MAX_MOVE_OPERATIONS) {
            return null;
        }
        $instanceIds = $this->libraryTopMoveInstanceIds($previousSnapshot, $nextSnapshot, $playerId, $targetPlayerId, $toZone, $count);
        $moves = [];
        foreach ($instanceIds as $instanceId) {
            $moves[] = [
                'instanceId' => $instanceId,
                'fromPlayerId' => $playerId,
                'fromZone' => 'library',
                'toPlayerId' => $targetPlayerId,
                'toZone' => $toZone,
            ];
        }

        $operations = $moves === [] ? [] : $this->moveOperations($previousSnapshot, $nextSnapshot, $moves);
        if ($operations === null) {
            return null;
        }

        return $this->withSharedMovementOperations($previousSnapshot, $nextSnapshot, $operations);
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function libraryShuffle(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null) {
            return null;
        }

        return [
            ...$this->libraryVisibilityOperations($previousSnapshot, $nextSnapshot, $playerId),
            [
                'op' => 'zone.visible.set',
                'playerId' => $playerId,
                'zone' => 'library',
                'cards' => [],
            ],
            ...$this->zoneCountOperations($previousSnapshot, $nextSnapshot),
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function libraryRevealTop(array $previousSnapshot, array $nextSnapshot, array $payload, ?string $viewerId): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null) {
            return null;
        }

        $count = max(1, (int) ($payload['count'] ?? 1));
        $operations = $this->visibleZoneOperations($nextSnapshot, $playerId, 'library', $count);
        if ($operations === null) {
            return null;
        }

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function libraryReveal(array $previousSnapshot, array $nextSnapshot, array $payload, ?string $viewerId): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null) {
            return null;
        }

        $operations = $this->libraryVisibilityOperations($previousSnapshot, $nextSnapshot, $playerId);
        if ($viewerId !== $playerId || count($this->zoneCards($nextSnapshot, $playerId, 'library')) <= self::MAX_VISIBLE_ZONE_CARDS) {
            $visibleOperations = $this->visibleZoneOperations($nextSnapshot, $playerId, 'library');
            if ($visibleOperations === null) {
                return null;
            }
            $operations = [...$operations, ...$visibleOperations];
        }

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function libraryView(array $previousSnapshot, array $nextSnapshot, array $payload, ?string $viewerId): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null) {
            return null;
        }

        $operations = [];
        if ($viewerId === $playerId) {
            $limit = isset($payload['count']) ? max(1, (int) $payload['count']) : null;
            $visibleOperations = $this->visibleZoneOperations($nextSnapshot, $playerId, 'library', $limit);
            if ($visibleOperations === null) {
                return null;
            }
            $operations = $visibleOperations;
        }

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function libraryPlayTopRevealed(array $previousSnapshot, array $nextSnapshot, array $payload, ?string $viewerId): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null) {
            return null;
        }

        $operations = $this->libraryVisibilityOperations($previousSnapshot, $nextSnapshot, $playerId);
        if ($viewerId !== $playerId) {
            $visibleOperations = $this->visibleZoneOperations($nextSnapshot, $playerId, 'library');
            if ($visibleOperations === null) {
                return null;
            }
            $operations = [...$operations, ...$visibleOperations];
        }

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function libraryReorderTop(array $previousSnapshot, array $nextSnapshot, array $payload, ?string $viewerId): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $instanceIds = $payload['instanceIds'] ?? null;
        if ($playerId === null || !is_array($instanceIds)) {
            return null;
        }

        $operations = [];
        if ($viewerId === $playerId) {
            foreach (array_values($instanceIds) as $index => $instanceId) {
                if (!is_string($instanceId) || trim($instanceId) === '') {
                    return null;
                }

                if ($this->card($previousSnapshot, $playerId, 'library', $instanceId) === null) {
                    return null;
                }

                $operations[] = [
                    'op' => 'card.move',
                    'instanceId' => $instanceId,
                    'from' => ['playerId' => $playerId, 'zone' => 'library'],
                    'to' => ['playerId' => $playerId, 'zone' => 'library', 'index' => $index],
                ];
            }
        }

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardProjectionChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $location = $this->payloadCardLocation($payload);
        if ($location === null) {
            return null;
        }

        $operations = $this->projectedCardRefreshOperations($nextSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);
        if ($operations === null) {
            return null;
        }

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, $this->operationTouchesSensitiveProjection($nextSnapshot, $location)),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardCounterChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $location = $this->payloadCardLocation($payload);
        if ($location === null) {
            return null;
        }

        $previousCard = $this->card($previousSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);
        $nextCard = $this->card($nextSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);
        if ($nextCard === null) {
            return $this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, true);
        }

        if ($this->isSensitiveProjectedCard($nextCard)) {
            $operations = $this->projectedCardRefreshOperations($nextSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);
            if ($operations === null) {
                return null;
            }

            return [
                ...$operations,
                ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, true),
            ];
        }

        $operations = [[
            'op' => 'card.counters.set',
            'playerId' => $location['playerId'],
            'zone' => $location['zone'],
            'instanceId' => $location['instanceId'],
            'counters' => is_array($nextCard['counters'] ?? null) ? $nextCard['counters'] : [],
        ]];
        $statsOperation = $this->cardStatsSetOperation($previousCard, $nextCard, $location);
        if ($statsOperation !== null) {
            $operations[] = $statsOperation;
        }

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardStatsChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $location = $this->payloadCardLocation($payload);
        if ($location === null) {
            return null;
        }

        $previousCard = $this->card($previousSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);
        $nextCard = $this->card($nextSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);
        if ($nextCard === null) {
            return $this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, true);
        }

        if ($this->isSensitiveProjectedCard($nextCard)) {
            $operations = $this->projectedCardRefreshOperations($nextSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);
            if ($operations === null) {
                return null;
            }

            return [
                ...$operations,
                ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, true),
            ];
        }

        $operation = $this->cardStatsSetOperation($previousCard, $nextCard, $location, false);
        if ($operation === null) {
            return null;
        }

        return [
            $operation,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardControllerChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $instanceId = $this->payloadString($payload, 'instanceId');
        if ($playerId === null || $instanceId === null) {
            return null;
        }

        $targetPlayerId = $this->nextCardPlayerId($nextSnapshot, $instanceId) ?? $this->payloadString($payload, 'targetPlayerId');
        if ($targetPlayerId === null) {
            return null;
        }

        $operations = $this->moveOperations($previousSnapshot, $nextSnapshot, [[
            'instanceId' => $instanceId,
            'fromPlayerId' => $playerId,
            'fromZone' => 'battlefield',
            'toPlayerId' => $targetPlayerId,
            'toZone' => 'battlefield',
        ]]);
        if ($operations === null) {
            return null;
        }

        return $this->withSharedMovementOperations($previousSnapshot, $nextSnapshot, $operations);
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function battlefieldUntapAll(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null) {
            return null;
        }

        $states = [];
        foreach ($this->zoneCards($nextSnapshot, $playerId, 'battlefield') as $nextCard) {
            $instanceId = $this->cardInstanceId($nextCard);
            if ($instanceId === null) {
                return null;
            }

            $previousCard = $this->card($previousSnapshot, $playerId, 'battlefield', $instanceId);
            if ($previousCard === null || ($previousCard['tapped'] ?? false) === ($nextCard['tapped'] ?? false)) {
                continue;
            }

            $state = [
                'instanceId' => $instanceId,
                'tapped' => (bool) ($nextCard['tapped'] ?? false),
            ];
            if (array_key_exists('rotation', $nextCard)) {
                $state['rotation'] = (int) $nextCard['rotation'];
            }
            $states[] = $state;
        }

        if (count($states) > self::MAX_STATE_OPERATIONS) {
            return null;
        }

        $operations = $states === []
            ? []
            : [[
                'op' => 'cards.state.set',
                'playerId' => $playerId,
                'zone' => 'battlefield',
                'cards' => $states,
            ]];

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function tokenCreated(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $created = $this->createdBattlefieldCards($previousSnapshot, $nextSnapshot);
        if (count($created) !== 1) {
            return null;
        }

        $entry = $created[0];

        return [
            [
                'op' => 'card.create',
                'playerId' => $entry['playerId'],
                'zone' => 'battlefield',
                'index' => $entry['index'],
                'card' => $entry['card'],
            ],
            ...$this->zoneCountOperations($previousSnapshot, $nextSnapshot),
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, $this->isSensitiveProjectedCard($entry['card'])),
        ];
    }

    /**
     * @param list<array{instanceId:string,fromPlayerId:string,fromZone:string,toPlayerId:string,toZone:string}> $moves
     *
     * @return list<array<string,mixed>>|null
     */
    private function moveOperations(array $previousSnapshot, array $nextSnapshot, array $moves): ?array
    {
        if (count($moves) > self::MAX_MOVE_OPERATIONS) {
            return null;
        }

        $operations = [];
        foreach ($moves as $move) {
            $previousCard = $this->card($previousSnapshot, $move['fromPlayerId'], $move['fromZone'], $move['instanceId']);
            $nextCard = $this->card($nextSnapshot, $move['toPlayerId'], $move['toZone'], $move['instanceId']);
            $destinationIndex = $this->cardIndex($nextSnapshot, $move['toPlayerId'], $move['toZone'], $move['instanceId']);
            $sourceHidden = $this->isHiddenZone($move['fromZone']);
            $destinationHidden = $this->isHiddenZone($move['toZone']);

            if ($previousCard === null && $nextCard === null && $sourceHidden && $destinationHidden) {
                continue;
            }

            if ($previousCard === null && $nextCard === null && !$destinationHidden) {
                return null;
            }

            $operation = [
                'op' => 'card.move',
                'instanceId' => $move['instanceId'],
                'from' => ['playerId' => $move['fromPlayerId'], 'zone' => $move['fromZone']],
                'to' => ['playerId' => $move['toPlayerId'], 'zone' => $move['toZone']],
            ];
            if ($previousCard !== null && $nextCard === null) {
                $operations[] = [
                    'op' => 'card.remove',
                    'playerId' => $move['fromPlayerId'],
                    'zone' => $move['fromZone'],
                    'instanceId' => $move['instanceId'],
                ];
                continue;
            }

            if ($destinationIndex !== null) {
                $operation['to']['index'] = $destinationIndex;
            }

            if ($nextCard !== null && ($sourceHidden || $previousCard === null || $this->shouldIncludeMovedCard($previousCard, $nextCard))) {
                $operation['card'] = $nextCard;
            } elseif ($nextCard === null && $destinationHidden) {
                $operation['card'] = $this->hiddenDestinationCard($nextSnapshot, $move['toPlayerId'], $move['toZone']);
            }

            if (!isset($operation['card']) && $previousCard === null) {
                return null;
            }

            $operations[] = $operation;
        }

        if (count($operations) > self::MAX_MOVE_OPERATIONS) {
            return null;
        }

        return $operations;
    }

    /**
     * @param list<array<string,mixed>> $operations
     *
     * @return list<array<string,mixed>>|null
     */
    private function withSharedMovementOperations(array $previousSnapshot, array $nextSnapshot, array $operations): ?array
    {
        $arrowOperations = $this->collectionDiffOperations($previousSnapshot, $nextSnapshot, 'arrows', 'arrow.add', 'arrow.remove', 'arrows.set', 'arrow', 'arrows');
        $attachmentOperations = $this->collectionDiffOperations($previousSnapshot, $nextSnapshot, 'attachments', 'attachment.add', 'attachment.remove', 'attachments.set', 'attachment', 'attachments');
        if ($arrowOperations === null || $attachmentOperations === null) {
            return null;
        }

        return [
            ...$operations,
            ...$arrowOperations,
            ...$attachmentOperations,
            ...$this->zoneCountOperations($previousSnapshot, $nextSnapshot),
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function sharedCollectionChanged(
        array $previousSnapshot,
        array $nextSnapshot,
        string $snapshotKey,
        string $addOp,
        string $removeOp,
        string $setOp,
        string $addValueKey,
        string $setValueKey,
    ): ?array {
        $operations = $this->collectionDiffOperations($previousSnapshot, $nextSnapshot, $snapshotKey, $addOp, $removeOp, $setOp, $addValueKey, $setValueKey);
        if ($operations === null) {
            return null;
        }

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function collectionDiffOperations(
        array $previousSnapshot,
        array $nextSnapshot,
        string $snapshotKey,
        string $addOp,
        string $removeOp,
        string $setOp,
        string $addValueKey,
        string $setValueKey,
    ): ?array {
        $previousItems = $this->indexedSnapshotItems($previousSnapshot, $snapshotKey);
        $nextItems = $this->indexedSnapshotItems($nextSnapshot, $snapshotKey);
        if ($previousItems === null || $nextItems === null) {
            return null;
        }

        $removedIds = array_values(array_diff(array_keys($previousItems), array_keys($nextItems)));
        $addedIds = array_values(array_diff(array_keys($nextItems), array_keys($previousItems)));
        $changedExisting = [];
        foreach (array_intersect(array_keys($previousItems), array_keys($nextItems)) as $id) {
            if ($previousItems[$id] !== $nextItems[$id]) {
                $changedExisting[] = $id;
            }
        }

        if ($removedIds === [] && $addedIds === [] && $changedExisting === []) {
            return [];
        }

        if ($changedExisting !== []) {
            return count($nextItems) <= self::MAX_SHARED_COLLECTION_ITEMS
                ? [[
                    'op' => $setOp,
                    $setValueKey => array_values($nextItems),
                ]]
                : null;
        }

        if (count($removedIds) + count($addedIds) > self::MAX_SHARED_COLLECTION_ITEMS) {
            return null;
        }

        $operations = [];
        foreach ($removedIds as $id) {
            $operations[] = [
                'op' => $removeOp,
                'id' => $id,
            ];
        }
        foreach ($addedIds as $id) {
            $operations[] = [
                'op' => $addOp,
                $addValueKey => $nextItems[$id],
            ];
        }

        return $operations;
    }

    /**
     * @return array<string,array<string,mixed>>|null
     */
    private function indexedSnapshotItems(array $snapshot, string $key): ?array
    {
        $items = $snapshot[$key] ?? [];
        if (!is_array($items)) {
            return null;
        }

        $indexed = [];
        foreach ($items as $item) {
            if (!is_array($item) || !is_string($item['id'] ?? null) || trim($item['id']) === '') {
                return null;
            }

            $indexed[$item['id']] = $item;
        }

        return $indexed;
    }

    /**
     * @param array<string,mixed> $eventData
     *
     * @return list<array<string,mixed>>|null
     */
    private function gameConcede(array $previousSnapshot, array $nextSnapshot, array $eventData): ?array
    {
        $playerId = $eventData['createdBy'] ?? null;
        if (!is_string($playerId) || !is_array($nextSnapshot['players'][$playerId] ?? null)) {
            return null;
        }

        return [
            [
                'op' => 'player.status.set',
                'playerId' => $playerId,
                'status' => (string) ($nextSnapshot['players'][$playerId]['status'] ?? 'active'),
                'concededAt' => $nextSnapshot['players'][$playerId]['concededAt'] ?? null,
            ],
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function disconnectVoteUpdated(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $operations = [[
            'op' => 'disconnect.vote.set',
            'disconnectVote' => is_array($nextSnapshot['disconnectVote'] ?? null) ? $nextSnapshot['disconnectVote'] : null,
        ]];
        $targetPlayerId = is_string($nextSnapshot['disconnectVote']['targetPlayerId'] ?? null)
            ? $nextSnapshot['disconnectVote']['targetPlayerId']
            : null;
        if ($targetPlayerId !== null) {
            $previousPlayer = $previousSnapshot['players'][$targetPlayerId] ?? null;
            $nextPlayer = $nextSnapshot['players'][$targetPlayerId] ?? null;
            if (is_array($previousPlayer) && is_array($nextPlayer)) {
                $previousStatus = (string) ($previousPlayer['status'] ?? 'active');
                $nextStatus = (string) ($nextPlayer['status'] ?? 'active');
                $previousConcededAt = $previousPlayer['concededAt'] ?? null;
                $nextConcededAt = $nextPlayer['concededAt'] ?? null;
                if ($previousStatus !== $nextStatus || $previousConcededAt !== $nextConcededAt) {
                    $operations[] = [
                        'op' => 'player.status.set',
                        'playerId' => $targetPlayerId,
                        'status' => $nextStatus,
                        'concededAt' => $nextConcededAt,
                    ];
                }
            }
        }

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function appendedEntries(array $previousSnapshot, array $nextSnapshot, string $key): ?array
    {
        $previous = $previousSnapshot[$key] ?? [];
        $next = $nextSnapshot[$key] ?? [];
        if (!is_array($previous) || !is_array($next) || count($next) < count($previous)) {
            return null;
        }

        return array_values(array_slice($next, count($previous)));
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function eventLogAppendOperation(array $previousSnapshot, array $nextSnapshot, bool $sanitizePrivateCard = false): array
    {
        $eventLogEntries = $this->appendedEntries($previousSnapshot, $nextSnapshot, 'eventLog');
        if ($sanitizePrivateCard && is_array($eventLogEntries)) {
            $eventLogEntries = array_map(
                fn (array $entry): array => $this->sanitizedPrivateCardLogEntry($entry),
                $eventLogEntries,
            );
        }

        return $eventLogEntries === null || $eventLogEntries === []
            ? []
            : [['op' => 'eventLog.append', 'entries' => $eventLogEntries]];
    }

    private function payloadString(array $payload, string $key): ?string
    {
        $value = $payload[$key] ?? null;

        return is_string($value) && trim($value) !== '' ? $value : null;
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array{playerId:string,zone:string,instanceId:string}|null
     */
    private function payloadCardLocation(array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $zone = $this->payloadString($payload, 'zone');
        $instanceId = $this->payloadString($payload, 'instanceId');
        if ($playerId === null || $zone === null || $instanceId === null) {
            return null;
        }

        return ['playerId' => $playerId, 'zone' => $zone, 'instanceId' => $instanceId];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function projectedCardRefreshOperations(array $nextSnapshot, string $playerId, string $zone, string $instanceId): ?array
    {
        if ($this->isHiddenZone($zone)) {
            return $this->visibleZoneOperations($nextSnapshot, $playerId, $zone);
        }

        $card = $this->card($nextSnapshot, $playerId, $zone, $instanceId);
        if ($card === null) {
            return null;
        }

        return [[
            'op' => 'card.projection.set',
            'playerId' => $playerId,
            'zone' => $zone,
            'instanceId' => $instanceId,
            'card' => $card,
        ]];
    }

    /**
     * @param array{playerId:string,zone:string,instanceId:string} $location
     *
     * @return array<string,mixed>|null
     */
    private function cardStatsSetOperation(?array $previousCard, array $nextCard, array $location, bool $onlyChanged = true): ?array
    {
        $operation = [
            'op' => 'card.stats.set',
            'playerId' => $location['playerId'],
            'zone' => $location['zone'],
            'instanceId' => $location['instanceId'],
        ];
        foreach (['power', 'toughness', 'loyalty'] as $stat) {
            if (!$onlyChanged || ($previousCard[$stat] ?? null) !== ($nextCard[$stat] ?? null)) {
                $operation[$stat] = $nextCard[$stat] ?? null;
            }
        }

        return count($operation) > 4 ? $operation : null;
    }

    /**
     * @param array{playerId:string,zone:string,instanceId:string} $location
     */
    private function operationTouchesSensitiveProjection(array $nextSnapshot, array $location): bool
    {
        if ($this->isHiddenZone($location['zone'])) {
            return true;
        }

        $card = $this->card($nextSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);

        return $card === null || $this->isSensitiveProjectedCard($card);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isSensitiveProjectedCard(array $card): bool
    {
        $name = (string) ($card['name'] ?? '');

        return ($card['hidden'] ?? false) === true
            || ($card['faceDown'] ?? false) === true && in_array($name, ['Face-down card', 'Hidden card'], true);
    }

    /**
     * @return list<array{playerId:string,index:int,card:array<string,mixed>}>
     */
    private function createdBattlefieldCards(array $previousSnapshot, array $nextSnapshot): array
    {
        $knownIds = $this->allCardInstanceIds($previousSnapshot);
        $created = [];
        foreach (($nextSnapshot['players'] ?? []) as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player) || !is_array($player['zones']['battlefield'] ?? null)) {
                continue;
            }

            foreach (array_values($player['zones']['battlefield']) as $index => $card) {
                if (!is_array($card)) {
                    continue;
                }

                $instanceId = $this->cardInstanceId($card);
                if ($instanceId !== null && !isset($knownIds[$instanceId])) {
                    $created[] = ['playerId' => $playerId, 'index' => $index, 'card' => $card];
                }
            }
        }

        return $created;
    }

    /**
     * @return array<string,true>
     */
    private function allCardInstanceIds(array $snapshot): array
    {
        $ids = [];
        foreach (($snapshot['players'] ?? []) as $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            foreach ($player['zones'] as $cards) {
                if (!is_array($cards)) {
                    continue;
                }

                foreach ($cards as $card) {
                    if (is_array($card)) {
                        $instanceId = $this->cardInstanceId($card);
                        if ($instanceId !== null) {
                            $ids[$instanceId] = true;
                        }
                    }
                }
            }
        }

        return $ids;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function topProjectedCards(array $snapshot, string $playerId, int $count): array
    {
        return array_slice($this->zoneCards($snapshot, $playerId, 'library'), 0, max(0, $count));
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function zoneCards(array $snapshot, string $playerId, string $zone): array
    {
        $cards = $snapshot['players'][$playerId]['zones'][$zone] ?? [];
        if (!is_array($cards)) {
            return [];
        }

        return array_values(array_filter($cards, static fn (mixed $card): bool => is_array($card)));
    }

    private function cardInstanceId(array $card): ?string
    {
        $instanceId = $card['instanceId'] ?? null;

        return is_string($instanceId) && trim($instanceId) !== '' ? $instanceId : null;
    }

    /**
     * @return list<string>
     */
    private function libraryTopMoveInstanceIds(array $previousSnapshot, array $nextSnapshot, string $playerId, string $targetPlayerId, string $toZone, int $count): array
    {
        $instanceIds = [];
        foreach ($this->topProjectedCards($previousSnapshot, $playerId, min($count, self::MAX_MOVE_OPERATIONS)) as $card) {
            $instanceId = $this->cardInstanceId($card);
            if ($instanceId !== null) {
                $instanceIds[] = $instanceId;
            }
        }

        $previousTargetIds = array_flip(array_filter(array_map(
            fn (array $card): ?string => $this->cardInstanceId($card),
            $this->zoneCards($previousSnapshot, $targetPlayerId, $toZone),
        )));
        foreach ($this->zoneCards($nextSnapshot, $targetPlayerId, $toZone) as $card) {
            $instanceId = $this->cardInstanceId($card);
            if (
                (($card['hidden'] ?? false) === true && $this->isHiddenZone($toZone))
                || $instanceId === null
                || isset($previousTargetIds[$instanceId])
                || in_array($instanceId, $instanceIds, true)
            ) {
                continue;
            }

            $instanceIds[] = $instanceId;
            if (count($instanceIds) >= $count) {
                break;
            }
        }

        return array_slice($instanceIds, 0, min($count, self::MAX_MOVE_OPERATIONS));
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function visibleZoneOperations(array $nextSnapshot, string $playerId, string $zone, ?int $limit = null): ?array
    {
        $cards = $this->zoneCards($nextSnapshot, $playerId, $zone);
        if ($limit !== null) {
            $cards = array_slice($cards, 0, min($limit, self::MAX_VISIBLE_ZONE_CARDS));
        }

        if (count($cards) > self::MAX_VISIBLE_ZONE_CARDS) {
            return null;
        }

        return [[
            'op' => 'zone.visible.set',
            'playerId' => $playerId,
            'zone' => $zone,
            'cards' => $cards,
        ]];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function libraryVisibilityOperations(array $previousSnapshot, array $nextSnapshot, string $playerId): array
    {
        $previousPlayer = $previousSnapshot['players'][$playerId] ?? [];
        $nextPlayer = $nextSnapshot['players'][$playerId] ?? [];
        if (!is_array($previousPlayer)) {
            $previousPlayer = [];
        }
        if (!is_array($nextPlayer)) {
            return [];
        }

        $changed = [];
        if (($previousPlayer['playTopLibraryRevealed'] ?? false) !== ($nextPlayer['playTopLibraryRevealed'] ?? false)) {
            $changed['playTopLibraryRevealed'] = (bool) ($nextPlayer['playTopLibraryRevealed'] ?? false);
        }
        if (($previousPlayer['revealedLibraryTo'] ?? []) !== ($nextPlayer['revealedLibraryTo'] ?? [])) {
            $changed['revealedLibraryTo'] = is_array($nextPlayer['revealedLibraryTo'] ?? null)
                ? array_values($nextPlayer['revealedLibraryTo'])
                : [];
        }

        return $changed === []
            ? []
            : [[
                'op' => 'player.library.visibility.set',
                'playerId' => $playerId,
                ...$changed,
            ]];
    }

    private function shouldSanitizeHiddenZonePayload(array $payload, ?string $viewerId): bool
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $zone = $this->payloadString($payload, 'zone');

        return $playerId !== null
            && $viewerId !== null
            && $viewerId !== $playerId
            && $zone !== null
            && $this->isHiddenZone($zone);
    }

    /**
     * @param array<string,mixed> $entry
     *
     * @return array<string,mixed>
     */
    private function sanitizedPrivateCardLogEntry(array $entry): array
    {
        unset($entry['cardNames'], $entry['cardInstanceId'], $entry['cardPlayerId'], $entry['cardZone']);
        $entry['message'] = 'Updated a hidden card.';

        return $entry;
    }

    /**
     * @param array<string,mixed>|null $eventPayload
     *
     * @return array<string,mixed>|null
     */
    private function sanitizedEventPayload(GameEvent $event, ?array $eventPayload, ?string $viewerId): ?array
    {
        $eventData = $event->toArray();
        $payload = $eventPayload ?? (is_array($eventData['payload'] ?? null) ? $eventData['payload'] : null);
        if ($payload === null) {
            return $eventPayload;
        }

        $type = (string) ($eventData['type'] ?? '');
        if (
            $type === 'zone.random_card.selected'
            || $type === 'library.reorder_top'
            || $type === 'zone.changed'
            || $type === 'card.face_down.changed'
            || $type === 'card.face.changed'
            || $type === 'card.revealed'
            || $type === 'card.counter.changed'
            || $type === 'card.power_toughness.changed'
            || $type === 'card.token_copy.created'
        ) {
            $playerId = $this->payloadString($payload, 'playerId');
            $zone = $this->payloadString($payload, 'zone');
            if ($playerId !== null && $viewerId !== null && $viewerId !== $playerId && ($zone === null || $this->isHiddenZone($zone))) {
                return array_filter([
                    'playerId' => $playerId,
                    'zone' => $zone,
                    'count' => isset($payload['instanceIds']) && is_array($payload['instanceIds']) ? count($payload['instanceIds']) : null,
                ], static fn (mixed $value): bool => $value !== null);
            }
        }

        return $payload;
    }

    /**
     * @return array<string,mixed>|null
     */
    private function card(array $snapshot, string $playerId, string $zone, string $instanceId): ?array
    {
        $cards = $snapshot['players'][$playerId]['zones'][$zone] ?? null;
        if (!is_array($cards)) {
            return null;
        }

        foreach ($cards as $card) {
            if (is_array($card) && ($card['instanceId'] ?? null) === $instanceId) {
                return $card;
            }
        }

        return null;
    }

    private function cardIndex(array $snapshot, string $playerId, string $zone, string $instanceId): ?int
    {
        $cards = $snapshot['players'][$playerId]['zones'][$zone] ?? null;
        if (!is_array($cards)) {
            return null;
        }

        foreach (array_values($cards) as $index => $card) {
            if (is_array($card) && ($card['instanceId'] ?? null) === $instanceId) {
                return $index;
            }
        }

        return null;
    }

    private function nextCardPlayerId(array $snapshot, string $instanceId): ?string
    {
        foreach (($snapshot['players'] ?? []) as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            foreach ($player['zones'] as $cards) {
                if (!is_array($cards)) {
                    continue;
                }

                foreach ($cards as $card) {
                    if (is_array($card) && ($card['instanceId'] ?? null) === $instanceId) {
                        return $playerId;
                    }
                }
            }
        }

        return null;
    }

    private function shouldIncludeMovedCard(array $previousCard, array $nextCard): bool
    {
        $sensitiveKeys = ['ownerId', 'controllerId', 'hidden', 'faceDown', 'revealedTo', 'name', 'imageUris', 'oracleText', 'position'];
        foreach ($sensitiveKeys as $key) {
            if (($previousCard[$key] ?? null) !== ($nextCard[$key] ?? null)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string,mixed>
     */
    private function hiddenDestinationCard(array $snapshot, string $playerId, string $zone): array
    {
        $cards = $snapshot['players'][$playerId]['zones'][$zone] ?? [];
        if (is_array($cards)) {
            foreach (array_reverse($cards) as $card) {
                if (is_array($card) && ($card['hidden'] ?? false) === true) {
                    return $card;
                }
            }
        }

        return [
            'instanceId' => $zone === 'library' ? sprintf('%s-hidden-library-top', $playerId) : sprintf('%s-hidden-hand-new', $playerId),
            'ownerId' => $playerId,
            'controllerId' => $playerId,
            'name' => 'Hidden card',
            'hidden' => true,
            'tapped' => false,
            'faceDown' => true,
            'zone' => $zone,
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function zoneCountOperations(array $previousSnapshot, array $nextSnapshot): array
    {
        $operations = [];
        foreach (($nextSnapshot['players'] ?? []) as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player)) {
                continue;
            }

            $previousCounts = $previousSnapshot['players'][$playerId]['zoneCounts'] ?? [];
            $nextCounts = $player['zoneCounts'] ?? [];
            if (!is_array($previousCounts) || !is_array($nextCounts)) {
                continue;
            }

            $changed = [];
            foreach ($nextCounts as $zone => $count) {
                if (!is_string($zone) || (int) ($previousCounts[$zone] ?? -1) === (int) $count) {
                    continue;
                }

                $changed[$zone] = (int) $count;
            }

            if ($changed !== []) {
                $operations[] = [
                    'op' => 'zone.counts.set',
                    'playerId' => $playerId,
                    'counts' => $changed,
                ];
            }
        }

        return $operations;
    }

    private function isHiddenZone(string $zone): bool
    {
        return in_array($zone, self::HIDDEN_ZONES, true);
    }

    /**
     * @param mixed $value
     *
     * @return array<string,int>
     */
    private function stringIntMap(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $result = [];
        foreach ($value as $key => $entry) {
            if (is_string($key)) {
                $result[$key] = (int) $entry;
            }
        }

        return $result;
    }

    private function snapshotVersion(array $snapshot): int
    {
        return max(1, (int) ($snapshot['version'] ?? 1));
    }
}
