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
        self::assertSame(2, $graveyardCard['defaultPower']);
        self::assertSame(2, $graveyardCard['defaultToughness']);
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

    public function testMovingControlledBattlefieldCardToPrivateZoneReturnsItToDeckOwner(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $controller = new User('controller@example.test', 'Controller');
        $snapshot = $this->snapshot($owner->id(), [], $controller->id());
        $snapshot['players'][$controller->id()]['zones']['battlefield'][] = [
            ...$this->card('card-1', 'Borrowed Bear', 'battlefield', 9, 9, 2, 2),
            'ownerId' => $owner->id(),
            'controllerId' => $controller->id(),
        ];
        $game = new Game(new Room($owner), $snapshot);

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $controller->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'card-1',
        ], $controller);

        self::assertSame([], $game->snapshot()['players'][$controller->id()]['zones']['graveyard']);
        self::assertSame([], $game->snapshot()['players'][$controller->id()]['zones']['battlefield']);

        $ownerGraveyardCard = $game->snapshot()['players'][$owner->id()]['zones']['graveyard'][0];
        self::assertSame('card-1', $ownerGraveyardCard['instanceId']);
        self::assertSame($owner->id(), $ownerGraveyardCard['ownerId']);
        self::assertSame($owner->id(), $ownerGraveyardCard['controllerId']);
        self::assertSame(2, $ownerGraveyardCard['power']);
        self::assertSame(2, $ownerGraveyardCard['toughness']);
    }

    public function testChangingControllerMovesBattlefieldCardToCenterOfTargetBattlefield(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $controller = new User('controller@example.test', 'Controller');
        $game = new Game(new Room($owner), $this->snapshot($owner->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Borrowed Bear', 'battlefield', 9, 9, 2, 2),
                    'ownerId' => $owner->id(),
                    'controllerId' => $owner->id(),
                    'position' => ['x' => 2070, 'y' => 837],
                ],
            ],
        ], $controller->id()));

        (new GameCommandHandler())->apply($game, 'card.controller.changed', [
            'playerId' => $owner->id(),
            'zone' => 'battlefield',
            'targetPlayerId' => $controller->id(),
            'instanceId' => 'card-1',
        ], $owner);

        self::assertSame([], $game->snapshot()['players'][$owner->id()]['zones']['battlefield']);

        $controlledCard = $game->snapshot()['players'][$controller->id()]['zones']['battlefield'][0];
        self::assertSame('card-1', $controlledCard['instanceId']);
        self::assertSame($owner->id(), $controlledCard['ownerId']);
        self::assertSame($controller->id(), $controlledCard['controllerId']);
        self::assertSame(['x' => 392, 'y' => 179], $controlledCard['position']);
        self::assertSame(9, $controlledCard['power']);
        self::assertSame(9, $controlledCard['toughness']);
    }

    public function testCommanderFlagIsPreservedWhenCommanderMovesBetweenZones(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'command' => [
                [
                    ...$this->card('commander-1', 'Commander', 'command', 2, 2, 2, 2),
                    'isCommander' => true,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'command',
            'toZone' => 'battlefield',
            'instanceId' => 'commander-1',
        ], $actor);

        self::assertTrue($game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0]['isCommander']);
    }

    public function testCardCounterCanBeRemovedFromCard(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Bear', 'battlefield', 2, 2, 2, 2),
                    'counters' => ['red' => 0],
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.counter.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'key' => 'red',
            'remove' => true,
        ], $actor);

        self::assertArrayNotHasKey('red', $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0]['counters']);
    }

    public function testCardCannotHaveMoreThanFiveDifferentCounters(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Bear', 'battlefield', 2, 2, 2, 2),
                    'counters' => ['+1/+1' => 0, '-1/-1' => 0, 'charge' => 0, 'red' => 0, 'green' => 0],
                ],
            ],
        ]));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Maximum 5 different counters per card.');

        (new GameCommandHandler())->apply($game, 'card.counter.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'key' => 'blue',
            'value' => 0,
        ], $actor);
    }

    public function testTokenCopyKeepsTokenFlagWhenMovingBetweenBattlefields(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('token-1', 'Bear Token', 'battlefield', 4, 4, 2, 2),
                    'isToken' => true,
                ],
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'battlefield',
            'targetPlayerId' => $opponent->id(),
            'instanceId' => 'token-1',
        ], $actor);

        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['battlefield']);
        $movedToken = $game->snapshot()['players'][$opponent->id()]['zones']['battlefield'][0];
        self::assertTrue($movedToken['isToken']);
        self::assertSame($opponent->id(), $movedToken['controllerId']);
        self::assertSame(4, $movedToken['power']);
        self::assertSame(4, $movedToken['toughness']);
    }

    public function testTokenCopyCommandCreatesIdenticalBattlefieldInstanceMarkedAsToken(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Bear', 'battlefield', 4, 4, 2, 2),
                    'tapped' => true,
                    'counters' => ['charge' => 2],
                    'loyalty' => 6,
                    'defaultLoyalty' => 3,
                    'position' => ['x' => 120, 'y' => 240],
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.token_copy.created', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        $battlefield = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'];
        self::assertCount(2, $battlefield);
        $copy = $battlefield[1];
        self::assertNotSame('card-1', $copy['instanceId']);
        self::assertSame('Bear', $copy['name']);
        self::assertSame(2, $copy['power']);
        self::assertSame(2, $copy['toughness']);
        self::assertSame(3, $copy['loyalty']);
        self::assertTrue($copy['tapped']);
        self::assertSame([], $copy['counters']);
        self::assertSame(['x' => 252, 'y' => 240], $copy['position']);
        self::assertTrue($copy['isToken']);
        self::assertSame('Created Token Copy Of Bear.', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testTokenCopyUsesDefaultStatsInsteadOfModifiedStats(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    'instanceId' => 'card-1',
                    'scryfallId' => 'walker-scryfall-id',
                    'name' => 'Kefka',
                    'zone' => 'battlefield',
                    'power' => 8,
                    'toughness' => 9,
                    'loyalty' => 11,
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
                return $card['scryfallId'] === 'walker-scryfall-id'
                    ? ['power' => 5, 'toughness' => 5]
                    : null;
            }

            public function baseLoyalty(array $card): ?int
            {
                return $card['scryfallId'] === 'walker-scryfall-id' ? 3 : null;
            }
        };

        (new GameCommandHandler($resolver))->apply($game, 'card.token_copy.created', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        $copy = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][1];
        self::assertSame(5, $copy['power']);
        self::assertSame(5, $copy['toughness']);
        self::assertSame(3, $copy['loyalty']);
        self::assertSame(5, $copy['defaultPower']);
        self::assertSame(5, $copy['defaultToughness']);
        self::assertSame(3, $copy['defaultLoyalty']);
        self::assertSame([], $copy['counters']);
    }

    public function testTokenCopyUsesCardFaceStatsWhenSnapshotHasNoDefaults(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    'instanceId' => 'card-1',
                    'name' => 'Face Bear',
                    'zone' => 'battlefield',
                    'cardFaces' => [['power' => '2', 'toughness' => '3']],
                    'power' => 8,
                    'toughness' => 9,
                    'tapped' => false,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.token_copy.created', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        $copy = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][1];
        self::assertSame(2, $copy['power']);
        self::assertSame(3, $copy['toughness']);
        self::assertSame(2, $copy['defaultPower']);
        self::assertSame(3, $copy['defaultToughness']);
    }

    public function testStatCountersAdjustPowerAndToughness(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('card-1', 'Bear', 'battlefield', 2, 2, 2, 2),
            ],
        ]));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'card.counter.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'key' => '+1/+1',
            'value' => 2,
        ], $actor);
        $handler->apply($game, 'card.counter.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'key' => '-1/-1',
            'value' => 1,
        ], $actor);

        $card = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame(3, $card['power']);
        self::assertSame(3, $card['toughness']);
    }

    public function testTokenCopyEvaporatesWhenItLeavesBattlefieldForNonBattlefieldZone(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('token-1', 'Bear Token', 'battlefield', 4, 4, 2, 2),
                    'isToken' => true,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'token-1',
        ], $actor);

        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['battlefield']);
        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['graveyard']);
        self::assertSame(
            'Token Copy Bear Token evaporated instead of moving to graveyard.',
            $game->snapshot()['eventLog'][0]['message'],
        );
    }

    public function testChangesPlaneswalkerLoyalty(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Adept', 'battlefield', 0, 0, 0, 0),
                    'loyalty' => 3,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.power_toughness.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'loyalty' => 4,
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame(4, $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['loyalty']);
        self::assertSame(3, $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['defaultLoyalty']);
        self::assertSame('Adept loyalty increased from 3 to 4 (+1).', $snapshot['eventLog'][0]['message']);
    }

    public function testResetsModifiedLoyaltyWhenPlaneswalkerLeavesBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Adept', 'battlefield', 0, 0, 0, 0),
                    'loyalty' => 7,
                    'defaultLoyalty' => 3,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'exile',
            'instanceId' => 'card-1',
        ], $actor);

        $exiledCard = $game->snapshot()['players'][$actor->id()]['zones']['exile'][0];
        self::assertSame(3, $exiledCard['loyalty']);
        self::assertSame(3, $exiledCard['defaultLoyalty']);
    }

    public function testResetsLegacyModifiedLoyaltyFromBaseLoyalty(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Adept', 'battlefield', 0, 0, 0, 0),
                    'loyalty' => 7,
                    'baseLoyalty' => 3,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'exile',
            'instanceId' => 'card-1',
        ], $actor);

        $exiledCard = $game->snapshot()['players'][$actor->id()]['zones']['exile'][0];
        self::assertSame(3, $exiledCard['loyalty']);
        self::assertSame(3, $exiledCard['defaultLoyalty']);
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
        self::assertSame(2, $graveyardCard['defaultPower']);
        self::assertSame(2, $graveyardCard['defaultToughness']);
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
        self::assertSame(['Bear', 'Elf'], $snapshot['eventLog'][0]['cardNames']);
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

    public function testTurnPlayerChangeCreatesClearLogEntry(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'turn.changed', [
            'activePlayerId' => $opponent->id(),
            'phase' => 'untap',
            'number' => 2,
        ], $actor);

        self::assertSame(
            sprintf('Turno 2: empieza el turno de %s. Fase untap.', $opponent->id()),
            $game->snapshot()['eventLog'][0]['message'] ?? null,
        );
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

    public function testMovingAllCardsFromEmptyZoneDoesNotCreateLogEntry(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'graveyard' => [],
            'exile' => [],
        ]));

        (new GameCommandHandler())->apply($game, 'zone.move_all', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'exile',
        ], $actor);

        self::assertSame([], $game->snapshot()['eventLog']);
        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['graveyard']);
        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['exile']);
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

    public function testArrowCreatedRequiresBothEndpointsOnBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('battlefield-card', 'Bear', 'battlefield', 2, 2, 2, 2),
            ],
            'hand' => [
                $this->card('hand-card', 'Elf', 'hand', 1, 1, 1, 1),
            ],
        ]));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Arrow endpoints must be battlefield cards.');

        (new GameCommandHandler())->apply($game, 'arrow.created', [
            'fromInstanceId' => 'battlefield-card',
            'toInstanceId' => 'hand-card',
        ], $actor);
    }

    public function testArrowIsPrunedWhenEndpointLeavesBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('card-1', 'Bear', 'battlefield', 2, 2, 2, 2),
                $this->card('card-2', 'Elf', 'battlefield', 1, 1, 1, 1),
            ],
        ]);
        $snapshot['arrows'] = [[
            'id' => 'arrow-1',
            'fromInstanceId' => 'card-1',
            'toInstanceId' => 'card-2',
            'color' => 'yellow',
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'card-2',
        ], $actor);

        self::assertSame([], $game->snapshot()['arrows']);
    }

    public function testArrowSurvivesControllerChangeBetweenBattlefields(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('card-1', 'Bear', 'battlefield', 2, 2, 2, 2),
                $this->card('card-2', 'Elf', 'battlefield', 1, 1, 1, 1),
            ],
        ], $opponent->id());
        $snapshot['arrows'] = [[
            'id' => 'arrow-1',
            'fromInstanceId' => 'card-1',
            'toInstanceId' => 'card-2',
            'color' => 'yellow',
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'card.controller.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'targetPlayerId' => $opponent->id(),
            'instanceId' => 'card-2',
        ], $actor);

        self::assertSame('arrow-1', $game->snapshot()['arrows'][0]['id'] ?? null);
        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][1] ?? []);
        self::assertSame('card-2', $game->snapshot()['players'][$opponent->id()]['zones']['battlefield'][0]['instanceId']);
        self::assertSame(['x' => 392, 'y' => 179], $game->snapshot()['players'][$opponent->id()]['zones']['battlefield'][0]['position']);
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
            'defaultPower' => $basePower,
            'defaultToughness' => $baseToughness,
            'tapped' => false,
        ];
    }
}
