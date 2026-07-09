<?php

namespace App\Application\Game;

use App\Domain\Game\GameEvent;

final class GameEventReplayService
{
    private const DETERMINISTIC_SHUFFLE_ALGORITHM = 'cz.lcg32.fisher-yates.v1';

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

        $playerId = is_string($payload['playerId'] ?? null) ? $payload['playerId'] : '';
        if ($playerId !== '' && isset($snapshot['players'][$playerId])) {
            if (!$this->applyLegacyRuntimeMulliganZoneSnapshot($snapshot, $playerId, $payload)) {
                $this->applyCompactRuntimeMulliganOperation($snapshot, $event->type(), $playerId, $payload);
            }
            $this->rebuildLoc($snapshot);
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

        return true;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyLegacyRuntimeMulliganZoneSnapshot(array &$snapshot, string $playerId, array $payload): bool
    {
        $cardsById = $this->cardsByInstanceId($snapshot, $playerId, ['hand', 'library']);
        $replayed = false;
        $handIds = $this->stringList($payload['handIds'] ?? []);
        if ($handIds !== []) {
            $snapshot['players'][$playerId]['zones']['hand'] = $this->orderedCardsFromIds($cardsById, $handIds, 'hand', $playerId);
            $replayed = true;
        }
        $libraryIds = $this->stringList($payload['libraryOrder'] ?? []);
        if ($libraryIds !== []) {
            $snapshot['players'][$playerId]['zones']['library'] = $this->orderedCardsFromIds($cardsById, $libraryIds, 'library', $playerId);
            $replayed = true;
        }

        return $replayed;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyCompactRuntimeMulliganOperation(array &$snapshot, string $eventType, string $playerId, array $payload): void
    {
        switch ($eventType) {
            case 'mulligan.player_took':
                $shuffleSeed = $this->uint32Value($payload['shuffleSeed'] ?? null);
                if ($shuffleSeed === null) {
                    return;
                }
                $shuffleAlgorithm = is_string($payload['shuffleAlgorithm'] ?? null) ? $payload['shuffleAlgorithm'] : '';
                if ($shuffleAlgorithm !== '' && $shuffleAlgorithm !== self::DETERMINISTIC_SHUFFLE_ALGORITHM) {
                    throw new \RuntimeException(sprintf('Unsupported runtime mulligan shuffle algorithm "%s".', $shuffleAlgorithm));
                }
                $drawCount = max(0, (int) ($payload['drawCount'] ?? 0));
                $hand = array_values(array_filter(
                    is_array($snapshot['players'][$playerId]['zones']['hand'] ?? null) ? $snapshot['players'][$playerId]['zones']['hand'] : [],
                    static fn (mixed $card): bool => is_array($card),
                ));
                $snapshot['players'][$playerId]['zones']['hand'] = [];
                $this->putRuntimeCardsOnLibraryBottom($snapshot['players'][$playerId], $playerId, $hand);
                $this->libraryOps()->shuffle(
                    $snapshot['players'][$playerId],
                    fn (array $cards): array => $this->shuffleCardsWithSeed($cards, $shuffleSeed),
                );
                $drawn = $this->libraryOps()->drawMany($snapshot['players'][$playerId], $drawCount);
                $this->appendRuntimeCardsToZone($snapshot['players'][$playerId], $playerId, 'hand', $drawn);

                return;

            case 'mulligan.player_kept':
            case 'mulligan.cards_bottomed':
                $bottomedIds = $this->stringList($payload['bottomedIds'] ?? []);
                if ($bottomedIds === []) {
                    return;
                }
                $bottomed = [];
                foreach ($bottomedIds as $instanceId) {
                    $card = $this->removeCard($snapshot, $playerId, 'hand', $instanceId);
                    if (!is_array($card)) {
                        throw new \RuntimeException(sprintf('Could not replay runtime mulligan bottom for card "%s".', $instanceId));
                    }
                    $bottomed[] = $card;
                }
                $this->putRuntimeCardsOnLibraryBottom($snapshot['players'][$playerId], $playerId, $bottomed);

                return;

            case 'mulligan.scry_confirmed':
                $choice = is_string($payload['choice'] ?? null) ? $payload['choice'] : '';
                if ($choice !== 'bottom') {
                    return;
                }
                $movedIds = $this->stringList($payload['movedIds'] ?? []);
                if ($movedIds === [] && is_string($payload['topId'] ?? null) && $payload['topId'] !== '') {
                    $movedIds = [$payload['topId']];
                }
                foreach ($movedIds as $expectedId) {
                    $card = $this->libraryOps()->drawOne($snapshot['players'][$playerId]);
                    if (!is_array($card) || (string) ($card['instanceId'] ?? '') !== $expectedId) {
                        throw new \RuntimeException(sprintf('Could not replay runtime mulligan scry bottom for card "%s".', $expectedId));
                    }
                    $this->putRuntimeCardsOnLibraryBottom($snapshot['players'][$playerId], $playerId, [$card]);
                }

                return;

            default:
                return;
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeGameplayEvent(array &$snapshot, GameEvent $event, array $payload): bool
    {
        switch ($event->type()) {
            case 'game.started':
                return true;

            case 'disconnect.vote.updated':
                $this->applyRuntimeDisconnectVoteUpdated($snapshot, $payload);

                return true;

            case 'life.changed':
                $this->applyRuntimeLifeChanged($snapshot, $payload);

                return true;

            case 'turn.changed':
                $this->applyRuntimeTurnChanged($snapshot, $payload);

                return true;

            case 'card.tapped':
                $this->applyRuntimeCardTapped($snapshot, $payload);

                return true;

            case 'battlefield.untap_all':
                $this->applyRuntimeBattlefieldUntapAll($snapshot, $payload);

                return true;

            case 'card.position.changed':
                $this->applyRuntimeCardPositionChanged($snapshot, $payload);

                return true;

            case 'cards.position.changed':
                $this->applyRuntimeCardsPositionChanged($snapshot, $payload);

                return true;

            case 'card.face_down.changed':
                $this->applyRuntimeCardFaceDownChanged($snapshot, $payload);

                return true;

            case 'card.revealed':
                $this->applyRuntimeCardRevealed($snapshot, $payload);

                return true;

            case 'card.controller.changed':
                $this->applyRuntimeCardControllerChanged($snapshot, $payload);

                return true;

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
                $moves = array_values(array_filter($payload['moves'] ?? [], static fn (mixed $move): bool => is_array($move)));
                if ($event->type() === 'card.moved' && count($moves) === 1 && array_key_exists('faceDown', $payload)) {
                    $moves[0]['faceDown'] = ($payload['faceDown'] ?? false) === true;
                }
                foreach ($moves as $move) {
                    $this->applyMove($snapshot, $move);
                }
                $this->applyRuntimeCommanderCastCounters($snapshot, $payload);

                return true;

            case 'library.shuffle':
                $playerId = is_string($payload['playerId'] ?? null) ? $payload['playerId'] : '';
                $shuffleSeed = $this->uint32Value($payload['shuffleSeed'] ?? null);
                $shuffleAlgorithm = is_string($payload['shuffleAlgorithm'] ?? null) ? $payload['shuffleAlgorithm'] : '';
                if ($playerId !== '' && $shuffleSeed !== null && isset($snapshot['players'][$playerId])) {
                    if ($shuffleAlgorithm !== '' && $shuffleAlgorithm !== self::DETERMINISTIC_SHUFFLE_ALGORITHM) {
                        throw new \RuntimeException(sprintf('Unsupported runtime shuffle algorithm "%s".', $shuffleAlgorithm));
                    }
                    $this->libraryOps()->shuffle(
                        $snapshot['players'][$playerId],
                        fn (array $cards): array => $this->shuffleCardsWithSeed($cards, $shuffleSeed),
                    );
                    $this->rebuildLoc($snapshot);

                    return true;
                }
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

            case 'card.face.changed':
                $this->applyRuntimeCardFaceChanged($snapshot, $payload);

                return true;

            case 'arrow.created':
                $this->applyRuntimeArrowCreated($snapshot, $event, $payload);

                return true;

            case 'arrow.removed':
                $this->applyRuntimeRelationRemoved($snapshot, 'arrows', $payload);

                return true;

            case 'attachment.created':
                $this->applyRuntimeAttachmentCreated($snapshot, $event, $payload);

                return true;

            case 'attachment.removed':
                $this->applyRuntimeAttachmentRemoved($snapshot, $payload);

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
    private function applyRuntimeDisconnectVoteUpdated(array &$snapshot, array $payload): void
    {
        if (is_array($payload['disconnectVote'] ?? null)) {
            $disconnectVote = $payload['disconnectVote'];
            $disconnectVote['votes'] = is_array($disconnectVote['votes'] ?? null) ? $disconnectVote['votes'] : [];
            $snapshot['disconnectVote'] = $disconnectVote;
        }

        $targetPlayerId = is_string($payload['targetPlayerId'] ?? null) ? trim($payload['targetPlayerId']) : '';
        if ($targetPlayerId !== '' && ($payload['status'] ?? null) === 'resolved_expel' && isset($snapshot['players'][$targetPlayerId])) {
            $snapshot['players'][$targetPlayerId]['status'] = 'conceded';
            if (is_string($payload['concededAt'] ?? null)) {
                $snapshot['players'][$targetPlayerId]['concededAt'] = $payload['concededAt'];
            }
        }

        if (is_array($payload['turn'] ?? null)) {
            $snapshot['turn'] = $payload['turn'];
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeLifeChanged(array &$snapshot, array $payload): void
    {
        $playerId = is_string($payload['playerId'] ?? null) ? trim($payload['playerId']) : '';
        if ($playerId === '' || !isset($snapshot['players'][$playerId])) {
            return;
        }
        if (array_key_exists('life', $payload)) {
            $snapshot['players'][$playerId]['life'] = (int) $payload['life'];

            return;
        }
        if (array_key_exists('value', $payload)) {
            $snapshot['players'][$playerId]['life'] = (int) $payload['value'];

            return;
        }
        if (array_key_exists('delta', $payload)) {
            $snapshot['players'][$playerId]['life'] = (int) ($snapshot['players'][$playerId]['life'] ?? 0) + (int) $payload['delta'];
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeTurnChanged(array &$snapshot, array $payload): void
    {
        if (is_array($payload['turn'] ?? null)) {
            $snapshot['turn'] = $payload['turn'];

            return;
        }

        $turn = is_array($snapshot['turn'] ?? null) ? $snapshot['turn'] : [];
        foreach (['activePlayerId', 'phase', 'step'] as $field) {
            if (array_key_exists($field, $payload)) {
                $turn[$field] = $payload[$field];
            }
        }
        if (array_key_exists('number', $payload)) {
            $turn['number'] = (int) $payload['number'];
        }
        $snapshot['turn'] = $turn;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCardTapped(array &$snapshot, array $payload): void
    {
        $card =& $this->locateCard($snapshot, (string) ($payload['instanceId'] ?? ''));
        if (!is_array($card)) {
            return;
        }
        if (array_key_exists('tapped', $payload)) {
            $card['tapped'] = ($payload['tapped'] ?? false) === true;
        }
        if (array_key_exists('rotation', $payload)) {
            $card['rotation'] = (int) $payload['rotation'];
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeBattlefieldUntapAll(array &$snapshot, array $payload): void
    {
        $instanceIds = $this->stringList($payload['instanceIds'] ?? []);
        if ($instanceIds !== []) {
            foreach ($instanceIds as $instanceId) {
                $card =& $this->locateCard($snapshot, $instanceId);
                if (is_array($card) && ($card['zone'] ?? null) === 'battlefield') {
                    $card['tapped'] = false;
                    $card['rotation'] = 0;
                }
                unset($card);
            }

            return;
        }

        $playerId = is_string($payload['playerId'] ?? null) ? trim($payload['playerId']) : '';
        if ($playerId === '') {
            return;
        }

        foreach (is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [] as $battlefieldPlayerId => &$player) {
            if (!is_array($player)) {
                continue;
            }
            if (!is_array($player['zones']['battlefield'] ?? null)) {
                continue;
            }
            $battlefield =& $player['zones']['battlefield'];
            foreach ($battlefield as &$card) {
                if (!is_array($card)) {
                    continue;
                }
                $controllerId = is_string($card['controllerId'] ?? null) && trim($card['controllerId']) !== ''
                    ? trim($card['controllerId'])
                    : (string) $battlefieldPlayerId;
                if ($controllerId !== $playerId) {
                    continue;
                }
                $card['tapped'] = false;
                $card['rotation'] = 0;
            }
            unset($card, $battlefield);
        }
        unset($player);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCardPositionChanged(array &$snapshot, array $payload): void
    {
        $position = is_array($payload['position'] ?? null) ? $payload['position'] : null;
        if ($position === null) {
            return;
        }
        $card =& $this->locateCard($snapshot, (string) ($payload['instanceId'] ?? ''));
        if (!is_array($card)) {
            return;
        }
        $card['position'] = $position;
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCardsPositionChanged(array &$snapshot, array $payload): void
    {
        foreach (array_values(array_filter($payload['positions'] ?? [], static fn (mixed $entry): bool => is_array($entry))) as $entry) {
            $position = is_array($entry['position'] ?? null) ? $entry['position'] : null;
            if ($position === null) {
                continue;
            }
            $card =& $this->locateCard($snapshot, (string) ($entry['instanceId'] ?? ''));
            if (is_array($card)) {
                $card['position'] = $position;
            }
            unset($card);
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCardFaceDownChanged(array &$snapshot, array $payload): void
    {
        $card =& $this->locateCard($snapshot, (string) ($payload['instanceId'] ?? ''));
        if (!is_array($card)) {
            return;
        }
        if (!array_key_exists('faceDown', $payload)) {
            return;
        }
        $faceDown = ($payload['faceDown'] ?? false) === true;
        $card['faceDown'] = $faceDown;
        if ($faceDown) {
            $playerId = is_string($payload['playerId'] ?? null) ? trim($payload['playerId']) : '';
            $card['revealedTo'] = $playerId !== '' ? [$playerId] : [];
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCardRevealed(array &$snapshot, array $payload): void
    {
        $card =& $this->locateCard($snapshot, (string) ($payload['instanceId'] ?? ''));
        if (!is_array($card)) {
            return;
        }

        $revealed = true;
        if (array_key_exists('revealed', $payload)) {
            $revealed = ($payload['revealed'] ?? false) === true;
        }
        if (array_key_exists('hidden', $payload)) {
            $revealed = ($payload['hidden'] ?? false) !== true;
        }

        if (!$revealed) {
            $card['revealedTo'] = [];

            return;
        }

        $viewers = $this->stringList($payload['viewers'] ?? []);
        if ($viewers === [] && is_string($payload['to'] ?? null)) {
            $viewers = $this->targetsFromVisibility($snapshot, $payload['to']);
        }
        $card['revealedTo'] = $viewers !== [] ? $viewers : ['all'];
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeCardControllerChanged(array &$snapshot, array $payload): void
    {
        $controllerId = is_string($payload['controllerId'] ?? null) && trim($payload['controllerId']) !== ''
            ? trim($payload['controllerId'])
            : (is_string($payload['targetPlayerId'] ?? null) ? trim($payload['targetPlayerId']) : '');
        if ($controllerId === '') {
            return;
        }
        $card =& $this->locateCard($snapshot, (string) ($payload['instanceId'] ?? ''));
        if (!is_array($card)) {
            return;
        }
        $card['controllerId'] = $controllerId;
        $this->rebuildLoc($snapshot);
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
        if (is_array($payload['counters'] ?? null)) {
            $card['counters'] = $payload['counters'];
            foreach (['power', 'toughness'] as $field) {
                if (array_key_exists($field, $payload)) {
                    $card[$field] = $payload[$field];
                }
            }
            return;
        }
        $counter = is_string($payload['counter'] ?? null) ? trim($payload['counter']) : '';
        if ($counter === '' && is_string($payload['key'] ?? null)) {
            $counter = trim($payload['key']);
        }
        if ($counter === '') {
            return;
        }
        $counters = is_array($card['counters'] ?? null) ? $card['counters'] : [];
        $value = max(0, (int) ($payload['value'] ?? 0));
        if (($payload['remove'] ?? false) === true) {
            unset($counters[$counter]);
        } else {
            $counters[$counter] = $value;
        }
        $card['counters'] = $counters;
        foreach (['power', 'toughness'] as $field) {
            if (array_key_exists($field, $payload)) {
                $card[$field] = $payload[$field];
            }
        }
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
    private function applyRuntimeCardFaceChanged(array &$snapshot, array $payload): void
    {
        $rawFaceIndex = $payload['activeFaceIndex'] ?? $payload['faceIndex'] ?? null;
        if (!is_numeric($rawFaceIndex)) {
            return;
        }
        $card =& $this->locateCard($snapshot, (string) ($payload['instanceId'] ?? ''));
        if (!is_array($card)) {
            return;
        }
        $card['activeFaceIndex'] = max(0, (int) $rawFaceIndex);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeArrowCreated(array &$snapshot, GameEvent $event, array $payload): void
    {
        $id = $this->runtimeRelationId($event, $payload, 'arrow');
        $fromInstanceId = is_string($payload['fromInstanceId'] ?? null) ? trim($payload['fromInstanceId']) : '';
        $toInstanceId = is_string($payload['toInstanceId'] ?? null) ? trim($payload['toInstanceId']) : '';
        if ($id === '' || $fromInstanceId === '' || $toInstanceId === '') {
            return;
        }

        $ownerId = is_string($payload['ownerId'] ?? null) && trim($payload['ownerId']) !== ''
            ? trim($payload['ownerId'])
            : ($event->createdBy()?->id() ?? null);
        $relation = [
            'id' => $id,
            'fromInstanceId' => $fromInstanceId,
            'toInstanceId' => $toInstanceId,
            'color' => is_string($payload['color'] ?? null) && trim($payload['color']) !== '' ? trim($payload['color']) : 'yellow',
            'createdAt' => is_string($payload['createdAt'] ?? null) && trim($payload['createdAt']) !== ''
                ? trim($payload['createdAt'])
                : $event->createdAt()->format(DATE_ATOM),
        ];
        if (is_string($ownerId) && $ownerId !== '') {
            $relation['ownerId'] = $ownerId;
        }
        $this->upsertRuntimeRelation($snapshot, 'arrows', $relation);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeAttachmentCreated(array &$snapshot, GameEvent $event, array $payload): void
    {
        $id = $this->runtimeRelationId($event, $payload, 'attachment');
        $equipmentInstanceId = is_string($payload['equipmentInstanceId'] ?? null) ? trim($payload['equipmentInstanceId']) : '';
        $attachedToInstanceId = is_string($payload['attachedToInstanceId'] ?? null) ? trim($payload['attachedToInstanceId']) : '';
        if ($id === '' || $equipmentInstanceId === '' || $attachedToInstanceId === '') {
            return;
        }

        $ownerId = is_string($payload['ownerId'] ?? null) && trim($payload['ownerId']) !== ''
            ? trim($payload['ownerId'])
            : ($event->createdBy()?->id() ?? null);
        $relation = [
            'id' => $id,
            'equipmentInstanceId' => $equipmentInstanceId,
            'attachedToInstanceId' => $attachedToInstanceId,
            'createdAt' => is_string($payload['createdAt'] ?? null) && trim($payload['createdAt']) !== ''
                ? trim($payload['createdAt'])
                : $event->createdAt()->format(DATE_ATOM),
        ];
        if (is_string($ownerId) && $ownerId !== '') {
            $relation['ownerId'] = $ownerId;
        }
        $snapshot['attachments'] = array_values(array_filter(
            is_array($snapshot['attachments'] ?? null) ? $snapshot['attachments'] : [],
            static fn (mixed $attachment): bool => !is_array($attachment)
                || ($attachment['equipmentInstanceId'] ?? null) !== $equipmentInstanceId,
        ));
        $this->upsertRuntimeRelation($snapshot, 'attachments', $relation);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeAttachmentRemoved(array &$snapshot, array $payload): void
    {
        $id = is_string($payload['id'] ?? null) ? trim($payload['id']) : '';
        $equipmentInstanceId = is_string($payload['equipmentInstanceId'] ?? null) ? trim($payload['equipmentInstanceId']) : '';
        if ($id === '' && $equipmentInstanceId === '') {
            return;
        }

        $snapshot['attachments'] = array_values(array_filter(
            is_array($snapshot['attachments'] ?? null) ? $snapshot['attachments'] : [],
            static fn (mixed $attachment): bool => !is_array($attachment)
                || (
                    ($id === '' || ($attachment['id'] ?? null) !== $id)
                    && ($equipmentInstanceId === '' || ($attachment['equipmentInstanceId'] ?? null) !== $equipmentInstanceId)
                ),
        ));
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function applyRuntimeRelationRemoved(array &$snapshot, string $key, array $payload): void
    {
        $id = is_string($payload['id'] ?? null) ? trim($payload['id']) : '';
        if ($id === '') {
            return;
        }
        $snapshot[$key] = array_values(array_filter(
            is_array($snapshot[$key] ?? null) ? $snapshot[$key] : [],
            static fn (mixed $relation): bool => !is_array($relation) || ($relation['id'] ?? null) !== $id,
        ));
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function runtimeRelationId(GameEvent $event, array $payload, string $prefix): string
    {
        if (is_string($payload['id'] ?? null) && trim($payload['id']) !== '') {
            return trim($payload['id']);
        }
        $clientActionId = $event->clientActionId();

        return is_string($clientActionId) && trim($clientActionId) !== '' ? $prefix.'-'.trim($clientActionId) : '';
    }

    /**
     * @param array<string,mixed> $relation
     */
    private function upsertRuntimeRelation(array &$snapshot, string $key, array $relation): void
    {
        $id = is_string($relation['id'] ?? null) ? $relation['id'] : '';
        if ($id === '') {
            return;
        }
        $relations = array_values(array_filter(
            is_array($snapshot[$key] ?? null) ? $snapshot[$key] : [],
            static fn (mixed $candidate): bool => !is_array($candidate) || ($candidate['id'] ?? null) !== $id,
        ));
        $relations[] = $relation;
        $snapshot[$key] = $relations;
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
                foreach (['power', 'toughness'] as $field) {
                    if (array_key_exists($field, $operation)) {
                        $card[$field] = $operation[$field];
                    }
                }
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
        if ($sourceZone === 'battlefield' && $targetZone !== 'battlefield') {
            $this->resetBattlefieldExitCard($card, $targetPlayerId);
            $this->pruneBattlefieldRelationsForMovedInstance($snapshot, $instanceId);
        }
        if (($move['evaporates'] ?? false) === true || (($card['isToken'] ?? false) === true && $sourceZone === 'battlefield' && $targetZone !== 'battlefield')) {
            return;
        }
        if ($targetZone === 'battlefield' && array_key_exists('faceDown', $move)) {
            $card['faceDown'] = ($move['faceDown'] ?? false) === true;
            if ($card['faceDown']) {
                $viewerId = $sourcePlayerId !== '' ? $sourcePlayerId : $targetPlayerId;
                $card['revealedTo'] = $viewerId !== '' ? [$viewerId] : [];
            }
        }
        if ($targetZone === 'battlefield' && is_array($move['position'] ?? null)) {
            $card['position'] = $move['position'];
        }
        $this->insertCard($snapshot, $targetPlayerId, $targetZone, $card, $targetIndex);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function resetBattlefieldExitCard(array &$card, string $targetPlayerId): void
    {
        $ownerId = is_string($card['ownerId'] ?? null) && trim($card['ownerId']) !== ''
            ? trim($card['ownerId'])
            : $targetPlayerId;
        if ($ownerId !== '') {
            $card['controllerId'] = $ownerId;
        }
        $card['tapped'] = false;
        $card['rotation'] = 0;
        $card['faceDown'] = false;
        $card['revealedTo'] = [];
        $card['counters'] = [];
        $card['power'] = $this->gameplayStat($card['defaultPower'] ?? null);
        $card['toughness'] = $this->gameplayStat($card['defaultToughness'] ?? null);
        $card['loyalty'] = $this->gameplayStat($card['defaultLoyalty'] ?? null);
        $card['defense'] = $this->gameplayStat($card['defaultDefense'] ?? null);
        $card['saga'] = null;
        $card['activeFaceIndex'] = 0;
        unset($card['position']);
    }

    private function gameplayStat(mixed $value): int|string|null
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_int($value)) {
            return $value;
        }
        if (is_float($value)) {
            return (int) $value;
        }
        if (is_string($value) && is_numeric($value)) {
            return (int) $value;
        }

        $printed = is_string($value) ? trim($value) : (string) $value;

        return in_array($printed, ['*', 'X', 'x', '?', '∞'], true) ? 0 : $printed;
    }

    private function pruneBattlefieldRelationsForMovedInstance(array &$snapshot, string $instanceId): void
    {
        if ($instanceId === '') {
            return;
        }
        $snapshot['arrows'] = array_values(array_filter(
            is_array($snapshot['arrows'] ?? null) ? $snapshot['arrows'] : [],
            static fn (mixed $arrow): bool => !is_array($arrow)
                || (
                    (string) ($arrow['fromInstanceId'] ?? $arrow['sourceId'] ?? '') !== $instanceId
                    && (string) ($arrow['toInstanceId'] ?? $arrow['targetId'] ?? '') !== $instanceId
                ),
        ));
        $snapshot['attachments'] = array_values(array_filter(
            is_array($snapshot['attachments'] ?? null) ? $snapshot['attachments'] : [],
            static fn (mixed $attachment): bool => !is_array($attachment)
                || (
                    (string) ($attachment['equipmentInstanceId'] ?? $attachment['sourceId'] ?? '') !== $instanceId
                    && (string) ($attachment['attachedToInstanceId'] ?? $attachment['targetId'] ?? '') !== $instanceId
                ),
        ));
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

        $libraryOps = $this->libraryOps();
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

    private function libraryOps(): GameLibraryOps
    {
        return $this->libraryOps ?? new GameLibraryOps();
    }

    /**
     * @param array<string,mixed>       $player
     * @param list<array<string,mixed>> $cards
     */
    private function putRuntimeCardsOnLibraryBottom(array &$player, string $playerId, array $cards): void
    {
        if ($cards === []) {
            return;
        }
        $this->libraryOps()->ensurePlayer($player);
        $prepared = [];
        foreach ($cards as $card) {
            if (!is_array($card)) {
                continue;
            }
            $card['zone'] = 'library';
            $card['ownerId'] = (string) ($card['ownerId'] ?? $playerId);
            $card['controllerId'] = (string) ($card['controllerId'] ?? $playerId);
            unset($card['position']);
            $prepared[] = $card;
        }
        if ($prepared === []) {
            return;
        }
        $player['zones']['library'] = [...$prepared, ...$player['zones']['library']];
    }

    /**
     * @param array<string,mixed>       $player
     * @param list<array<string,mixed>> $cards
     */
    private function appendRuntimeCardsToZone(array &$player, string $playerId, string $zone, array $cards): void
    {
        $player['zones'][$zone] = is_array($player['zones'][$zone] ?? null) ? array_values($player['zones'][$zone]) : [];
        foreach ($cards as $card) {
            if (!is_array($card)) {
                continue;
            }
            $card['zone'] = $zone;
            $card['ownerId'] = (string) ($card['ownerId'] ?? $playerId);
            $card['controllerId'] = (string) ($card['controllerId'] ?? $playerId);
            if ($zone !== 'battlefield') {
                unset($card['position']);
            }
            $player['zones'][$zone][] = $card;
        }
    }

    /**
     * @param list<array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function shuffleCardsWithSeed(array $cards, int $seed): array
    {
        $random = $seed === 0 ? 0x6d2b79f5 : $seed;
        for ($index = count($cards) - 1; $index > 0; --$index) {
            $random = (int) ((1664525 * $random + 1013904223) % 4294967296);
            $swap = $random % ($index + 1);
            [$cards[$index], $cards[$swap]] = [$cards[$swap], $cards[$index]];
        }

        return array_values($cards);
    }

    private function uint32Value(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value >= 0 && $value <= 4294967295 ? $value : null;
        }
        if (is_float($value) && floor($value) === $value) {
            $intValue = (int) $value;

            return $intValue >= 0 && $intValue <= 4294967295 ? $intValue : null;
        }
        if (is_string($value) && preg_match('/^\d+$/', $value) === 1) {
            $intValue = (int) $value;

            return $intValue >= 0 && $intValue <= 4294967295 ? $intValue : null;
        }

        return null;
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
