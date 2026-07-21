<?php

namespace App\Application\Game\WebSocket;

use App\Application\Game\GameLogPrivacySanitizer;

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
            'life.changed' => $this->lifeChanged($previousSnapshot, $nextSnapshot, $payload),
            'commander.damage.changed' => $this->commanderDamageChanged($previousSnapshot, $nextSnapshot, $payload),
            'counter.changed' => $this->counterChanged($previousSnapshot, $nextSnapshot, $payload),
            'chat.message' => $this->chatMessage($previousSnapshot, $nextSnapshot, $payload),
            'chat.reaction.toggled' => $this->chatReactionToggled($previousSnapshot, $nextSnapshot, $payload),
            'dice.rolled' => $this->eventLogOnly($previousSnapshot, $nextSnapshot),
            'turn.changed' => $this->turnChanged($previousSnapshot, $nextSnapshot),
            'card.position.changed' => $this->cardPositionChanged($nextSnapshot, $payload),
            'card.dungeon_marker.changed' => $this->cardDungeonMarkerChanged($nextSnapshot, $payload),
            'cards.position.changed' => $this->cardsPositionChanged($nextSnapshot, $payload),
            'card.tapped' => $this->cardTapped($previousSnapshot, $nextSnapshot, $payload),
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
            'hand.cards.reveal' => $this->handCardsVisibility($previousSnapshot, $nextSnapshot, $payload, true),
            'hand.cards.revoke' => $this->handCardsVisibility($previousSnapshot, $nextSnapshot, $payload, false),
            'card.face_down.changed' => $this->cardProjectionChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.face.changed' => $this->cardProjectionChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.revealed' => $this->cardProjectionChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.counter.changed' => $this->cardCounterChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.power_toughness.changed' => $this->cardStatsChanged($previousSnapshot, $nextSnapshot, $payload),
            'card.stats.override.set' => $this->cardStatsOverrideChanged($previousSnapshot, $nextSnapshot, $payload, false),
            'card.stats.override.cleared', 'card.stats.override.clear' => $this->cardStatsOverrideChanged($previousSnapshot, $nextSnapshot, $payload, true),
            'card.controller.changed' => $this->cardControllerChanged($previousSnapshot, $nextSnapshot, $payload),
            'battlefield.untap_all' => $this->battlefieldUntapAll($previousSnapshot, $nextSnapshot, $payload),
            'card.token.created' => $this->tokenCreated($previousSnapshot, $nextSnapshot),
            'token.group.split',
            'token.group.merged',
            'token.group.members.removed',
            'token.group.dissolved',
            'token.group.state.changed',
            'token.group.position.changed',
            'token.group.moved' => $this->tokenGroupMutation($previousSnapshot, $nextSnapshot),
            'card.token_copy.created' => $this->tokenCreated($previousSnapshot, $nextSnapshot),
            'stack.card_added' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'stack', 'stack.item.add', 'stack.item.remove', 'stack.set', 'item', 'stack'),
            'stack.item_removed' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'stack', 'stack.item.add', 'stack.item.remove', 'stack.set', 'item', 'stack'),
            'arrow.created' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'arrows', 'arrow.add', 'arrow.remove', 'arrows.set', 'arrow', 'arrows'),
            'arrow.removed' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'arrows', 'arrow.add', 'arrow.remove', 'arrows.set', 'arrow', 'arrows'),
            'attachment.created' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'attachments', 'attachment.set', 'attachment.remove', 'attachments.set', 'attachment', 'attachments'),
            'attachment.removed' => $this->attachmentRemoved($previousSnapshot, $nextSnapshot, $payload),
            'attachment.reordered' => $this->attachmentOrderChanged($previousSnapshot, $nextSnapshot, $payload),
            'battlefield.stack.created',
            'battlefield.stack.member_added' => $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'battlefieldStacks', 'battlefield.stack.set', 'battlefield.stack.remove', 'battlefield.stacks.set', 'stack', 'stacks'),
            'battlefield.stack.member_removed' => $this->battlefieldStackMemberRemoved($previousSnapshot, $nextSnapshot, $payload),
            'battlefield.stack.reordered' => $this->battlefieldStackOrderChanged($previousSnapshot, $nextSnapshot, $payload),
            'battlefield.stack.dissolved' => $this->battlefieldStackDissolved($previousSnapshot, $nextSnapshot, $payload),
            'helper.created' => $this->helperChanged($previousSnapshot, $nextSnapshot),
            'helper.updated' => $this->helperChanged($previousSnapshot, $nextSnapshot),
            'helper.removed' => $this->helperChanged($previousSnapshot, $nextSnapshot),
            'rematch.vote' => $this->rematchVote($previousSnapshot, $nextSnapshot),
            'game.concede' => $this->gameConcede($previousSnapshot, $nextSnapshot, $eventData),
			'game.close' => $this->gameClose($previousSnapshot, $nextSnapshot),
            'disconnect.vote.updated' => $this->disconnectVoteUpdated($previousSnapshot, $nextSnapshot),
			'player.presence.changed',
			'disconnect.vote.opened',
			'disconnect.vote.cast',
			'disconnect.vote.resolved',
			'disconnect.vote.cancelled',
			'disconnect.vote.expired' => $this->disconnectVoteUpdated($previousSnapshot, $nextSnapshot),
            default => null,
        };
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function lifeChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null || !isset($nextSnapshot['players'][$playerId]['life'])) {
            return null;
        }

        return [
            [
                'op' => 'player.life.set',
                'playerId' => $playerId,
                'value' => (int) $nextSnapshot['players'][$playerId]['life'],
            ],
            ...$this->playerLifecycleDiffOperations($previousSnapshot, $nextSnapshot, $playerId),
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function commanderDamageChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $targetPlayerId = $this->payloadString($payload, 'targetPlayerId');
        if ($targetPlayerId === null || !isset($nextSnapshot['players'][$targetPlayerId]['commanderDamage'])) {
            return null;
        }

        $operations = [
            [
                'op' => 'player.commanderDamage.set',
                'playerId' => $targetPlayerId,
                'commanderDamage' => $this->stringIntMap($nextSnapshot['players'][$targetPlayerId]['commanderDamage']),
            ],
        ];
        $previousLife = $previousSnapshot['players'][$targetPlayerId]['life'] ?? null;
        $nextLife = $nextSnapshot['players'][$targetPlayerId]['life'] ?? null;
        if ((int) ($payload['effectVersion'] ?? 0) >= 2 || $previousLife !== $nextLife) {
            $operations[] = [
                'op' => 'player.life.set',
                'playerId' => $targetPlayerId,
                'value' => (int) $nextLife,
            ];
        }

        return [
            ...$operations,
            ...$this->playerLifecycleDiffOperations($previousSnapshot, $nextSnapshot, $targetPlayerId),
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function playerLifecycleDiffOperations(array $previousSnapshot, array $nextSnapshot, string $playerId): array
    {
        $operations = [];
        $previousPlayer = is_array($previousSnapshot['players'][$playerId] ?? null) ? $previousSnapshot['players'][$playerId] : [];
        $nextPlayer = is_array($nextSnapshot['players'][$playerId] ?? null) ? $nextSnapshot['players'][$playerId] : [];
        $previousStatus = (string) ($previousPlayer['status'] ?? 'active');
        $nextStatus = (string) ($nextPlayer['status'] ?? 'active');
        if ($previousStatus !== $nextStatus) {
            $statusOperation = [
                'op' => 'player.status.set',
                'playerId' => $playerId,
                'status' => $nextStatus,
            ];
            if (array_key_exists('concededAt', $nextPlayer)) {
                $statusOperation['concededAt'] = $nextPlayer['concededAt'];
            }
            $operations[] = $statusOperation;
			$operations[] = [
				'op' => 'player.elimination.set',
				'playerId' => $playerId,
				'eliminationReason' => $nextPlayer['eliminationReason'] ?? null,
				'eliminatedAtVersion' => $nextPlayer['eliminatedAtVersion'] ?? null,
				'sourcePlayerId' => $nextPlayer['sourcePlayerId'] ?? null,
				'commanderInstanceId' => $nextPlayer['commanderInstanceId'] ?? null,
			];
        }

        $previousTurn = $previousSnapshot['turn'] ?? null;
        $nextTurn = $nextSnapshot['turn'] ?? null;
        if (is_array($nextTurn) && $previousTurn !== $nextTurn) {
            $operations[] = [
                'op' => 'turn.set',
                'turn' => $nextTurn,
            ];
        }
		$previousTurnOrder = is_array($previousSnapshot['turnOrder'] ?? null)
			? array_values($previousSnapshot['turnOrder'])
			: array_values(array_keys(is_array($previousSnapshot['players'] ?? null) ? $previousSnapshot['players'] : []));
		$nextTurnOrder = is_array($nextSnapshot['turnOrder'] ?? null)
			? array_values($nextSnapshot['turnOrder'])
			: array_values(array_keys(is_array($nextSnapshot['players'] ?? null) ? $nextSnapshot['players'] : []));
		if ($previousTurnOrder !== $nextTurnOrder) {
			$operations[] = ['op' => 'turn.order.set', 'turnOrder' => $nextTurnOrder];
		}
		if (($previousSnapshot['winnerPlayerId'] ?? null) !== ($nextSnapshot['winnerPlayerId'] ?? null)
			|| ($previousSnapshot['resultState'] ?? null) !== ($nextSnapshot['resultState'] ?? null)
			|| ($previousSnapshot['finishedReason'] ?? null) !== ($nextSnapshot['finishedReason'] ?? null)) {
			$operations[] = [
				'op' => 'game.result.set',
				'winnerPlayerId' => $nextSnapshot['winnerPlayerId'] ?? null,
				'resultState' => $nextSnapshot['resultState'] ?? null,
				'finishedReason' => $nextSnapshot['finishedReason'] ?? null,
			];
		}
		$special = $this->specialEntityDiffOperations($previousSnapshot, $nextSnapshot);
		if (is_array($special)) { $operations = [...$operations, ...$special]; }

        return $operations;
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function counterChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
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

            return [
                [
                    'op' => 'player.counters.set',
                    'playerId' => $playerId,
                    'counters' => $this->stringIntMap($nextSnapshot['players'][$playerId]['counters']),
                ],
                ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
            ];
        }

        $countersByScope = $nextSnapshot['counters'] ?? [];
        if (!is_array($countersByScope)) {
            return null;
        }
        $scopeCounters = $countersByScope[$scope] ?? [];
        if (!is_array($scopeCounters)) {
            $scopeCounters = [];
        }

        return [
            [
                'op' => 'game.counters.set',
                'scope' => $scope,
                'counters' => $this->stringIntMap($scopeCounters),
            ],
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
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
        $eventLogEntries = $this->appendedEventLogEntries($previousSnapshot, $nextSnapshot);
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
    private function chatReactionToggled(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $messageId = $this->payloadString($payload, 'messageId');
        if ($messageId === null) {
            return null;
        }

        $previousMessage = $this->chatMessageById($previousSnapshot, $messageId);
        $nextMessage = $this->chatMessageById($nextSnapshot, $messageId);
        if ($nextMessage === null) {
            return $previousMessage === null ? [] : null;
        }

        return $previousMessage === $nextMessage
            ? []
            : [[
                'op' => 'chat.message.set',
                'message' => $nextMessage,
            ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function eventLogOnly(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $eventLogEntries = $this->appendedEventLogEntries($previousSnapshot, $nextSnapshot);
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
        $eventLogEntries = $this->appendedEventLogEntries($previousSnapshot, $nextSnapshot);
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
            'effectVersion' => 1,
            'playerId' => $playerId,
            'zone' => $zone,
            'instanceId' => $instanceId,
            'position' => $card['position'],
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardDungeonMarkerChanged(array $nextSnapshot, array $payload): ?array
    {
        $playerId = $this->payloadString($payload, 'playerId');
        $zone = $this->payloadString($payload, 'zone');
        $instanceId = $this->payloadString($payload, 'instanceId');
        if ($playerId === null || $zone === null || $instanceId === null) {
            return null;
        }

        $card = $this->card($nextSnapshot, $playerId, $zone, $instanceId);
        if ($card === null || !is_array($card['dungeonMarker'] ?? null)) {
            return null;
        }

        return [[
            'op' => 'card.state.set',
            'playerId' => $playerId,
            'zone' => $zone,
            'instanceId' => $instanceId,
            'dungeonMarker' => $card['dungeonMarker'],
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
            'effectVersion' => 1,
            'playerId' => $playerId,
            'zone' => $zone,
            'positions' => $positions,
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function cardTapped(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
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

        return [
            [
                'op' => 'card.state.set',
                'playerId' => $playerId,
                'zone' => $zone,
                'instanceId' => $instanceId,
                'tapped' => (bool) ($card['tapped'] ?? false),
            ],
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
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
     * Build the viewer-local patch for an atomic hand reveal/revoke batch.
     *
     * The owner and viewers retaining access already have a materialized
     * projection, while a newly-authorized viewer receives one materialize
     * operation per batch and a revoked viewer receives one conceal operation.
     * We deliberately derive this from the projected before/after snapshots:
     * the real instance id therefore only appears for a viewer that already
     * had (or is now receiving) authorization.
     *
     * @return list<array<string,mixed>>|null
     */
    private function handCardsVisibility(
        array $previousSnapshot,
        array $nextSnapshot,
        array $payload,
        bool $reveal,
    ): ?array {
        $playerId = $this->payloadString($payload, 'playerId');
        if ($playerId === null) {
            return null;
        }

        $requestedIds = $payload['orderedInstanceIds'] ?? [];
        if (!is_array($requestedIds) || $requestedIds === []) {
            // Runtime event payloads always include orderedInstanceIds. The
            // defensive fallback keeps legacy replay payloads deterministic.
            $requestedIds = $payload['instanceIds'] ?? [];
        }
        $instanceIds = [];
        foreach ($requestedIds as $instanceId) {
            if (!is_string($instanceId) || trim($instanceId) === '' || in_array($instanceId, $instanceIds, true)) {
                return null;
            }
            $instanceIds[] = trim($instanceId);
        }
        if ($instanceIds === []) {
            return null;
        }

        $materialize = [];
        $conceal = [];
        $fieldUpdates = [];
        foreach ($instanceIds as $instanceId) {
            $previousCard = $this->card($previousSnapshot, $playerId, 'hand', $instanceId);
            $nextCard = $this->card($nextSnapshot, $playerId, 'hand', $instanceId);
            $previousIndex = $this->cardIndex($previousSnapshot, $playerId, 'hand', $instanceId);
            $nextIndex = $this->cardIndex($nextSnapshot, $playerId, 'hand', $instanceId);

            if ($reveal) {
                // A newly authorized viewer has no real card in the previous
                // projection. The next projection contains the full card and
                // its stable hand slot; replace that slot atomically.
                if ($nextCard !== null && $previousCard === null && $nextIndex !== null) {
                    $placeholder = $this->cardAtIndex($previousSnapshot, $playerId, 'hand', $nextIndex);
                    if ($placeholder === null) {
                        return null;
                    }
                    $materialize[] = [
                        'placeholderId' => $this->cardInstanceId($placeholder) ?? '',
                        'index' => $nextIndex,
                        'card' => $nextCard,
                    ];
                    continue;
                }
            } else {
                // A revoked viewer loses the real card and receives the
                // deterministic opaque placeholder for the same hand slot.
                if ($previousCard !== null && $nextCard === null && $previousIndex !== null) {
                    $placeholder = $this->cardAtIndex($nextSnapshot, $playerId, 'hand', $previousIndex);
                    if ($placeholder === null) {
                        return null;
                    }
                    $conceal[] = [
                        'instanceId' => $this->cardInstanceId($previousCard) ?? $instanceId,
                        'placeholderId' => $this->cardInstanceId($placeholder) ?? '',
                        'index' => $previousIndex,
                    ];
                    continue;
                }
            }

            // Existing authorized viewers (including the owner) retain the
            // card identity but may need the final audience metadata updated.
            if ($previousCard !== null && $nextCard !== null
                && ($previousCard['revealedTo'] ?? []) !== ($nextCard['revealedTo'] ?? [])) {
                $fieldUpdates[] = [
                    'op' => 'card.field.set',
                    'playerId' => $playerId,
                    'zone' => 'hand',
                    'instanceId' => $instanceId,
                    'revealedTo' => is_array($nextCard['revealedTo'] ?? null)
                        ? array_values($nextCard['revealedTo'])
                        : [],
                ];
            }
        }

        $operations = [];
        if ($materialize !== []) {
            $operations[] = [
                'op' => 'private.cards.materialize',
                'playerId' => $playerId,
                'zone' => 'hand',
                'entries' => $materialize,
            ];
        }
        if ($conceal !== []) {
            $operations[] = [
                'op' => 'private.cards.conceal',
                'playerId' => $playerId,
                'zone' => 'hand',
                'entries' => $conceal,
            ];
        }

        return [
            ...$operations,
            ...$fieldUpdates,
            // Hand reveal identity is private even for the owner-facing
            // public log envelope. Redact recursively while retaining safe
            // aggregate count/audience metadata and semantic i18n keys.
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, true),
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
            if ($location['zone'] === 'battlefield') {
                $operations = $this->projectedBattlefieldCardReplacementOperations($previousSnapshot, $nextSnapshot, $location);
                if ($operations === null) {
                    return null;
                }
            } else {
                return null;
            }
        }

        return [
            ...$operations,
            ...$this->tokenGroupDiffOperations($previousSnapshot, $nextSnapshot),
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
		$groupOps = $this->tokenGroupDiffOperations($previousSnapshot, $nextSnapshot);
		$groupRemoves = array_values(array_filter($groupOps, static fn (array $op): bool => ($op['op'] ?? null) === 'token.group.remove'));
		$groupSets = array_values(array_filter($groupOps, static fn (array $op): bool => ($op['op'] ?? null) === 'token.group.set'));

        return [
			...$groupRemoves,
            ...$operations,
			...$groupSets,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function tokenCreated(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $created = $this->createdBattlefieldCards($previousSnapshot, $nextSnapshot);
        $removed = $this->removedBattlefieldCards($previousSnapshot, $nextSnapshot);
        if ($created === [] && $removed === []) {
            return null;
        }

        $operations = [];
        $hasSensitiveProjection = false;
        foreach ($removed as $entry) {
            $operations[] = [
                'op' => 'card.remove',
                'playerId' => $entry['playerId'],
                'zone' => 'battlefield',
                'instanceId' => $entry['instanceId'],
            ];
        }
        foreach ($created as $entry) {
            $operations[] = [
                'op' => 'card.create',
                'playerId' => $entry['playerId'],
                'zone' => 'battlefield',
                'index' => $entry['index'],
                'card' => $entry['card'],
            ];
            $hasSensitiveProjection = $hasSensitiveProjection || $this->isSensitiveProjectedCard($entry['card']);
        }

        return [
            ...$operations,
            ...$this->tokenGroupDiffOperations($previousSnapshot, $nextSnapshot),
            ...$this->zoneCountOperations($previousSnapshot, $nextSnapshot),
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, $hasSensitiveProjection),
        ];
    }

    /** @return list<array<string,mixed>> */
    private function tokenGroupDiffOperations(array $previousSnapshot, array $nextSnapshot): array
    {
        $previous = $this->tokenGroupsById($previousSnapshot);
        $next = $this->tokenGroupsById($nextSnapshot);
        $operations = [];
        foreach ($previous as $groupId => $group) {
			if (!isset($next[$groupId]) || $next[$groupId] !== $group) {
                $operations[] = [
                    'op' => 'token.group.remove',
                    'groupId' => $groupId,
					'revision' => is_int($next[$groupId]['revision'] ?? null)
						? $next[$groupId]['revision']
						: (is_int($group['revision'] ?? null) ? $group['revision'] : 1),
                    'reason' => 'projection_changed',
                ];
            }
        }
        foreach ($next as $groupId => $group) {
            if (!isset($previous[$groupId]) || $previous[$groupId] !== $group) {
                $operations[] = ['op' => 'token.group.set', 'group' => $group];
            }
        }

        return $operations;
    }

    /** @return list<array<string,mixed>> */
    private function tokenGroupMutation(array $previousSnapshot, array $nextSnapshot): array
    {
        $groupOps = $this->tokenGroupDiffOperations($previousSnapshot, $nextSnapshot);
        $groupRemoves = array_values(array_filter($groupOps, static fn (array $op): bool => ($op['op'] ?? null) === 'token.group.remove'));
        $groupSets = array_values(array_filter($groupOps, static fn (array $op): bool => ($op['op'] ?? null) === 'token.group.set'));
        $operations = [...$groupRemoves];
        foreach ($this->removedBattlefieldCards($previousSnapshot, $nextSnapshot) as $entry) {
            $operations[] = ['op' => 'card.remove', 'playerId' => $entry['playerId'], 'zone' => 'battlefield', 'instanceId' => $entry['instanceId']];
        }
        foreach ($this->createdBattlefieldCards($previousSnapshot, $nextSnapshot) as $entry) {
            $operations[] = ['op' => 'card.create', 'playerId' => $entry['playerId'], 'zone' => 'battlefield', 'index' => $entry['index'], 'card' => $entry['card']];
        }
        foreach ($nextSnapshot['players'] ?? [] as $playerId => $player) {
            foreach (($player['zones']['battlefield'] ?? []) as $card) {
                if (!is_array($card) || !is_string($card['instanceId'] ?? null)) { continue; }
                $previous = $this->card($previousSnapshot, (string) $playerId, 'battlefield', $card['instanceId']);
                if ($previous === null) { continue; }
                if (($previous['position'] ?? null) !== ($card['position'] ?? null)) {
                    $operations[] = ['op' => 'card.position.set', 'playerId' => (string) $playerId, 'zone' => 'battlefield', 'instanceId' => $card['instanceId'], 'position' => $card['position'] ?? null];
                }
                $state = [];
                foreach (['tapped', 'rotation', 'faceDown'] as $field) { if (($previous[$field] ?? null) !== ($card[$field] ?? null)) { $state[$field] = $card[$field] ?? null; } }
                if ($state !== []) { $operations[] = ['op' => 'card.state.set', 'playerId' => (string) $playerId, 'zone' => 'battlefield', 'instanceId' => $card['instanceId'], ...$state]; }
            }
        }

        return [
            ...$operations,
            ...$groupSets,
            ...$this->zoneCountOperations($previousSnapshot, $nextSnapshot),
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /** @return array<string,array<string,mixed>> */
    private function tokenGroupsById(array $snapshot): array
    {
        $indexed = [];
        foreach (is_array($snapshot['tokenGroups'] ?? null) ? $snapshot['tokenGroups'] : [] as $group) {
            if (!is_array($group) || !is_string($group['groupId'] ?? null) || trim($group['groupId']) === '') {
                continue;
            }
            $indexed[$group['groupId']] = $group;
        }

        return $indexed;
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
        $attachmentOperations = $this->collectionDiffOperations($previousSnapshot, $nextSnapshot, 'attachments', 'attachment.set', 'attachment.remove', 'attachments.set', 'attachment', 'attachments');
        $battlefieldStackOperations = $this->collectionDiffOperations($previousSnapshot, $nextSnapshot, 'battlefieldStacks', 'battlefield.stack.set', 'battlefield.stack.remove', 'battlefield.stacks.set', 'stack', 'stacks');
        if ($arrowOperations === null || $attachmentOperations === null || $battlefieldStackOperations === null) {
            return null;
        }

        return [
            ...$operations,
            ...$arrowOperations,
            ...$attachmentOperations,
            ...$battlefieldStackOperations,
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

    /** @param array<string,mixed> $payload @return list<array<string,mixed>>|null */
    private function attachmentRemoved(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $operations = $this->collectionDiffOperations($previousSnapshot, $nextSnapshot, 'attachments', 'attachment.set', 'attachment.remove', 'attachments.set', 'attachment', 'attachments');
        if ($operations === null) {
            return null;
        }

        $position = $this->relationCardPositionOperation($previousSnapshot, $nextSnapshot, $payload);

        return [
            ...$operations,
            ...($position === null ? [] : [$position]),
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /** @param array<string,mixed> $payload @return list<array<string,mixed>>|null */
    private function battlefieldStackMemberRemoved(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $operations = $this->collectionDiffOperations($previousSnapshot, $nextSnapshot, 'battlefieldStacks', 'battlefield.stack.set', 'battlefield.stack.remove', 'battlefield.stacks.set', 'stack', 'stacks');
        if ($operations === null) {
            return null;
        }

        $position = $this->relationCardPositionOperation($previousSnapshot, $nextSnapshot, $payload);
        if ($position === null) {
            return null;
        }

        return [...$operations, $position, ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot)];
    }

    /** @param array<string,mixed> $payload @return list<array<string,mixed>>|null */
    private function battlefieldStackDissolved(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $operations = $this->collectionDiffOperations($previousSnapshot, $nextSnapshot, 'battlefieldStacks', 'battlefield.stack.set', 'battlefield.stack.remove', 'battlefield.stacks.set', 'stack', 'stacks');
        $positionOperation = $this->relationCardsPositionOperation($previousSnapshot, $nextSnapshot, $payload);
        if ($operations === null || $positionOperation === null) {
            return null;
        }

        return [...$operations, $positionOperation, ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot)];
    }

    /** @param array<string,mixed> $payload @return array<string,mixed>|null */
    private function relationCardPositionOperation(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $instanceId = $this->payloadString($payload, 'instanceId');
        $position = $payload['position'] ?? null;
        if ($instanceId === null || !is_array($position)) {
            return null;
        }
        $playerId = $this->nextCardPlayerId($nextSnapshot, $instanceId) ?? $this->nextCardPlayerId($previousSnapshot, $instanceId);
        if ($playerId === null) {
            return null;
        }

        return [
            'op' => 'card.position.set',
            'effectVersion' => 1,
            'playerId' => $playerId,
            'zone' => 'battlefield',
            'instanceId' => $instanceId,
            'position' => $position,
        ];
    }

    /** @param array<string,mixed> $payload @return array<string,mixed>|null */
    private function relationCardsPositionOperation(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $rawPositions = $payload['positions'] ?? null;
        if (!is_array($rawPositions) || $rawPositions === []) {
            return null;
        }
        $positions = [];
        $playerId = null;
        foreach ($rawPositions as $entry) {
            if (!is_array($entry) || !is_array($entry['position'] ?? null)) {
                return null;
            }
            $instanceId = $this->payloadString($entry, 'instanceId');
            if ($instanceId === null) {
                return null;
            }
            $entryPlayerId = $this->nextCardPlayerId($nextSnapshot, $instanceId) ?? $this->nextCardPlayerId($previousSnapshot, $instanceId);
            if ($entryPlayerId === null || ($playerId !== null && $entryPlayerId !== $playerId)) {
                return null;
            }
            $playerId = $entryPlayerId;
            $positions[] = ['instanceId' => $instanceId, 'position' => $entry['position']];
        }

        return [
            'op' => 'cards.position.set',
            'effectVersion' => 1,
            'playerId' => $playerId,
            'zone' => 'battlefield',
            'positions' => $positions,
        ];
    }

    /** @param array<string,mixed> $payload @return list<array<string,mixed>>|null */
    private function attachmentOrderChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $targetId = is_string($payload['attachedToInstanceId'] ?? null) ? trim($payload['attachedToInstanceId']) : '';
        $orderedIds = array_values(array_filter(
            is_array($payload['orderedAttachmentIds'] ?? null) ? $payload['orderedAttachmentIds'] : [],
            static fn (mixed $id): bool => is_string($id) && trim($id) !== '',
        ));
        if ($targetId === '' || $orderedIds === []) {
            return $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'attachments', 'attachment.set', 'attachment.remove', 'attachments.set', 'attachment', 'attachments');
        }

        return [[
            'op' => 'attachment.order.set',
            'attachedToInstanceId' => $targetId,
            'orderedAttachmentIds' => $orderedIds,
        ], ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot)];
    }

    /** @param array<string,mixed> $payload @return list<array<string,mixed>>|null */
    private function battlefieldStackOrderChanged(array $previousSnapshot, array $nextSnapshot, array $payload): ?array
    {
        $stackId = is_string($payload['stackId'] ?? null) ? trim($payload['stackId']) : '';
        $rootId = is_string($payload['rootInstanceId'] ?? null) ? trim($payload['rootInstanceId']) : '';
        $orderedIds = array_values(array_filter(
            is_array($payload['orderedInstanceIds'] ?? null) ? $payload['orderedInstanceIds'] : [],
            static fn (mixed $id): bool => is_string($id) && trim($id) !== '',
        ));
        if ($stackId === '' || $rootId === '' || $orderedIds === []) {
            return $this->sharedCollectionChanged($previousSnapshot, $nextSnapshot, 'battlefieldStacks', 'battlefield.stack.set', 'battlefield.stack.remove', 'battlefield.stacks.set', 'stack', 'stacks');
        }

        return [[
            'op' => 'battlefield.stack.order.set',
            'stackId' => $stackId,
            'rootInstanceId' => $rootId,
            'orderedInstanceIds' => $orderedIds,
        ], ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot)];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function specialEntitiesChanged(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $operations = $this->specialEntityDiffOperations($previousSnapshot, $nextSnapshot);
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
    private function rematchChanged(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $previousRematch = is_array($previousSnapshot['rematch'] ?? null) ? $previousSnapshot['rematch'] : null;
        $nextRematch = is_array($nextSnapshot['rematch'] ?? null) ? $nextSnapshot['rematch'] : null;
        if ($previousRematch === $nextRematch) {
            return [];
        }

        return [[
            'op' => 'rematch.set',
            'rematch' => $nextRematch,
        ]];
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function rematchVote(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $operations = $this->rematchChanged($previousSnapshot, $nextSnapshot);
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
     * @return list<array<string,mixed>>|null
     */
    private function specialEntityDiffOperations(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $previousItems = $this->indexedSnapshotItems($previousSnapshot, 'specialEntities');
        $nextItems = $this->indexedSnapshotItems($nextSnapshot, 'specialEntities');
        if ($previousItems === null || $nextItems === null) {
            return null;
        }

        $removedIds = array_values(array_diff(array_keys($previousItems), array_keys($nextItems)));
        $addedIds = array_values(array_diff(array_keys($nextItems), array_keys($previousItems)));
        $updatedIds = [];
        foreach (array_intersect(array_keys($previousItems), array_keys($nextItems)) as $id) {
            if ($previousItems[$id] !== $nextItems[$id]) {
                $updatedIds[] = $id;
            }
        }

        if ($removedIds === [] && $addedIds === [] && $updatedIds === []) {
            return [];
        }

        if (count($removedIds) + count($addedIds) + count($updatedIds) > self::MAX_SHARED_COLLECTION_ITEMS) {
            return [[
                'op' => 'specialEntities.set',
                'specialEntities' => array_values($nextItems),
            ]];
        }

        $operations = [];
        foreach ($removedIds as $id) {
            $operations[] = [
                'op' => 'specialEntity.remove',
                'entityId' => $id,
            ];
        }
        foreach ($addedIds as $id) {
            $operations[] = [
                'op' => 'specialEntity.add',
                'entity' => $nextItems[$id],
            ];
        }
        foreach ($updatedIds as $id) {
            $entity = $nextItems[$id];
            $operations[] = [
                'op' => 'specialEntity.update',
                'entityId' => $id,
                'state' => $entity['state'] ?? [],
                'entity' => $entity,
            ];
        }

        return $operations;
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

		$operations = $this->playerLifecycleDiffOperations($previousSnapshot, $nextSnapshot, $playerId);

        return [
            ...$operations,
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /** @return list<array<string,mixed>>|null */
    private function cardStatsOverrideChanged(array $previousSnapshot, array $nextSnapshot, array $payload, bool $cleared): ?array
    {
        $location = $this->payloadCardLocation($payload);
        if ($location === null) {
            return null;
        }
        $nextCard = $this->card($nextSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);
        if ($nextCard === null) {
            return $this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, true);
        }
        if ($this->isSensitiveProjectedCard($nextCard)) {
            $operations = $this->projectedCardRefreshOperations($nextSnapshot, $location['playerId'], $location['zone'], $location['instanceId']);
            if ($operations === null) {
                return null;
            }

            return [...$operations, ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot, true)];
        }
        $faceKey = is_string($payload['faceKey'] ?? null) ? trim($payload['faceKey']) : (string) max(0, (int) ($payload['faceIndex'] ?? 0));
        $override = is_array($nextCard['manualOverrides'][$faceKey] ?? null) ? $nextCard['manualOverrides'][$faceKey] : null;
        $operation = [
            'op' => $cleared ? 'card.stats.override.clear' : 'card.stats.override.set',
            'instanceId' => $location['instanceId'],
            'faceKey' => $faceKey,
            'faceIndex' => max(0, (int) ($payload['faceIndex'] ?? 0)),
            'override' => $override,
            'previousOverride' => is_array($payload['previousOverride'] ?? null) ? $payload['previousOverride'] : null,
        ];

        return [$operation, ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot)];
    }

	/** @return list<array<string,mixed>> */
	private function gameClose(array $previousSnapshot, array $nextSnapshot): array
	{
		return [
			['op' => 'game.status.set', 'status' => $nextSnapshot['status'] ?? 'finished', 'phase' => $nextSnapshot['gamePhase'] ?? 'FINISHED'],
			['op' => 'game.phase.set', 'phase' => $nextSnapshot['gamePhase'] ?? 'FINISHED'],
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
		$previousPresence = is_array($previousSnapshot['presence'] ?? null) ? $previousSnapshot['presence'] : [];
		$nextPresence = is_array($nextSnapshot['presence'] ?? null) ? $nextSnapshot['presence'] : [];
		foreach ($nextPresence as $playerId => $presence) {
			if (is_string($playerId) && is_array($presence) && ($previousPresence[$playerId] ?? null) !== $presence) {
				unset($presence['connectionEpoch']);
				$operations[] = ['op' => 'player.presence.set', 'playerId' => $playerId, 'presence' => $presence];
			}
		}
		$previousCooldowns = is_array($previousSnapshot['disconnectCooldowns'] ?? null) ? $previousSnapshot['disconnectCooldowns'] : [];
		$nextCooldowns = is_array($nextSnapshot['disconnectCooldowns'] ?? null) ? $nextSnapshot['disconnectCooldowns'] : [];
		foreach ($nextCooldowns as $playerId => $cooldown) {
			if (is_string($playerId) && is_array($cooldown) && ($previousCooldowns[$playerId] ?? null) !== $cooldown) {
				$operations[] = ['op' => 'disconnect.cooldown.set', 'targetPlayerId' => $playerId, 'cooldown' => $cooldown];
			}
		}
        $rematchOperations = $this->rematchChanged($previousSnapshot, $nextSnapshot);
        if ($rematchOperations === null) {
            return null;
        }
        if ($rematchOperations !== []) {
            $operations = [...$operations, ...$rematchOperations];
        }

        $targetPlayerId = is_string($nextSnapshot['disconnectVote']['targetPlayerId'] ?? null)
            ? $nextSnapshot['disconnectVote']['targetPlayerId']
            : null;
        if ($targetPlayerId !== null) {
            $previousPlayer = $previousSnapshot['players'][$targetPlayerId] ?? null;
            $nextPlayer = $nextSnapshot['players'][$targetPlayerId] ?? null;
			if (is_array($previousPlayer) && is_array($nextPlayer)) {
				$operations = [...$operations, ...$this->playerLifecycleDiffOperations($previousSnapshot, $nextSnapshot, $targetPlayerId)];
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
     * @return array<string,mixed>|null
     */
    private function chatMessageById(array $snapshot, string $messageId): ?array
    {
        $messages = $snapshot['chat'] ?? [];
        if (!is_array($messages)) {
            return null;
        }

        foreach ($messages as $message) {
            if (is_array($message) && ($message['id'] ?? null) === $messageId) {
                return $message;
            }
        }

        return null;
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    private function appendedEventLogEntries(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $previous = $previousSnapshot['eventLog'] ?? [];
        $next = $nextSnapshot['eventLog'] ?? [];
        if (!is_array($previous) || !is_array($next)) {
            return null;
        }
        if ($previous === []) {
            return array_values($next);
        }

        $previousIds = $this->eventLogEntryIds($previous);
        $nextIds = $this->eventLogEntryIds($next);
        if ($previousIds === null || $nextIds === null) {
            return null;
        }

        $maxOverlap = min(count($previousIds), count($nextIds));
        for ($overlap = $maxOverlap; $overlap > 0; --$overlap) {
            if ($this->hasEventLogOverlap($previousIds, $nextIds, $overlap)) {
                return array_values(array_slice($next, $overlap));
            }
        }

        return null;
    }

    /**
     * @param list<string> $previousIds
     * @param list<string> $nextIds
     */
    private function hasEventLogOverlap(array $previousIds, array $nextIds, int $overlap): bool
    {
        $previousStart = count($previousIds) - $overlap;
        for ($index = 0; $index < $overlap; ++$index) {
            if ($previousIds[$previousStart + $index] !== $nextIds[$index]) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param list<array<string,mixed>> $entries
     *
     * @return list<string>|null
     */
    private function eventLogEntryIds(array $entries): ?array
    {
        $ids = [];
        foreach ($entries as $entry) {
            $id = $entry['id'] ?? null;
            if (!is_string($id) || $id === '') {
                return null;
            }
            $ids[] = $id;
        }

        return $ids;
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function eventLogAppendOperation(array $previousSnapshot, array $nextSnapshot, bool $sanitizePrivateCard = false): array
    {
        $eventLogEntries = $this->appendedEventLogEntries($previousSnapshot, $nextSnapshot);
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
     * A public battlefield card that becomes private is projected with a new opaque shell id.
     * Replace the previously public projection explicitly instead of forcing a resync or
     * addressing the shell with the now-private instance id.
     *
     * @param array{playerId:string,zone:string,instanceId:string} $location
     *
     * @return list<array<string,mixed>>|null
     */
    private function projectedBattlefieldCardReplacementOperations(array $previousSnapshot, array $nextSnapshot, array $location): ?array
    {
        $removed = array_values(array_filter(
            $this->removedBattlefieldCards($previousSnapshot, $nextSnapshot),
            static fn (array $entry): bool => $entry['playerId'] === $location['playerId']
                && $entry['instanceId'] === $location['instanceId'],
        ));
        $created = array_values(array_filter(
            $this->createdBattlefieldCards($previousSnapshot, $nextSnapshot),
            static fn (array $entry): bool => $entry['playerId'] === $location['playerId'],
        ));
        if (count($removed) !== 1 || count($created) !== 1) {
            return null;
        }

        return [
            [
                'op' => 'card.remove',
                'playerId' => $location['playerId'],
                'zone' => 'battlefield',
                'instanceId' => $location['instanceId'],
            ],
            [
                'op' => 'card.create',
                'playerId' => $location['playerId'],
                'zone' => 'battlefield',
                'index' => $created[0]['index'],
                'card' => $created[0]['card'],
            ],
        ];
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
        foreach (['power', 'toughness', 'loyalty', 'defense', 'saga'] as $stat) {
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
     * @return list<array<string,mixed>>|null
     */
    private function helperChanged(array $previousSnapshot, array $nextSnapshot): ?array
    {
        $operations = $this->specialEntityDiffOperations($previousSnapshot, $nextSnapshot) ?? [];
        $created = $this->createdBattlefieldCards($previousSnapshot, $nextSnapshot);
        $removed = $this->removedBattlefieldCards($previousSnapshot, $nextSnapshot);

        foreach ($removed as $entry) {
            $operations[] = [
                'op' => 'card.remove',
                'playerId' => $entry['playerId'],
                'zone' => 'battlefield',
                'instanceId' => $entry['instanceId'],
            ];
        }
        foreach ($created as $entry) {
            $operations[] = [
                'op' => 'card.create',
                'playerId' => $entry['playerId'],
                'zone' => 'battlefield',
                'index' => $entry['index'],
                'card' => $entry['card'],
            ];
        }
        foreach ($this->updatedBattlefieldCards($previousSnapshot, $nextSnapshot) as $entry) {
            $operations[] = [
                'op' => 'card.projection.set',
                'playerId' => $entry['playerId'],
                'zone' => 'battlefield',
                'instanceId' => $entry['instanceId'],
                'card' => $entry['card'],
            ];
        }

        if ($operations === []) {
            return null;
        }

        return [
            ...$operations,
            ...$this->zoneCountOperations($previousSnapshot, $nextSnapshot),
            ...$this->eventLogAppendOperation($previousSnapshot, $nextSnapshot),
        ];
    }

    /**
     * @return list<array{playerId:string,instanceId:string}>
     */
    private function removedBattlefieldCards(array $previousSnapshot, array $nextSnapshot): array
    {
        $knownIds = $this->allCardInstanceIds($nextSnapshot);
        $removed = [];
        foreach (($previousSnapshot['players'] ?? []) as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player) || !is_array($player['zones']['battlefield'] ?? null)) {
                continue;
            }

            foreach ($player['zones']['battlefield'] as $card) {
                if (!is_array($card)) {
                    continue;
                }

                $instanceId = $this->cardInstanceId($card);
                if ($instanceId !== null && !isset($knownIds[$instanceId])) {
                    $removed[] = ['playerId' => $playerId, 'instanceId' => $instanceId];
                }
            }
        }

        return $removed;
    }

    /**
     * @return list<array{playerId:string,instanceId:string,card:array<string,mixed>}>
     */
    private function updatedBattlefieldCards(array $previousSnapshot, array $nextSnapshot): array
    {
        $updated = [];
        foreach (($nextSnapshot['players'] ?? []) as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player) || !is_array($player['zones']['battlefield'] ?? null)) {
                continue;
            }

            foreach ($player['zones']['battlefield'] as $card) {
                if (!is_array($card)) {
                    continue;
                }

                $instanceId = $this->cardInstanceId($card);
                if ($instanceId === null) {
                    continue;
                }

                $previousCard = $this->card($previousSnapshot, $playerId, 'battlefield', $instanceId);
                if ($previousCard !== null && $previousCard !== $card) {
                    $updated[] = ['playerId' => $playerId, 'instanceId' => $instanceId, 'card' => $card];
                }
            }
        }

        return $updated;
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
        return (new GameLogPrivacySanitizer())->sanitizePublicEntry($entry, true);
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
        if (in_array($type, [
            'token.group.split', 'token.group.merged', 'token.group.members.removed',
            'token.group.dissolved', 'token.group.state.changed',
            'token.group.position.changed', 'token.group.moved',
        ], true)) {
            return array_filter([
                'effectVersion' => $payload['effectVersion'] ?? null,
                'actorPlayerId' => $payload['actorPlayerId'] ?? null,
                'quantity' => $payload['quantity'] ?? null,
                'beforeQuantity' => $payload['beforeQuantity'] ?? null,
                'remainingQuantity' => $payload['remainingQuantity'] ?? null,
                'extractedQuantity' => $payload['extractedQuantity'] ?? null,
                'removedQuantity' => $payload['removedQuantity'] ?? null,
                'tapped' => $payload['tapped'] ?? null,
                'faceDown' => $payload['faceDown'] ?? null,
            ], static fn (mixed $value): bool => $value !== null);
        }
		if ($type === 'battlefield.untap_all' && array_key_exists('resultingGroups', $payload)) {
			return [
				'effectVersion' => $payload['effectVersion'] ?? 1,
				'playerId' => $payload['playerId'] ?? null,
				'count' => is_array($payload['instanceIds'] ?? null) ? count($payload['instanceIds']) : 0,
			];
		}
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

    /**
     * @return array<string,mixed>|null
     */
    private function cardAtIndex(array $snapshot, string $playerId, string $zone, int $index): ?array
    {
        $cards = $snapshot['players'][$playerId]['zones'][$zone] ?? null;
        if (!is_array($cards) || !isset($cards[$index]) || !is_array($cards[$index])) {
            return null;
        }

        return $cards[$index];
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
