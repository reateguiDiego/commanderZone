<?php

namespace App\Tests\Application;

use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameRandomizer;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\User\User;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class GameCommandHandlerV2Test extends TestCase
{
    #[DataProvider('scenarioProvider')]
    public function testSupportedV2CommandsMatchLegacyVisibleState(
        string $type,
        array $rawSnapshot,
        array $payload,
        ?GameRandomizer $randomizer = null,
    ): void {
        $actor = new User('owner@example.test', 'Owner');
        $otherPlayerId = 'other-player-id';
        $rawSnapshot = $this->replaceIds($rawSnapshot, [
            'owner@example.test' => $actor->id(),
            'other@example.test' => $otherPlayerId,
        ]);
        $payload = $this->replaceIds($payload, [
            'owner@example.test' => $actor->id(),
            'other@example.test' => $otherPlayerId,
        ]);
        $legacyHandler = new GameCommandHandler(randomizer: $randomizer);
        $v2Handler = new GameCommandHandler(
            randomizer: $randomizer,
            flagsV2: new GameplayV2Flags(true, false, false, false),
        );

        $normalizedSnapshot = $legacyHandler->normalizeSnapshot($rawSnapshot);
        $legacyGame = new Game(new Room($actor), $normalizedSnapshot);
        $v2Game = new Game(new Room($actor), $normalizedSnapshot);

        $legacyEvent = $legacyHandler->apply($legacyGame, $type, $payload, $actor, 'legacy-action');
        $v2Event = $v2Handler->apply($v2Game, $type, $payload, $actor, 'v2-action');

        self::assertSame(
            $this->comparableSnapshot($legacyGame->snapshot()),
            $this->comparableSnapshot($v2Game->snapshot()),
            sprintf('V2 snapshot diverged for %s.', $type),
        );
        self::assertSame($legacyEvent->toArray()['type'], $v2Event->toArray()['type']);

        $metrics = $v2Handler->consumeLastCommandMetrics();
        self::assertIsArray($metrics);
        self::assertSame(0, $metrics['full_scan_count'] ?? null, sprintf('V2 full scan detected for %s.', $type));
        self::assertArrayHasKey('command_apply_ms', $metrics);
        self::assertNotNull($v2Handler->consumeLastDirectPatchPayload(), sprintf('Expected direct patch payload for %s.', $type));
    }

    public function testSensitiveFaceDownStatsCommandFallsBackToLegacyRealtimePath(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler(flagsV2: new GameplayV2Flags(true, false, false, false));
        $snapshot = $handler->normalizeSnapshot($this->snapshot($actor->id(), [
            'battlefield' => [[
                ...$this->card('face-down-1', 'Secret Morph', 'battlefield'),
                'faceDown' => true,
            ]],
        ]));
        $game = new Game(new Room($actor), $snapshot);

        $handler->apply($game, 'card.power_toughness.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'face-down-1',
            'power' => 5,
            'toughness' => 5,
        ], $actor);

        self::assertNull($handler->consumeLastDirectPatchPayload());
    }

    /**
     * @return array<string,array{0:string,1:array<string,mixed>,2:array<string,mixed>,3?:GameRandomizer}>
     */
    public static function scenarioProvider(): array
    {
        $ownerId = 'owner@example.test';
        $otherId = 'other@example.test';

        return [
            'life.changed' => [
                'life.changed',
                self::baseSnapshot($ownerId, []),
                ['playerId' => $ownerId, 'delta' => -3],
            ],
            'turn.changed' => [
                'turn.changed',
                self::baseSnapshot($ownerId, [], $otherId),
                ['activePlayerId' => $otherId, 'phase' => 'combat', 'number' => 2],
            ],
            'dice.rolled' => [
                'dice.rolled',
                self::baseSnapshot($ownerId, []),
                ['kind' => 'd20'],
                new class() extends GameRandomizer {
                    public function roll(string $kind): int|string
                    {
                        return 17;
                    }
                },
            ],
            'counter.changed' => [
                'counter.changed',
                self::baseSnapshot($ownerId, []),
                ['scope' => 'player:'.$ownerId, 'key' => 'energy', 'value' => 4],
            ],
            'card.tapped' => [
                'card.tapped',
                self::baseSnapshot($ownerId, [
                    'battlefield' => [self::card('battlefield-1', 'Bear', 'battlefield')],
                ]),
                ['playerId' => $ownerId, 'zone' => 'battlefield', 'instanceId' => 'battlefield-1', 'tapped' => true],
            ],
            'card.counter.changed' => [
                'card.counter.changed',
                self::baseSnapshot($ownerId, [
                    'battlefield' => [self::card('battlefield-1', 'Bear', 'battlefield')],
                ]),
                ['playerId' => $ownerId, 'zone' => 'battlefield', 'instanceId' => 'battlefield-1', 'key' => '+1/+1', 'value' => 2],
            ],
            'card.power_toughness.changed' => [
                'card.power_toughness.changed',
                self::baseSnapshot($ownerId, [
                    'battlefield' => [self::card('battlefield-1', 'Bear', 'battlefield')],
                ]),
                ['playerId' => $ownerId, 'zone' => 'battlefield', 'instanceId' => 'battlefield-1', 'power' => 4, 'toughness' => 5],
            ],
            'card.position.changed' => [
                'card.position.changed',
                self::baseSnapshot($ownerId, [
                    'battlefield' => [self::card('battlefield-1', 'Bear', 'battlefield')],
                ]),
                ['playerId' => $ownerId, 'zone' => 'battlefield', 'instanceId' => 'battlefield-1', 'position' => ['x' => 0.2, 'y' => 0.8, 'unit' => 'ratio']],
            ],
        ];
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

        return $snapshot;
    }

    /**
     * @param array<string,mixed> $value
     * @param array<string,string> $map
     *
     * @return array<string,mixed>
     */
    private function replaceIds(array $value, array $map): array
    {
        $replaced = [];
        foreach ($value as $key => $item) {
            $resolvedKey = is_string($key) ? strtr($key, $map) : $key;
            if (is_array($item)) {
                $replaced[$resolvedKey] = $this->replaceIds($item, $map);
                continue;
            }

            $replaced[$resolvedKey] = is_string($item) ? strtr($item, $map) : $item;
        }

        return $replaced;
    }

    /**
     * @param array<string,list<array<string,mixed>>> $zones
     */
    private function snapshot(string $actorId, array $zones): array
    {
        return self::baseSnapshot($actorId, $zones);
    }

    /**
     * @param array<string,list<array<string,mixed>>> $zones
     *
     * @return array<string,mixed>
     */
    private static function baseSnapshot(string $actorId, array $zones, ?string $otherPlayerId = null): array
    {
        $players = [
            $actorId => self::player($actorId, $zones),
        ];
        if ($otherPlayerId !== null) {
            $players[$otherPlayerId] = self::player($otherPlayerId, []);
        }

        return [
            'version' => 1,
            'ownerId' => $actorId,
            'players' => $players,
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
    private static function player(string $playerId, array $zones): array
    {
        return [
            'user' => ['id' => $playerId, 'email' => $playerId, 'displayName' => $playerId, 'roles' => []],
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
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private static function card(string $instanceId, string $name, string $zone): array
    {
        return [
            'instanceId' => $instanceId,
            'ownerId' => 'owner@example.test',
            'controllerId' => 'owner@example.test',
            'name' => $name,
            'zone' => $zone,
            'power' => 2,
            'toughness' => 2,
            'defaultPower' => 2,
            'defaultToughness' => 2,
            'tapped' => false,
            'counters' => [],
            'position' => ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
        ];
    }
}
