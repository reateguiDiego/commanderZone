<?php

namespace App\Application\Game;

use App\Domain\Game\GameEvent;

final class GameEventReplayService
{
    public function __construct(
        private readonly ?GameLibraryOps $libraryOps = null,
    ) {
    }

    /**
     * @param list<GameEvent> $events
     *
     * @return array<string,mixed>
     */
    public function replay(array $snapshot, array $events): array
    {
        foreach ($events as $event) {
            if (!$event instanceof GameEvent) {
                continue;
            }

            $payload = $event->payload();
            $replay = is_array($payload['replay'] ?? null) ? $payload['replay'] : [];
            if (is_array($replay['ops'] ?? null)) {
                foreach (array_values($replay['ops']) as $operation) {
                    if (is_array($operation)) {
                        $this->applyOperation($snapshot, $operation, null);
                    }
                }
            }
            if (is_array($replay['entries'] ?? null)) {
                foreach (array_values($replay['entries']) as $entry) {
                    if (!is_array($entry) || !is_array($entry['op'] ?? null)) {
                        continue;
                    }

                    $this->applyOperation(
                        $snapshot,
                        $entry['op'],
                        is_string($entry['visibility'] ?? null) ? $entry['visibility'] : null,
                    );
                }
            }

            $eventLogEntries = is_array($payload['eventLogEntries'] ?? null)
                ? array_values(array_filter($payload['eventLogEntries'], static fn (mixed $entry): bool => is_array($entry)))
                : [];
            if ($eventLogEntries !== []) {
                $snapshot['eventLog'] = array_values(array_slice([
                    ...(is_array($snapshot['eventLog'] ?? null) ? $snapshot['eventLog'] : []),
                    ...$eventLogEntries,
                ], -250));
            }

            $snapshot['version'] = $event->version();
            $snapshot['updatedAt'] = $event->createdAt()->format(DATE_ATOM);
        }

        return $snapshot;
    }

    /**
     * @param array<string,mixed> $operation
     */
    private function applyOperation(array &$snapshot, array $operation, ?string $visibility): void
    {
        $op = is_string($operation['op'] ?? null) ? $operation['op'] : '';
        switch ($op) {
            case 'player.life.set':
                $playerId = (string) ($operation['playerId'] ?? '');
                if (isset($snapshot['players'][$playerId])) {
                    $snapshot['players'][$playerId]['life'] = (int) ($operation['value'] ?? 0);
                }
                return;

            case 'turn.set':
                $snapshot['turn'] = is_array($operation['turn'] ?? null) ? $operation['turn'] : [];
                return;

            case 'player.counters.set':
                $playerId = (string) ($operation['playerId'] ?? '');
                if (isset($snapshot['players'][$playerId])) {
                    $snapshot['players'][$playerId]['counters'] = is_array($operation['counters'] ?? null)
                        ? $operation['counters']
                        : [];
                }
                return;

            case 'game.counters.set':
                $scope = (string) ($operation['scope'] ?? '');
                if ($scope !== '') {
                    $snapshot['counters'][$scope] = is_array($operation['counters'] ?? null)
                        ? $operation['counters']
                        : [];
                }
                return;

            case 'card.field.set':
                $card =& $this->locateCard($snapshot, (string) ($operation['instanceId'] ?? ''));
                if (!is_array($card)) {
                    return;
                }
                foreach (['tapped', 'rotation', 'faceDown', 'hidden', 'revealedTo', 'counters', 'dungeonMarker', 'position', 'power', 'toughness', 'loyalty', 'defense', 'saga'] as $field) {
                    if (array_key_exists($field, $operation)) {
                        $card[$field] = $operation[$field];
                    }
                }
                return;

            case 'card.counters.patch':
                $card =& $this->locateCard($snapshot, (string) ($operation['instanceId'] ?? ''));
                if (!is_array($card)) {
                    return;
                }
                $card['counters'] = is_array($operation['counters'] ?? null) ? $operation['counters'] : [];
                return;

            case 'zone.cards.move':
                $this->applyMove($snapshot, $operation);
                return;

            case 'zone.cards.batchMove':
                foreach (array_values(array_filter($operation['moves'] ?? [], static fn (mixed $move): bool => is_array($move))) as $move) {
                    $this->applyMove($snapshot, $move);
                }
                return;

            case 'zone.cards.remove':
                $this->removeCards($snapshot, (string) ($operation['playerId'] ?? ''), (string) ($operation['zone'] ?? ''), array_values(array_filter(
                    $operation['instanceIds'] ?? [],
                    static fn (mixed $id): bool => is_string($id) && trim($id) !== '',
                )));
                return;

            case 'library.top.revealed':
                $this->applyLibraryReveal($snapshot, $operation, $visibility);
                return;

            case 'mulligan.player_state.set':
                $this->applyMulliganPlayerState($snapshot, $operation);
                return;

            case 'game.phase.set':
                if (is_string($operation['phase'] ?? null) && $operation['phase'] !== '') {
                    $snapshot['gamePhase'] = $operation['phase'];
                }
                return;

            case 'relation.remove':
                $kind = (string) ($operation['kind'] ?? '');
                $id = (string) ($operation['id'] ?? '');
                if ($kind === 'arrow') {
                    $snapshot['arrows'] = array_values(array_filter(
                        is_array($snapshot['arrows'] ?? null) ? $snapshot['arrows'] : [],
                        static fn (mixed $arrow): bool => !is_array($arrow) || (string) ($arrow['id'] ?? '') !== $id,
                    ));
                } elseif ($kind === 'attachment') {
                    $snapshot['attachments'] = array_values(array_filter(
                        is_array($snapshot['attachments'] ?? null) ? $snapshot['attachments'] : [],
                        static fn (mixed $attachment): bool => !is_array($attachment) || (string) ($attachment['id'] ?? '') !== $id,
                    ));
                }
                return;

            case 'zone.count.set':
            case 'dice.result':
            case 'eventLog.append':
                return;

            default:
                return;
        }
    }

    /**
     * @param array<string,mixed> $operation
     */
    private function applyMulliganPlayerState(array &$snapshot, array $operation): void
    {
        $playerId = (string) ($operation['playerId'] ?? '');
        if ($playerId === '' || !isset($snapshot['players'][$playerId])) {
            return;
        }

        $handIds = $this->stringList($operation['handIds'] ?? []);
        $libraryIds = $this->stringList($operation['libraryIds'] ?? []);
        $cardsById = $this->cardsByInstanceId($snapshot, $playerId, ['hand', 'library']);
        $snapshot['players'][$playerId]['zones']['hand'] = $this->orderedCardsFromIds($cardsById, $handIds, 'hand', $playerId);
        $snapshot['players'][$playerId]['zones']['library'] = $this->orderedCardsFromIds($cardsById, $libraryIds, 'library', $playerId);
        if (is_array($operation['mulligan'] ?? null)) {
            $snapshot['players'][$playerId]['mulligan'] = $operation['mulligan'];
        }
        if (is_array($operation['playerState'] ?? null)) {
            foreach (['libraryOrientation', GameLibraryOps::VISIBILITY_EPOCH_KEY, 'revealedLibraryTo'] as $field) {
                if (array_key_exists($field, $operation['playerState'])) {
                    $snapshot['players'][$playerId][$field] = $operation['playerState'][$field];
                }
            }
        }
        if (is_string($operation['gamePhase'] ?? null) && $operation['gamePhase'] !== '') {
            $snapshot['gamePhase'] = $operation['gamePhase'];
        }
        $this->rebuildLoc($snapshot);
    }

    /**
     * @param list<string> $zones
     * @return array<string,array<string,mixed>>
     */
    private function cardsByInstanceId(array $snapshot, string $playerId, array $zones): array
    {
        $cardsById = [];
        foreach ($zones as $zone) {
            foreach (is_array($snapshot['players'][$playerId]['zones'][$zone] ?? null) ? $snapshot['players'][$playerId]['zones'][$zone] : [] as $card) {
                if (!is_array($card)) {
                    continue;
                }
                $instanceId = (string) ($card['instanceId'] ?? '');
                if ($instanceId !== '') {
                    $cardsById[$instanceId] = $card;
                }
            }
        }

        return $cardsById;
    }

    /**
     * @param array<string,array<string,mixed>> $cardsById
     * @param list<string> $instanceIds
     * @return list<array<string,mixed>>
     */
    private function orderedCardsFromIds(array $cardsById, array $instanceIds, string $zone, string $playerId): array
    {
        $cards = [];
        foreach ($instanceIds as $instanceId) {
            if (!isset($cardsById[$instanceId])) {
                continue;
            }
            $card = $cardsById[$instanceId];
            $card['zone'] = $zone;
            $card['ownerId'] = (string) ($card['ownerId'] ?? $playerId);
            $card['controllerId'] = (string) ($card['controllerId'] ?? $playerId);
            $cards[] = $card;
        }

        return $cards;
    }

    /**
     * @return list<string>
     */
    private function stringList(mixed $value): array
    {
        return array_values(array_filter(
            is_array($value) ? $value : [],
            static fn (mixed $item): bool => is_string($item) && trim($item) !== '',
        ));
    }

    /**
     * @param array<string,mixed> $move
     */
    private function applyMove(array &$snapshot, array $move): void
    {
        $instanceId = (string) ($move['instanceId'] ?? '');
        if ($instanceId === '') {
            return;
        }

        $from = is_array($move['from'] ?? null) ? $move['from'] : [];
        $sourcePlayerId = (string) ($from['playerId'] ?? '');
        $sourceZone = (string) ($from['zone'] ?? '');
        $card = $this->removeCard($snapshot, $sourcePlayerId, $sourceZone, $instanceId);
        if (!is_array($card) && is_array($move['card'] ?? null)) {
            $card = $move['card'];
        }
        if (!is_array($card)) {
            return;
        }

        $card = is_array($move['card'] ?? null) ? $move['card'] : $card;
        $to = is_array($move['to'] ?? null) ? $move['to'] : [];
        $targetPlayerId = (string) ($to['playerId'] ?? '');
        $targetZone = (string) ($to['zone'] ?? '');
        $targetIndex = array_key_exists('index', $to) ? max(0, (int) $to['index']) : null;
        $this->insertCard($snapshot, $targetPlayerId, $targetZone, $card, $targetIndex);
    }

    /**
     * @param list<string> $instanceIds
     */
    private function removeCards(array &$snapshot, string $playerId, string $zone, array $instanceIds): void
    {
        foreach ($instanceIds as $instanceId) {
            $this->removeCard($snapshot, $playerId, $zone, $instanceId);
        }
    }

    /**
     * @return array<string,mixed>|null
     */
    private function removeCard(array &$snapshot, string $playerId, string $zone, string $instanceId): ?array
    {
        $cards = is_array($snapshot['players'][$playerId]['zones'][$zone] ?? null)
            ? array_values($snapshot['players'][$playerId]['zones'][$zone])
            : [];
        foreach ($cards as $index => $card) {
            if (!is_array($card) || (string) ($card['instanceId'] ?? '') !== $instanceId) {
                continue;
            }

            array_splice($snapshot['players'][$playerId]['zones'][$zone], $index, 1);
            $this->rebuildLoc($snapshot);

            return $card;
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function insertCard(array &$snapshot, string $playerId, string $zone, array $card, ?int $index): void
    {
        $snapshot['players'][$playerId]['zones'][$zone] ??= [];
        $card['zone'] = $zone;
        $card['controllerId'] = (string) ($card['controllerId'] ?? $playerId);
        $card['ownerId'] = (string) ($card['ownerId'] ?? $playerId);
        if ($index === null || $index >= count($snapshot['players'][$playerId]['zones'][$zone])) {
            $snapshot['players'][$playerId]['zones'][$zone][] = $card;
        } else {
            array_splice($snapshot['players'][$playerId]['zones'][$zone], max(0, $index), 0, [$card]);
        }
        $this->rebuildLoc($snapshot);
    }

    private function applyLibraryReveal(array &$snapshot, array $operation, ?string $visibility): void
    {
        $playerId = (string) ($operation['playerId'] ?? '');
        if ($playerId === '' || !isset($snapshot['players'][$playerId])) {
            return;
        }

        $libraryOps = $this->libraryOps ?? new GameLibraryOps();
        $targets = $this->targetsFromVisibility($snapshot, $visibility);
        $libraryOps->clearReveals($snapshot['players'][$playerId]);
        $epoch = (int) ($snapshot['players'][$playerId][GameLibraryOps::VISIBILITY_EPOCH_KEY] ?? 1);
        $cards = array_values(array_filter($operation['cards'] ?? [], static fn (mixed $card): bool => is_array($card)));
        foreach ($cards as $cardData) {
            $instanceId = (string) ($cardData['instanceId'] ?? '');
            $card =& $this->locateCard($snapshot, $instanceId);
            if (!is_array($card)) {
                continue;
            }

            $card['faceDown'] = false;
            $card['revealedTo'] = $targets;
            $card[GameLibraryOps::CARD_VISIBILITY_EPOCH_KEY] = $epoch;
        }
    }

    /**
     * @return list<string>
     */
    private function targetsFromVisibility(array $snapshot, ?string $visibility): array
    {
        if ($visibility === null || $visibility === 'public') {
            return ['all'];
        }
        if (str_starts_with($visibility, 'player:')) {
            $playerId = substr($visibility, strlen('player:'));

            return $playerId !== '' ? [$playerId] : [];
        }
        if (!str_starts_with($visibility, 'group:')) {
            return [];
        }

        $mask = (int) substr($visibility, strlen('group:'));
        if ($mask <= 0) {
            return [];
        }

        $targets = [];
        $bit = 1;
        foreach (array_keys(is_array($snapshot['players'] ?? null) ? $snapshot['players'] : []) as $playerId) {
            if (!is_string($playerId)) {
                continue;
            }

            if (($mask & $bit) !== 0) {
                $targets[] = $playerId;
            }
            $bit <<= 1;
        }

        return $targets;
    }

    /**
     * @return array<string,mixed>|null
     */
    private function &locateCard(array &$snapshot, string $instanceId): mixed
    {
        if ($instanceId !== '' && is_array($snapshot['loc'][$instanceId] ?? null)) {
            $location = $snapshot['loc'][$instanceId];
            $playerId = (string) ($location['playerId'] ?? '');
            $zone = (string) ($location['zone'] ?? '');
            $index = max(0, (int) ($location['index'] ?? 0));
            if (is_array($snapshot['players'][$playerId]['zones'][$zone][$index] ?? null)
                && (string) ($snapshot['players'][$playerId]['zones'][$zone][$index]['instanceId'] ?? '') === $instanceId) {
                return $snapshot['players'][$playerId]['zones'][$zone][$index];
            }
        }

        foreach (is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [] as $playerId => &$player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }
            foreach ($player['zones'] as &$zoneCards) {
                if (!is_array($zoneCards)) {
                    continue;
                }
                foreach ($zoneCards as &$card) {
                    if (is_array($card) && (string) ($card['instanceId'] ?? '') === $instanceId) {
                        return $card;
                    }
                }
            }
        }

        $null = null;

        return $null;
    }

    private function rebuildLoc(array &$snapshot): void
    {
        $snapshot['loc'] = [];
        foreach (is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [] as $playerId => $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            foreach (['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] as $zone) {
                $cards = is_array($player['zones'][$zone] ?? null) ? array_values($player['zones'][$zone]) : [];
                foreach ($cards as $index => $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $instanceId = (string) ($card['instanceId'] ?? '');
                    if ($instanceId === '') {
                        continue;
                    }

                    $snapshot['loc'][$instanceId] = [
                        'playerId' => (string) $playerId,
                        'zone' => $zone,
                        'index' => $index,
                        'controllerId' => (string) ($card['controllerId'] ?? $playerId),
                    ];
                }
            }
        }
    }
}
