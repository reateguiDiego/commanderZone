<?php

namespace App\Tests\Application;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameEventReplayService;
use App\Application\Game\GameEventStoreV2;
use App\Domain\Game\Game;
use App\Domain\Game\GameSnapshotCompact;
use App\Domain\Room\Room;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use PHPUnit\Framework\TestCase;

class GameEventStoreV2Test extends TestCase
{
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
}
