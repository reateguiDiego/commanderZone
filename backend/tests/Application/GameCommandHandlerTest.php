<?php

namespace App\Tests\Application;

use App\Application\Game\GameCardBaseStatsResolver;
use App\Application\Game\GameCommandHandler;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameCommandHandlerTest extends TestCase
{
    public function testResetsModifiedPowerToughnessWhenCardLeavesBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('card-1', 'Bear', 'battlefield', 9, 9, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'card-1',
        ], $actor);

        $graveyardCard = $game->snapshot()['players'][$actor->id()]['zones']['graveyard'][0];
        self::assertSame(2, $graveyardCard['power']);
        self::assertSame(2, $graveyardCard['toughness']);
    }

    public function testKeepsModifiedPowerToughnessWhenCardMovesToOpponentBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('card-1', 'Bear', 'battlefield', 9, 9, 2, 2),
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'battlefield',
            'targetPlayerId' => $opponent->id(),
            'instanceId' => 'card-1',
        ], $actor);

        $opponentCard = $game->snapshot()['players'][$opponent->id()]['zones']['battlefield'][0];
        self::assertSame(9, $opponentCard['power']);
        self::assertSame(9, $opponentCard['toughness']);
    }

    public function testResetsModifiedPowerToughnessWhenCardEntersBattlefieldFromAnotherZone(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'graveyard' => [
                $this->card('card-1', 'Bear', 'graveyard', 9, 9, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        $battlefieldCard = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame(2, $battlefieldCard['power']);
        self::assertSame(2, $battlefieldCard['toughness']);
    }

    public function testResetsLegacyModifiedPowerToughnessFromCardBaseStats(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    'instanceId' => 'card-1',
                    'scryfallId' => 'bear-scryfall-id',
                    'name' => 'Bear',
                    'zone' => 'battlefield',
                    'power' => 9,
                    'toughness' => 9,
                    'tapped' => false,
                ],
            ],
        ]));
        $resolver = new class extends GameCardBaseStatsResolver {
            public function __construct()
            {
            }

            public function baseStats(array $card): ?array
            {
                return $card['scryfallId'] === 'bear-scryfall-id'
                    ? ['power' => 2, 'toughness' => 2]
                    : null;
            }
        };

        (new GameCommandHandler($resolver))->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'card-1',
        ], $actor);

        $graveyardCard = $game->snapshot()['players'][$actor->id()]['zones']['graveyard'][0];
        self::assertSame(2, $graveyardCard['power']);
        self::assertSame(2, $graveyardCard['toughness']);
    }

    public function testCardBaseStatsResolverWinsOverPollutedSnapshotBaseStats(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    'instanceId' => 'card-1',
                    'scryfallId' => 'bear-scryfall-id',
                    'name' => 'Bear',
                    'zone' => 'battlefield',
                    'power' => 9,
                    'toughness' => 9,
                    'basePower' => 9,
                    'baseToughness' => 9,
                    'tapped' => false,
                ],
            ],
        ]));
        $resolver = new class extends GameCardBaseStatsResolver {
            public function __construct()
            {
            }

            public function baseStats(array $card): ?array
            {
                return $card['scryfallId'] === 'bear-scryfall-id'
                    ? ['power' => 2, 'toughness' => 2]
                    : null;
            }
        };

        (new GameCommandHandler($resolver))->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'card-1',
        ], $actor);

        $graveyardCard = $game->snapshot()['players'][$actor->id()]['zones']['graveyard'][0];
        self::assertSame(2, $graveyardCard['power']);
        self::assertSame(2, $graveyardCard['toughness']);
        self::assertSame(2, $graveyardCard['basePower']);
        self::assertSame(2, $graveyardCard['baseToughness']);
    }

    public function testMovesMultipleCardsToTargetPlayer(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'hand' => [
                $this->card('card-1', 'Bear', 'hand', 2, 2, 2, 2),
                $this->card('card-2', 'Elf', 'hand', 1, 1, 1, 1),
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'cards.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'hand',
            'toZone' => 'battlefield',
            'targetPlayerId' => $opponent->id(),
            'instanceIds' => ['card-1', 'card-2'],
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame([], $snapshot['players'][$actor->id()]['zones']['hand']);
        self::assertSame(
            ['card-1', 'card-2'],
            array_map(
                static fn (array $card): string => $card['instanceId'],
                $snapshot['players'][$opponent->id()]['zones']['battlefield'],
            ),
        );
    }

    public function testDrawManyTakesCardsFromTopOfLibraryInOrder(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
                $this->card('bottom-card', 'Bottom', 'library', 1, 1, 1, 1),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'library.draw_many', [
            'playerId' => $actor->id(),
            'count' => 2,
        ], $actor);

        $zones = $game->snapshot()['players'][$actor->id()]['zones'];
        self::assertSame(['bottom-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $zones['library'],
        ));
        self::assertSame(['top-card', 'second-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $zones['hand'],
        ));
    }

    public function testCommanderCastCounterLogIncludesPreviousAndNextValue(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), []);
        $snapshot['counters'] = [
            'commander:'.$actor->id() => ['casts' => 2],
        ];
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'counter.changed', [
            'scope' => 'commander:'.$actor->id(),
            'key' => 'casts',
            'value' => 3,
        ], $actor);
        $handler->apply($game, 'counter.changed', [
            'scope' => 'commander:'.$actor->id(),
            'key' => 'casts',
            'value' => 2,
        ], $actor);

        self::assertSame([
            'Commander cast count increased from 2 to 3.',
            'Commander cast count decreased from 3 to 2.',
        ], array_map(
            static fn (array $entry): string => $entry['message'],
            $game->snapshot()['eventLog'],
        ));
    }

    public function testCommanderCastCounterCannotGoBelowZeroOrCreateNoopLog(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), []);
        $snapshot['counters'] = [
            'commander:'.$actor->id() => ['casts' => 0],
        ];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'counter.changed', [
            'scope' => 'commander:'.$actor->id(),
            'key' => 'casts',
            'value' => -1,
        ], $actor);

        self::assertSame(0, $game->snapshot()['counters']['commander:'.$actor->id()]['casts']);
        self::assertSame([], $game->snapshot()['eventLog']);
    }

    public function testMovingCardToSameZoneDoesNotCreateLogEntry(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'graveyard' => [
                $this->card('card-1', 'Bear', 'graveyard', 2, 2, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'graveyard',
            'instanceId' => 'card-1',
        ], $actor);

        self::assertSame([], $game->snapshot()['eventLog']);
        self::assertSame(['card-1'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $game->snapshot()['players'][$actor->id()]['zones']['graveyard'],
        ));
    }

    public function testMovedCardCanReturnToTopOrBottomOfLibrary(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('library-top', 'Top', 'library', 1, 1, 1, 1),
            ],
            'graveyard' => [
                $this->card('to-top', 'Top Return', 'graveyard', 1, 1, 1, 1),
                $this->card('to-bottom', 'Bottom Return', 'graveyard', 1, 1, 1, 1),
            ],
        ]));

        $handler = new GameCommandHandler();
        $handler->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'library',
            'instanceId' => 'to-top',
            'position' => 'top',
        ], $actor);
        $handler->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'library',
            'instanceId' => 'to-bottom',
            'position' => 'bottom',
        ], $actor);

        self::assertSame(['to-top', 'library-top', 'to-bottom'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $game->snapshot()['players'][$actor->id()]['zones']['library'],
        ));
    }

    /**
     * @param array<string,list<array<string,mixed>>> $actorZones
     */
    private function snapshot(string $actorId, array $actorZones, ?string $opponentId = null): array
    {
        $players = [
            $actorId => $this->player($actorId, $actorZones),
        ];
        if ($opponentId !== null) {
            $players[$opponentId] = $this->player($opponentId, []);
        }

        return [
            'version' => 1,
            'ownerId' => $actorId,
            'players' => $players,
            'turn' => ['activePlayerId' => $actorId, 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ];
    }

    /**
     * @param array<string,list<array<string,mixed>>> $zones
     */
    private function player(string $playerId, array $zones): array
    {
        return [
            'user' => ['id' => $playerId, 'email' => $playerId.'@example.test', 'displayName' => $playerId, 'roles' => []],
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

    private function card(
        string $instanceId,
        string $name,
        string $zone,
        int $power,
        int $toughness,
        int $basePower,
        int $baseToughness,
    ): array {
        return [
            'instanceId' => $instanceId,
            'name' => $name,
            'zone' => $zone,
            'power' => $power,
            'toughness' => $toughness,
            'basePower' => $basePower,
            'baseToughness' => $baseToughness,
            'tapped' => false,
        ];
    }
}
