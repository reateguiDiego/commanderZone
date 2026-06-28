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
            $hasLegacyReplayOps = is_array($replay['ops'] ?? null) || is_array($replay['entries'] ?? null);
            if (!$hasLegacyReplayOps) {
                if ($this->applyRuntimeMulliganEvent($snapshot, $event, $payload)) {
                    $snapshot['version'] = $event->version();
                    $snapshot['updatedAt'] = $event->createdAt()->format(DATE_ATOM);

                    continue;
                }
                if ($this->applyRuntimeGameplayEvent($snapshot, $event, $payload)) {
                    $snapshot['version'] = $event->version();
                    $snapshot['updatedAt'] = $event->createdAt()->format(DATE_ATOM);

                    continue;
                }
            }

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
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeMulliganEvent(array &$snapshot, GameEvent $event, array $payload): bool
    {
        if (!in_array($event->type(), [
            'mulligan.player_took',
            'mulligan.player_kept',
            'mulligan.cards_bottomed',
            'mulligan.scry_confirmed',
            'mulligan.player_ready',
            'mulligan.completed',
            'game.phase_changed',
        ], true)) {
            return false;
        }

        if (is_string($payload['phase'] ?? null) && $payload['phase'] !== '') {
            $snapshot['gamePhase'] = $payload['phase'];
        }

        $mulligan = is_array($payload['mulligan'] ?? null) ? $payload['mulligan'] : [];
        if ($mulligan !== []) {
            $snapshot['mulligan'] = [
                ...($snapshot['mulligan'] ?? []),
                'rule' => is_string($mulligan['rule'] ?? null) ? $mulligan['rule'] : ($snapshot['mulligan']['rule'] ?? null),
                'firstMulliganFree' => ($mulligan['firstMulliganFree'] ?? $snapshot['mulligan']['firstMulliganFree'] ?? true) === true,
            ];
            $this->applyRuntimeMulliganPlayerStates($snapshot, $mulligan);
        }

        $playerId = is_string($payload['playerId'] ?? null) ? $payload['playerId'] : '';
        if ($playerId !== '' && isset($snapshot['players'][$playerId])) {
            $cardsById = $this->cardsByInstanceId($snapshot, $playerId, ['hand', 'library']);
            $handIds = $this->stringList($payload['handIds'] ?? []);
            if ($handIds !== []) {
                $snapshot['players'][$playerId]['zones']['hand'] = $this->orderedCardsFromIds($cardsById, $handIds, 'hand', $playerId);
            }
            $libraryIds = $this->stringList($payload['libraryOrder'] ?? []);
            if ($libraryIds !== []) {
                $snapshot['players'][$playerId]['zones']['library'] = $this->orderedCardsFromIds($cardsById, $libraryIds, 'library', $playerId);
            }
            $this->rebuildLoc($snapshot);
        }

        return true;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeGameplayEvent(array &$snapshot, GameEvent $event, array $payload): bool
    {
        switch ($event->type()) {
            case 'library.draw':
            case 'library.draw_many':
                $playerId = is_string($payload['playerId'] ?? null) ? $payload['playerId'] : '';
                if ($playerId === '' || !isset($snapshot['players'][$playerId])) {
                    return true;
                }
                foreach ($this->stringList($payload['instanceIds'] ?? []) as $instanceId) {
                    $this->applyMove($snapshot, [
                        'instanceId' => $instanceId,
                        'from' => ['playerId' => $playerId, 'zone' => 'library'],
                        'to' => ['playerId' => $playerId, 'zone' => 'hand'],
                    ]);
                }

                return true;

            case 'card.moved':
            case 'cards.moved':
            case 'zone.move_all':
                foreach (array_values(array_filter($payload['moves'] ?? [], static fn (mixed $move): bool => is_array($move))) as $move) {
                    $this->applyMove($snapshot, $move);
                }
                $this->applyRuntimeCommanderCastCounters($snapshot, $payload);

                return true;

            case 'library.shuffle':
                $playerId = is_string($payload['playerId'] ?? null) ? $payload['playerId'] : '';
                $libraryOrder = $this->stringList($payload['libraryOrder'] ?? []);
                if ($playerId !== '' && $libraryOrder !== [] && isset($snapshot['players'][$playerId])) {
                    $cardsById = $this->cardsByInstanceId($snapshot, $playerId, ['library']);
                    $snapshot['players'][$playerId]['zones']['library'] = $this->orderedCardsFromIds($cardsById, $libraryOrder, 'library', $playerId);
                    $this->rebuildLoc($snapshot);
                }

                return true;

            case 'card.token.created':
                $this->applyRuntimeTokenCreated($snapshot, $event, $payload);

                return true;

            case 'card.token_copy.created':
                $this->applyRuntimeTokenCopyCreated($snapshot, $event, $payload);

                return true;

            case 'counter.changed':
                $this->applyRuntimeCounterChanged($snapshot, $payload);

                return true;

            case 'commander.damage.changed':
                $this->applyRuntimeCommanderDamageChanged($snapshot, $payload);

                return true;

            case 'card.counter.changed':
                $this->applyRuntimeCardCounterChanged($snapshot, $payload);

                return true;

            case 'card.power_toughness.changed':
                $this->applyRuntimeCardStatsChanged($snapshot, $payload);

                return true;

            case 'helper.created':
                $this->applyRuntimeHelperCreated($snapshot, $event, $payload);

                return true;

            case 'helper.updated':
                $this->applyRuntimeHelperUpdated($snapshot, $payload);

                return true;

            case 'helper.removed':
                $this->applyRuntimeHelperRemoved($snapshot, $payload);

                return true;

            case 'game.concede':
                $playerId = is_string($payload['playerId'] ?? null) ? $payload['playerId'] : '';
                if ($playerId !== '' && isset($snapshot['players'][$playerId])) {
                    $snapshot['players'][$playerId]['status'] = 'conceded';
                    $snapshot['players'][$playerId]['concededAt'] = is_string($payload['concededAt'] ?? null)
                        ? $payload['concededAt']
                        : ($snapshot['players'][$playerId]['concededAt'] ?? null);
                }
                if (is_array($payload['turn'] ?? null)) {
                    $snapshot['turn'] = $payload['turn'];
                }

                return true;

            case 'game.close':
                if (is_string($payload['phase'] ?? null) && $payload['phase'] !== '') {
                    $snapshot['gamePhase'] = $payload['phase'];
                }

                return true;

            default:
                return false;
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCommanderCastCounters(array &$snapshot, array $payload): void
    {
        foreach (array_values(array_filter($payload['commanderCastCounters'] ?? [], static fn (mixed $counter): bool => is_array($counter))) as $counter) {
            $scope = is_string($counter['scope'] ?? null) ? trim($counter['scope']) : '';
            if ($scope === '' || !str_starts_with($scope, 'commander:')) {
                continue;
            }

            $counters = is_array($counter['counters'] ?? null) ? $counter['counters'] : [];
            $snapshot['counters'][$scope] = [
                'casts' => max(0, (int) ($counters['casts'] ?? 0)),
            ];
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCounterChanged(array &$snapshot, array $payload): void
    {
        $scope = is_string($payload['scope'] ?? null) ? trim($payload['scope']) : '';
        $key = is_string($payload['key'] ?? null) ? trim($payload['key']) : '';
        if ($scope === '' || $key === '') {
            return;
        }
        $value = max(0, (int) ($payload['value'] ?? 0));
        if (str_starts_with($scope, 'player:')) {
            $playerId = substr($scope, strlen('player:'));
            if ($playerId !== '' && isset($snapshot['players'][$playerId])) {
                $counters = is_array($snapshot['players'][$playerId]['counters'] ?? null)
                    ? $snapshot['players'][$playerId]['counters']
                    : [];
                $counters[$key] = $value;
                $snapshot['players'][$playerId]['counters'] = $counters;
            }

            return;
        }

        $counters = is_array($snapshot['counters'][$scope] ?? null) ? $snapshot['counters'][$scope] : [];
        $counters[$key] = $value;
        $snapshot['counters'][$scope] = $counters;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCommanderDamageChanged(array &$snapshot, array $payload): void
    {
        $targetPlayerId = is_string($payload['targetPlayerId'] ?? null) ? trim($payload['targetPlayerId']) : '';
        $commanderInstanceId = is_string($payload['commanderInstanceId'] ?? null) ? trim($payload['commanderInstanceId']) : '';
        if ($targetPlayerId === '' || $commanderInstanceId === '' || !isset($snapshot['players'][$targetPlayerId])) {
            return;
        }
        $commanderDamage = is_array($snapshot['players'][$targetPlayerId]['commanderDamage'] ?? null)
            ? $snapshot['players'][$targetPlayerId]['commanderDamage']
            : [];
        $commanderDamage[$commanderInstanceId] = max(0, (int) ($payload['damage'] ?? 0));
        $snapshot['players'][$targetPlayerId]['commanderDamage'] = $commanderDamage;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCardCounterChanged(array &$snapshot, array $payload): void
    {
        $card =& $this->locateCard($snapshot, (string) ($payload['instanceId'] ?? ''));
        if (!is_array($card)) {
            return;
        }
        $counter = is_string($payload['counter'] ?? null) ? trim($payload['counter']) : '';
        if ($counter === '') {
            return;
        }
        $counters = is_array($card['counters'] ?? null) ? $card['counters'] : [];
        $counters[$counter] = max(0, (int) ($payload['value'] ?? 0));
        $card['counters'] = $counters;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCardStatsChanged(array &$snapshot, array $payload): void
    {
        $card =& $this->locateCard($snapshot, (string) ($payload['instanceId'] ?? ''));
        if (!is_array($card)) {
            return;
        }
        foreach (['power', 'toughness', 'loyalty', 'defense', 'saga'] as $field) {
            if (array_key_exists($field, $payload)) {
                $card[$field] = $payload[$field];
            }
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeHelperCreated(array &$snapshot, GameEvent $event, array $payload): void
    {
        $entityId = is_string($payload['entityId'] ?? null) && trim($payload['entityId']) !== ''
            ? trim($payload['entityId'])
            : (is_string($payload['id'] ?? null) ? trim($payload['id']) : '');
        $template = is_string($payload['template'] ?? null) ? trim($payload['template']) : '';
        if ($entityId === '' || $template === '') {
            return;
        }
        $entity = [
            'id' => $entityId,
            'template' => $template,
            'scope' => is_string($payload['scope'] ?? null) && trim($payload['scope']) !== '' ? trim($payload['scope']) : 'player',
            'ownerPlayerId' => is_string($payload['ownerPlayerId'] ?? null) && trim($payload['ownerPlayerId']) !== ''
                ? trim($payload['ownerPlayerId'])
                : (is_string($payload['playerId'] ?? null) ? trim($payload['playerId']) : null),
            'card' => is_array($payload['card'] ?? null) ? $payload['card'] : null,
            'state' => is_array($payload['state'] ?? null) ? $payload['state'] : [],
            'createdAt' => $event->createdAt()->format(DATE_ATOM),
        ];
        $entities = array_values(array_filter(
            is_array($snapshot['specialEntities'] ?? null) ? $snapshot['specialEntities'] : [],
            static fn (mixed $candidate): bool => !is_array($candidate) || ($candidate['id'] ?? null) !== $entityId,
        ));
        $entities[] = $entity;
        $snapshot['specialEntities'] = $entities;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeHelperUpdated(array &$snapshot, array $payload): void
    {
        $entityId = is_string($payload['entityId'] ?? null) && trim($payload['entityId']) !== ''
            ? trim($payload['entityId'])
            : (is_string($payload['id'] ?? null) ? trim($payload['id']) : '');
        if ($entityId === '') {
            return;
        }
        $entities = is_array($snapshot['specialEntities'] ?? null) ? $snapshot['specialEntities'] : [];
        foreach ($entities as &$entity) {
            if (!is_array($entity) || ($entity['id'] ?? null) !== $entityId) {
                continue;
            }
            foreach (['template', 'scope', 'ownerPlayerId', 'card', 'state'] as $field) {
                if (array_key_exists($field, $payload)) {
                    $entity[$field] = $payload[$field];
                }
            }
            break;
        }
        unset($entity);
        $snapshot['specialEntities'] = array_values($entities);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeHelperRemoved(array &$snapshot, array $payload): void
    {
        $entityId = is_string($payload['entityId'] ?? null) && trim($payload['entityId']) !== ''
            ? trim($payload['entityId'])
            : (is_string($payload['id'] ?? null) ? trim($payload['id']) : '');
        if ($entityId === '') {
            return;
        }
        $snapshot['specialEntities'] = array_values(array_filter(
            is_array($snapshot['specialEntities'] ?? null) ? $snapshot['specialEntities'] : [],
            static fn (mixed $entity): bool => !is_array($entity) || ($entity['id'] ?? null) !== $entityId,
        ));
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeTokenCreated(array &$snapshot, GameEvent $event, array $payload): void
    {
        $playerId = is_string($payload['playerId'] ?? null) ? $payload['playerId'] : '';
        if ($playerId === '' || !isset($snapshot['players'][$playerId])) {
            return;
        }

        foreach ($this->runtimeTokenCards($payload, $event, $playerId) as $token) {
            $this->insertCard($snapshot, $playerId, 'battlefield', $token, null);
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeTokenCopyCreated(array &$snapshot, GameEvent $event, array $payload): void
    {
        $targetPlayerId = is_string($payload['targetPlayerId'] ?? null) && $payload['targetPlayerId'] !== ''
            ? $payload['targetPlayerId']
            : (is_string($payload['playerId'] ?? null) ? $payload['playerId'] : '');
        if ($targetPlayerId === '' || !isset($snapshot['players'][$targetPlayerId])) {
            return;
        }

        foreach ($this->runtimeTokenCards($payload, $event, $targetPlayerId, true) as $token) {
            $this->insertCard($snapshot, $targetPlayerId, 'battlefield', $token, null);
        }
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return list<array<string,mixed>>
     */
    private function runtimeTokenCards(array $payload, GameEvent $event, string $playerId, bool $copy = false): array
    {
        $tokens = array_values(array_filter($payload['tokens'] ?? [], static fn (mixed $token): bool => is_array($token)));
        if ($tokens === []) {
            $instanceIds = $this->stringList($payload['instanceIds'] ?? []);
            if ($instanceIds === [] && is_string($payload['instanceId'] ?? null) && $payload['instanceId'] !== '') {
                $instanceIds = [$payload['instanceId']];
            }
            $cardKey = is_string($payload['cardKey'] ?? null) && trim($payload['cardKey']) !== ''
                ? trim($payload['cardKey'])
                : (is_string($payload['copiedFromCardKey'] ?? null) ? trim($payload['copiedFromCardKey']) : '');
            $name = is_string($payload['name'] ?? null) && trim($payload['name']) !== ''
                ? trim($payload['name'])
                : ($copy ? 'Token Copy' : 'Token');
            $tokens = array_map(static fn (string $instanceId): array => [
                'instanceId' => $instanceId,
                'cardKey' => $cardKey,
                'name' => $name,
                'isToken' => true,
                'isTokenCopy' => $copy,
                'tokenMeta' => is_array($payload['tokenMeta'] ?? null) ? $payload['tokenMeta'] : ['isCopy' => $copy],
            ], $instanceIds);
        }

        $cards = [];
        foreach ($tokens as $token) {
            $instanceId = is_string($token['instanceId'] ?? null) && trim($token['instanceId']) !== ''
                ? trim($token['instanceId'])
                : '';
            if ($instanceId === '') {
                continue;
            }
            $cardKey = is_string($token['cardKey'] ?? null) && trim($token['cardKey']) !== ''
                ? trim($token['cardKey'])
                : (is_string($payload['cardKey'] ?? null) ? trim($payload['cardKey']) : '');
            if ($cardKey === '') {
                $cardKey = 'token:'.$instanceId;
            }

            $card = [
                'instanceId' => $instanceId,
                'ownerId' => is_string($token['ownerId'] ?? null) && trim($token['ownerId']) !== '' ? trim($token['ownerId']) : $playerId,
                'controllerId' => is_string($token['controllerId'] ?? null) && trim($token['controllerId']) !== '' ? trim($token['controllerId']) : $playerId,
                'name' => is_string($token['name'] ?? null) && trim($token['name']) !== '' ? trim($token['name']) : ($copy ? 'Token Copy' : 'Token'),
                'cardKey' => $cardKey,
                'cardRef' => $cardKey,
                'printId' => is_string($token['printId'] ?? null) && trim($token['printId']) !== '' ? trim($token['printId']) : $cardKey,
                'cardVersion' => is_string($token['cardVersion'] ?? null) && trim($token['cardVersion']) !== '' ? trim($token['cardVersion']) : 'runtime-identity-v1',
                'scryfallId' => $this->scryfallIdFromRuntimeCardKey($cardKey),
                'zone' => 'battlefield',
                'isToken' => true,
                'isTokenCopy' => ($token['isTokenCopy'] ?? $copy) === true,
                'tokenMeta' => is_array($token['tokenMeta'] ?? null) ? $token['tokenMeta'] : ['isCopy' => $copy],
                'position' => is_array($token['position'] ?? null) ? $token['position'] : ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
                'counters' => is_array($token['counters'] ?? null) ? $token['counters'] : [],
                'tapped' => ($token['tapped'] ?? false) === true,
                'faceDown' => ($token['faceDown'] ?? false) === true,
                'revealedTo' => ['all'],
                'createdAt' => $event->createdAt()->format(DATE_ATOM),
            ];
            foreach (['power', 'toughness', 'loyalty', 'defense', 'saga'] as $field) {
                if (array_key_exists($field, $token)) {
                    $card[$field] = $token[$field];
                }
            }
            $cards[] = $card;
        }

        return $cards;
    }

    private function scryfallIdFromRuntimeCardKey(string $cardKey): ?string
    {
        $tokenSuffix = ':token';
        if (str_ends_with($cardKey, $tokenSuffix)) {
            return substr($cardKey, 0, -strlen($tokenSuffix)) ?: null;
        }

        $cardSuffix = ':card';
        if (str_ends_with($cardKey, $cardSuffix)) {
            return substr($cardKey, 0, -strlen($cardSuffix)) ?: null;
        }

        return null;
    }

    /**
     * @param array<string,mixed> $mulligan
     */
    private function applyRuntimeMulliganPlayerStates(array &$snapshot, array $mulligan): void
    {
        $playerStatuses = is_array($mulligan['playerStatus'] ?? null) ? $mulligan['playerStatus'] : [];
        $readyPlayers = is_array($mulligan['readyPlayers'] ?? null) ? $mulligan['readyPlayers'] : [];
        foreach ($playerStatuses as $playerId => $playerStatus) {
            if (!is_string($playerId) || !is_array($playerStatus) || !isset($snapshot['players'][$playerId])) {
                continue;
            }

            $currentHandSize = max(0, (int) ($playerStatus['currentHandSize'] ?? 0));
            $cardsToBottom = max(0, (int) ($playerStatus['cardsToBottom'] ?? 0));
            $bottomPending = ($playerStatus['bottomPending'] ?? false) === true;
            $status = is_string($playerStatus['status'] ?? null) ? $playerStatus['status'] : 'DECIDING';
            $snapshot['players'][$playerId]['mulligan'] = [
                ...($snapshot['players'][$playerId]['mulligan'] ?? []),
                'rule' => $snapshot['mulligan']['rule'] ?? null,
                'firstMulliganFree' => ($snapshot['mulligan']['firstMulliganFree'] ?? true) === true,
                'mulligansTaken' => max(0, (int) ($playerStatus['mulliganCount'] ?? 0)),
                'effectiveMulligans' => max(0, (int) ($playerStatus['effectiveMulligans'] ?? 0)),
                'drawCount' => $currentHandSize,
                'bottomSelectionCount' => $cardsToBottom,
                'finalHandSize' => $bottomPending ? max(0, $currentHandSize - $cardsToBottom) : $currentHandSize,
                'needsBottomSelection' => $bottomPending,
                'bottomOrderMode' => $this->legacyBottomOrderMode($playerStatus['bottomOrderMode'] ?? null),
                'needsScryAfterKeep' => ($playerStatus['scryPending'] ?? false) === true,
                'canTakeAnotherMulligan' => $status === 'DECIDING',
                'status' => $status,
                'ready' => ($readyPlayers[$playerId] ?? false) === true || $status === 'READY',
                'scryCardInstanceId' => is_string($playerStatus['scryCardInstanceId'] ?? null) && $playerStatus['scryCardInstanceId'] !== ''
                    ? $playerStatus['scryCardInstanceId']
                    : null,
            ];
        }
    }

    private function legacyBottomOrderMode(mixed $mode): string
    {
        return match ($mode) {
            'PLAYER_CHOSEN_ORDER' => 'CLIENT',
            'RANDOM_SERVER_SIDE' => 'RANDOM_SERVER_SIDE',
            default => 'NONE',
        };
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
        if ($targetZone === 'battlefield' && is_array($move['position'] ?? null)) {
            $card['position'] = $move['position'];
        }
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
        if ($zone !== 'battlefield') {
            unset($card['position']);
        }
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
