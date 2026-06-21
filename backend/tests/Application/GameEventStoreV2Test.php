<?php

namespace App\Tests\Application;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameRandomizer;
use App\Application\Game\GameEventReplayService;
use App\Application\Game\GameEventStoreV2;
use App\Application\Game\GameMulliganEventTypes;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Game\GameSnapshotCompact;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use PHPUnit\Framework\TestCase;

class GameEventStoreV2Test extends TestCase
{
    public function testMulliganCompactEventTypesAreDeclared(): void
    {
        self::assertSame([
            'mulligan.started',
            'mulligan.player_took_mulligan',
            'mulligan.hand_drawn',
            'mulligan.player_kept',
            'mulligan.cards_bottomed',
            'mulligan.scry_available',
            'mulligan.scry_confirmed',
            'mulligan.player_ready',
            'mulligan.completed',
            'game.phase_changed',
        ], GameMulliganEventTypes::all());
    }

    public function testReplayRebuildsExactRuntimeStateFromPersistedLegacySnapshotAndEvents(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'library' => [
                $this->card('library-2', 'Second Draw', 'library'),
                $this->card('library-1', 'Top Draw', 'library'),
            ],
            'battlefield' => [
                $this->card('battlefield-1', 'Bear', 'battlefield'),
            ],
        ]));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $drawEvent = $handler->apply($runtimeGame, 'library.draw', ['playerId' => $actor->id()], $actor, 'draw-action');
        $tapEvent = $handler->apply($runtimeGame, 'card.tapped', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'tapped' => true,
        ], $actor, 'tap-action');
        $expectedSnapshot = $runtimeGame->snapshot();

        $rebuiltGame = new Game(new Room($actor), $baseSnapshot);
        $store = $this->eventStore($handler, $flags);
        $rebuiltSnapshot = $store->rebuildSnapshot($rebuiltGame, null, [$drawEvent, $tapEvent]);

        self::assertSame($this->comparableSnapshot($expectedSnapshot), $this->comparableSnapshot($rebuiltSnapshot));
        self::assertSame(3, $rebuiltSnapshot['version']);
    }

    public function testReplayCanRecoverFromCompactSnapshotPlusLaterEvents(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $mapper = new CompactGameCardStateMapper();
        $baseSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'library' => [
                $this->card('library-2', 'Second Draw', 'library'),
                $this->card('library-1', 'Top Draw', 'library'),
            ],
            'battlefield' => [
                $this->card('battlefield-1', 'Bear', 'battlefield'),
            ],
        ]));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $drawEvent = $handler->apply($runtimeGame, 'library.draw', ['playerId' => $actor->id()], $actor, 'draw-action');
        $snapshotV2 = $runtimeGame->snapshot();
        $store = $this->eventStore($handler, $flags);
        $compactSnapshot = $mapper->compactSnapshot($snapshotV2, $runtimeGame->id(), $runtimeGame->status());
        $compactRecord = new GameSnapshotCompact($runtimeGame, 2, $compactSnapshot, $store->checksum($compactSnapshot));

        $tapEvent = $handler->apply($runtimeGame, 'card.tapped', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'tapped' => true,
        ], $actor, 'tap-action');
        $expectedSnapshot = $runtimeGame->snapshot();

        $recoveredGame = new Game(new Room($actor), $baseSnapshot);
        $recoveredSnapshot = $store->rebuildSnapshot($recoveredGame, $compactRecord, [$drawEvent, $tapEvent]);

        self::assertSame($this->comparableSnapshot($expectedSnapshot), $this->comparableSnapshot($recoveredSnapshot));
        self::assertSame(3, $recoveredSnapshot['version']);
    }

    public function testPersistCompactSnapshotStoresStateWithoutStaticCardPayload(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $flags = new GameplayV2Flags(true, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $runtimeSnapshot = $handler->normalizeSnapshot($this->baseSnapshot($actor->id(), [
            'battlefield' => [[
                ...$this->card('battlefield-1', 'Bear', 'battlefield'),
                'oracleText' => 'Draw a card.',
                'imageUris' => ['normal' => 'https://example.test/bear.jpg'],
                'cardFaces' => [['name' => 'Face A']],
            ]],
        ]));
        $runtimeSnapshot['version'] = 5;
        $game = new Game(new Room($actor), $runtimeSnapshot);
        $snapshotRepository = $this->createMock(EntityRepository::class);
        $snapshotRepository->expects(self::once())->method('findOneBy')->with(['game' => $game], ['version' => 'DESC'])->willReturn(null);
        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->method('getRepository')->with(GameSnapshotCompact::class)->willReturn($snapshotRepository);
        $entityManager->expects(self::once())
            ->method('persist')
            ->with(self::callback(function (mixed $record): bool {
                if (!$record instanceof GameSnapshotCompact) {
                    return false;
                }

                $encoded = json_encode($record->snapshot(), JSON_THROW_ON_ERROR);

                self::assertStringNotContainsString('oracleText', $encoded);
                self::assertStringNotContainsString('imageUris', $encoded);
                self::assertStringNotContainsString('cardFaces', $encoded);

                return true;
            }));
        $registry = $this->createMock(ManagerRegistry::class);
        $registry->expects(self::once())->method('getManagerForClass')->with(Game::class)->willReturn($entityManager);
        $store = new GameEventStoreV2(
            $registry,
            $handler,
            new CompactGameCardStateMapper(),
            new GameEventReplayService(),
            $flags,
            null,
            1,
            1,
        );

        $record = $store->persistCompactSnapshotIfDue($entityManager, $game, $runtimeSnapshot);

        self::assertInstanceOf(GameSnapshotCompact::class, $record);
        self::assertSame(5, $record->version());
    }

    public function testMulliganReplayRebuildsLondonTakeKeepAndBottomFromCompactEvents(): void
    {
        $actor = new User('mulligan-owner@example.test', 'Mulligan Owner');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'mulligan.take,mulligan.keep');
        $handler = new GameCommandHandler(
            randomizer: new class() extends GameRandomizer {
                public function shuffle(array $items): array
                {
                    return array_reverse($items);
                }
            },
            flagsV2: $flags,
        );
        $baseSnapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 10, 'library'),
        ], Room::MULLIGAN_LONDON, false, 0));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $take = $handler->apply($runtimeGame, 'mulligan.take', [], $actor, 'mulligan-take-1');
        $handIds = $this->zoneIds($handler->normalizeSnapshot((new CompactGameCardStateMapper())->hydrateSnapshot($runtimeGame->snapshot())), $actor->id(), 'hand');
        $keep = $handler->apply($runtimeGame, 'mulligan.keep', [
            'bottomCardInstanceIds' => [$handIds[0]],
        ], $actor, 'mulligan-keep-1');
        $expected = $handler->normalizeSnapshot((new CompactGameCardStateMapper())->hydrateSnapshot($runtimeGame->snapshot()));

        $rebuilt = $this->eventStore($handler, $flags)->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$take, $keep]);

        self::assertSame($this->comparableSnapshot($expected), $this->comparableSnapshot($rebuilt));
        self::assertSame('PLAYING', $rebuilt['gamePhase']);
        self::assertSame(count($this->allZoneIds($rebuilt)), count(array_unique($this->allZoneIds($rebuilt))));
    }

    public function testMulliganReplayRebuildsVancouverScryToBottom(): void
    {
        $actor = new User('vancouver-owner@example.test', 'Vancouver Owner');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'mulligan.keep,mulligan.scry_confirm');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => $this->cards('hand', 6, 'hand'),
            'library' => $this->cards('library', 2, 'library'),
        ], Room::MULLIGAN_VANCOUVER, false, 1));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $keep = $handler->apply($runtimeGame, 'mulligan.keep', [], $actor, 'vancouver-keep-1');
        $scry = $handler->apply($runtimeGame, 'mulligan.scry_confirm', ['destination' => 'BOTTOM'], $actor, 'vancouver-scry-1');
        $expected = $handler->normalizeSnapshot((new CompactGameCardStateMapper())->hydrateSnapshot($runtimeGame->snapshot()));
        $store = $this->eventStore($handler, $flags);

        $rebuilt = $store->rebuildSnapshot(new Game(new Room($actor), $baseSnapshot), null, [$keep, $scry]);
        $metrics = $store->consumeLastReplayMetrics();

        self::assertSame($this->comparableSnapshot($expected), $this->comparableSnapshot($rebuilt));
        self::assertSame(['library-2', 'library-1'], $this->libraryProjectionIds($rebuilt, $actor->id()));
        self::assertSame(2, $metrics['mulligan.replay_event_count'] ?? null);
        self::assertArrayHasKey('mulligan.replay_ms', $metrics);
    }

    public function testMulliganEventPayloadsAreCompactAndPublicPayloadIsSanitized(): void
    {
        $actor = new User('payload-owner@example.test', 'Payload Owner');
        $flags = new GameplayV2Flags(true, false, false, true, false, true, 'mulligan.keep');
        $handler = new GameCommandHandler(flagsV2: $flags);
        $baseSnapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => [[
                ...$this->card('hand-1', 'Private Spell', 'hand'),
                'oracleText' => 'Private text',
                'imageUris' => ['normal' => 'https://example.test/private.jpg'],
                'cardFaces' => [['name' => 'Private Face']],
            ]],
            'library' => $this->cards('library', 1, 'library'),
        ], Room::MULLIGAN_LONDON, false, 1));
        $runtimeGame = new Game(new Room($actor), $baseSnapshot);

        $event = $handler->apply($runtimeGame, 'mulligan.keep', [
            'bottomCardInstanceIds' => ['hand-1'],
        ], $actor, 'payload-keep-1');
        $payloadJson = json_encode($event->payload(), JSON_THROW_ON_ERROR);
        $publicJson = json_encode($event->toArray()['payload'], JSON_THROW_ON_ERROR);
        $metrics = $handler->consumeLastCommandMetrics();

        self::assertStringContainsString('mulligan.cards_bottomed', $payloadJson);
        self::assertStringContainsString('hand-1', $payloadJson);
        self::assertStringNotContainsString('oracleText', $payloadJson);
        self::assertStringNotContainsString('imageUris', $payloadJson);
        self::assertStringNotContainsString('cardFaces', $payloadJson);
        self::assertStringNotContainsString('hand-1', $publicJson);
        self::assertStringNotContainsString('Private Spell', $publicJson);
        self::assertArrayHasKey('mulligan.event_payload_bytes', $metrics);
        self::assertArrayHasKey('mulligan.public_event_payload_bytes', $metrics);
        self::assertArrayHasKey('mulligan.snapshot_compact_bytes', $metrics);
    }

    public function testMulliganCompactSnapshotDoesNotContainStaticPayloadInRuntimeInstances(): void
    {
        $actor = new User('compact-mulligan@example.test', 'Compact Mulligan');
        $handler = new GameCommandHandler();
        $snapshot = $handler->normalizeSnapshot($this->mulliganSnapshot($actor, [
            'hand' => [[
                ...$this->card('hand-1', 'Static Heavy', 'hand'),
                'oracleText' => 'Rules text',
                'imageUris' => ['normal' => 'https://example.test/static-heavy.jpg'],
                'cardFaces' => [['name' => 'Face']],
            ]],
        ]));
        $compact = (new CompactGameCardStateMapper())->compactSnapshot($snapshot, 'game-mulligan-compact', Game::STATUS_ACTIVE);
        unset($compact['cardCatalog']);
        $encoded = json_encode($compact, JSON_THROW_ON_ERROR);

        self::assertSame('MULLIGAN', $compact['gamePhase']);
        self::assertArrayHasKey('mulligan', $compact);
        self::assertStringNotContainsString('oracleText', $encoded);
        self::assertStringNotContainsString('imageUris', $encoded);
        self::assertStringNotContainsString('cardFaces', $encoded);
    }

    private function eventStore(
        GameCommandHandler $handler,
        GameplayV2Flags $flags,
        int $snapshotEveryEvents = 25,
        int $snapshotEverySeconds = 30,
    ): GameEventStoreV2 {
        $registry = $this->createMock(ManagerRegistry::class);

        return new GameEventStoreV2(
            $registry,
            $handler,
            new CompactGameCardStateMapper(),
            new GameEventReplayService(),
            $flags,
            null,
            $snapshotEveryEvents,
            $snapshotEverySeconds,
        );
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function comparableSnapshot(array $snapshot): array
    {
        unset($snapshot['updatedAt']);
        $snapshot['eventLog'] = array_values(array_map(static function (array $entry): array {
            unset($entry['id'], $entry['createdAt']);

            return $entry;
        }, is_array($snapshot['eventLog'] ?? null) ? $snapshot['eventLog'] : []));

        return $this->canonicalize($snapshot);
    }

    private function canonicalize(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        if (array_is_list($value)) {
            return array_values(array_map([$this, 'canonicalize'], $value));
        }

        foreach ($value as $key => $item) {
            if ($item === null) {
                unset($value[$key]);
                continue;
            }
            if ($key === 'oracleText' && $item === '') {
                unset($value[$key]);
                continue;
            }
            if ($key === 'timer' && $item === []) {
                unset($value[$key]);
                continue;
            }
            if ($key === 'visibility'
                && $item === ['strategy' => 'legacy_revealed_to', 'ready' => false, 'byViewer' => []]) {
                unset($value[$key]);
                continue;
            }

            $value[$key] = $this->canonicalize($item);
        }

        ksort($value);

        return $value;
    }

    /**
     * @param array<string,list<array<string,mixed>>> $zones
     *
     * @return array<string,mixed>
     */
    private function baseSnapshot(string $actorId, array $zones): array
    {
        return [
            'version' => 1,
            'ownerId' => $actorId,
            'players' => [
                $actorId => [
                    'user' => ['id' => $actorId, 'email' => $actorId, 'displayName' => $actorId, 'roles' => []],
                    'life' => 40,
                    'zones' => [
                        'library' => $zones['library'] ?? [],
                        'hand' => $zones['hand'] ?? [],
                        'battlefield' => $zones['battlefield'] ?? [],
                        'graveyard' => $zones['graveyard'] ?? [],
                        'exile' => $zones['exile'] ?? [],
                        'command' => $zones['command'] ?? [],
                    ],
                    'commanderDamage' => [],
                    'counters' => [],
                ],
            ],
            'turn' => ['activePlayerId' => $actorId, 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:00+00:00',
        ];
    }

    /**
     * @param array<string,list<array<string,mixed>>> $zones
     *
     * @return array<string,mixed>
     */
    private function mulliganSnapshot(User $actor, array $zones, string $rule = Room::MULLIGAN_LONDON, bool $firstMulliganFree = true, int $mulligansTaken = 0): array
    {
        $state = (new GameCommandHandler())->normalizeSnapshot($this->baseSnapshot($actor->id(), $zones));
        foreach (['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] as $zone) {
            if (!is_array($state['players'][$actor->id()]['zones'][$zone] ?? null)) {
                continue;
            }
            foreach ($state['players'][$actor->id()]['zones'][$zone] as &$card) {
                if (!is_array($card)) {
                    continue;
                }
                $card['ownerId'] = $actor->id();
                $card['controllerId'] = $actor->id();
            }
            unset($card);
        }
        $state['gamePhase'] = 'MULLIGAN';
        $state['mulligan'] = ['rule' => $rule, 'firstMulliganFree' => $firstMulliganFree];
        $state['players'][$actor->id()]['mulligan'] = [
            'rule' => $rule,
            'firstMulliganFree' => $firstMulliganFree,
            'mulligansTaken' => $mulligansTaken,
            'effectiveMulligans' => $firstMulliganFree ? max(0, $mulligansTaken - 1) : $mulligansTaken,
            'drawCount' => $rule === Room::MULLIGAN_PARIS ? max(0, 7 - $mulligansTaken) : 7,
            'bottomSelectionCount' => $rule === Room::MULLIGAN_LONDON ? ($firstMulliganFree ? max(0, $mulligansTaken - 1) : $mulligansTaken) : 0,
            'finalHandSize' => $rule === Room::MULLIGAN_LONDON ? 7 : max(0, 7 - ($firstMulliganFree ? max(0, $mulligansTaken - 1) : $mulligansTaken)),
            'needsBottomSelection' => $rule === Room::MULLIGAN_LONDON && ($firstMulliganFree ? max(0, $mulligansTaken - 1) : $mulligansTaken) > 0,
            'bottomOrderMode' => $rule === Room::MULLIGAN_LONDON ? 'CLIENT' : 'NONE',
            'needsScryAfterKeep' => $rule === Room::MULLIGAN_VANCOUVER && $mulligansTaken > 0,
            'canTakeAnotherMulligan' => true,
            'status' => 'DECIDING',
            'ready' => false,
            'scryCardInstanceId' => null,
        ];

        return $state;
    }

    /**
     * @return list<string>
     */
    private function zoneIds(array $snapshot, string $playerId, string $zone): array
    {
        return array_values(array_map(
            static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
            is_array($snapshot['players'][$playerId]['zones'][$zone] ?? null) ? $snapshot['players'][$playerId]['zones'][$zone] : [],
        ));
    }

    /**
     * @return list<string>
     */
    private function allZoneIds(array $snapshot): array
    {
        $ids = [];
        foreach (is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [] as $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }
            foreach ($player['zones'] as $cards) {
                foreach (is_array($cards) ? $cards : [] as $card) {
                    if (is_array($card) && is_string($card['instanceId'] ?? null)) {
                        $ids[] = $card['instanceId'];
                    }
                }
            }
        }

        return $ids;
    }

    /**
     * @return list<string>
     */
    private function libraryProjectionIds(array $snapshot, string $playerId): array
    {
        return array_values(array_map(
            static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
            (new \App\Application\Game\GameLibraryOps())->projectionOrderCards($snapshot['players'][$playerId] ?? []),
        ));
    }

    /**
     * @return array<string,mixed>
     */
    private function card(string $instanceId, string $name, string $zone): array
    {
        return [
            'instanceId' => $instanceId,
            'ownerId' => 'owner@example.test',
            'controllerId' => 'owner@example.test',
            'name' => $name,
            'zone' => $zone,
            'scryfallId' => sprintf('%s-0000-0000-0000-000000000000', substr(md5($instanceId), 0, 8)),
            'typeLine' => 'Creature',
            'oracleText' => '',
            'imageUris' => ['normal' => 'https://example.test/card.jpg'],
            'cardFaces' => [],
            'isToken' => false,
            'tapped' => false,
            'counters' => [],
            'position' => null,
            'revealedTo' => [],
            'faceDown' => false,
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function cards(string $prefix, int $count, string $zone): array
    {
        $cards = [];
        for ($index = 1; $index <= $count; ++$index) {
            $cards[] = $this->card(sprintf('%s-%d', $prefix, $index), sprintf('%s %d', $prefix, $index), $zone);
        }

        return $cards;
    }
}
