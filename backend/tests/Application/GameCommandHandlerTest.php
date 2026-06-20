<?php

namespace App\Tests\Application;

use App\Application\Game\GameCardBaseStatsResolver;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameMulliganRules;
use App\Application\Game\GameRandomizer;
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

    public function testKeepsPrintedPowerToughnessWhenCardEntersBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'hand' => [
                [
                    'instanceId' => 'card-1',
                    'name' => 'Variable Creature',
                    'zone' => 'hand',
                    'power' => 'X',
                    'toughness' => '*+1',
                    'defaultPower' => 'X',
                    'defaultToughness' => '*+1',
                    'tapped' => false,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'hand',
            'toZone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        $battlefieldCard = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame(0, $battlefieldCard['power']);
        self::assertSame(0, $battlefieldCard['toughness']);
        self::assertSame('X', $battlefieldCard['defaultPower']);
        self::assertSame('*+1', $battlefieldCard['defaultToughness']);
    }

    public function testUntapsCardWhenItLeavesBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Tapped Bear', 'battlefield', 2, 2, 2, 2),
                    'tapped' => true,
                    'rotation' => 90,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'card-1',
        ], $actor);

        $graveyardCard = $game->snapshot()['players'][$actor->id()]['zones']['graveyard'][0];
        self::assertFalse($graveyardCard['tapped']);
        self::assertSame(0, $graveyardCard['rotation']);
    }

    public function testUntapsCardsWhenTheyLeaveBattlefieldTogether(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Tapped Bear', 'battlefield', 2, 2, 2, 2),
                    'tapped' => true,
                    'rotation' => 90,
                ],
                [
                    ...$this->card('card-2', 'Tapped Elk', 'battlefield', 3, 3, 3, 3),
                    'tapped' => true,
                    'rotation' => 90,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'cards.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'hand',
            'instanceIds' => ['card-1', 'card-2'],
        ], $actor);

        $hand = $game->snapshot()['players'][$actor->id()]['zones']['hand'];
        self::assertFalse($hand[0]['tapped']);
        self::assertSame(0, $hand[0]['rotation']);
        self::assertFalse($hand[1]['tapped']);
        self::assertSame(0, $hand[1]['rotation']);
    }

    public function testNormalizeSnapshotUntapsLegacyCardsOutsideBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), [
            'hand' => [
                [
                    ...$this->card('card-1', 'Legacy Tapped Hand', 'hand', 2, 2, 2, 2),
                    'tapped' => true,
                    'rotation' => 90,
                ],
            ],
        ]);

        $normalized = (new GameCommandHandler())->normalizeSnapshot($snapshot);
        $handCard = $normalized['players'][$actor->id()]['zones']['hand'][0];

        self::assertFalse($handCard['tapped']);
        self::assertSame(0, $handCard['rotation']);
    }

    public function testKeepsModifiedPowerToughnessWhenCardMovesToOpponentBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Bear', 'battlefield', 9, 9, 2, 2),
                    'tapped' => true,
                    'rotation' => 90,
                ],
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
        self::assertTrue($opponentCard['tapped']);
        self::assertSame(90, $opponentCard['rotation']);
    }

    public function testCanMoveHandCardToBattlefieldFaceDown(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'hand' => [
                $this->card('card-1', 'Hidden Bear', 'hand', 2, 2, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'hand',
            'toZone' => 'battlefield',
            'instanceId' => 'card-1',
            'faceDown' => true,
        ], $actor);

        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['hand']);
        $battlefieldCard = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame('card-1', $battlefieldCard['instanceId']);
        self::assertTrue($battlefieldCard['faceDown']);
        self::assertSame([$actor->id()], $battlefieldCard['revealedTo']);
        self::assertSame('Played a card face down.', $game->snapshot()['eventLog'][0]['message']);
        self::assertStringNotContainsString('Hidden Bear', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testCanGiveHandCardToOpponentHand(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'hand' => [
                $this->card('card-1', 'Gift Card', 'hand', 2, 2, 2, 2),
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'hand',
            'toZone' => 'hand',
            'targetPlayerId' => $opponent->id(),
            'instanceId' => 'card-1',
        ], $actor);

        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['hand']);
        $opponentHandCard = $game->snapshot()['players'][$opponent->id()]['zones']['hand'][0];
        self::assertSame('card-1', $opponentHandCard['instanceId']);
        self::assertSame($actor->id(), $opponentHandCard['ownerId']);
        self::assertSame($opponent->id(), $opponentHandCard['controllerId']);
        $log = $game->snapshot()['eventLog'][0] ?? null;
        self::assertIsArray($log);
        self::assertSame("Moved a card from {$actor->id()}'s hand to {$opponent->id()}'s hand.", $log['message']);
        self::assertStringNotContainsString('Gift Card', $log['message']);
    }

    public function testCanGiveLibraryCardToOpponentBattlefieldAndRemoveItFromSource(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('card-1', 'Gift Card', 'library', 2, 2, 2, 2),
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'library',
            'toZone' => 'battlefield',
            'targetPlayerId' => $opponent->id(),
            'instanceId' => 'card-1',
            'sourceContext' => ['type' => 'libraryTopView', 'count' => 1],
        ], $actor);

        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['library']);
        $opponentBattlefieldCard = $game->snapshot()['players'][$opponent->id()]['zones']['battlefield'][0];
        self::assertSame('card-1', $opponentBattlefieldCard['instanceId']);
        self::assertSame('battlefield', $opponentBattlefieldCard['zone']);
        self::assertSame($actor->id(), $opponentBattlefieldCard['ownerId']);
        self::assertSame($opponent->id(), $opponentBattlefieldCard['controllerId']);
    }

    public function testFaceDownBattlefieldCardLeavesBattlefieldWithoutLog(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Hidden Bear', 'battlefield', 2, 2, 2, 2),
                    'faceDown' => true,
                    'revealedTo' => [$actor->id()],
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'card-1',
        ], $actor);

        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['battlefield']);
        $graveyardCard = $game->snapshot()['players'][$actor->id()]['zones']['graveyard'][0];
        self::assertSame('card-1', $graveyardCard['instanceId']);
        self::assertFalse($graveyardCard['faceDown']);
        self::assertSame([], $graveyardCard['revealedTo']);
        self::assertSame([], $game->snapshot()['eventLog']);
    }

    public function testFaceDownBattlefieldCardMovedAsSelectionLeavesBattlefieldWithoutLog(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Hidden Bear', 'battlefield', 2, 2, 2, 2),
                    'faceDown' => true,
                    'revealedTo' => [$actor->id()],
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'cards.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'exile',
            'instanceIds' => ['card-1'],
        ], $actor);

        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['battlefield']);
        $exiledCard = $game->snapshot()['players'][$actor->id()]['zones']['exile'][0];
        self::assertSame('card-1', $exiledCard['instanceId']);
        self::assertFalse($exiledCard['faceDown']);
        self::assertSame([], $exiledCard['revealedTo']);
        self::assertSame([], $game->snapshot()['eventLog']);
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
        self::assertSame(['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'], $controlledCard['position']);
        self::assertSame(9, $controlledCard['power']);
        self::assertSame(9, $controlledCard['toughness']);
    }

    public function testPositionCommandAcceptsAndClampsRatioPosition(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('card-1', 'Bear', 'battlefield', 2, 2, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.position.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'position' => ['x' => 1.5, 'y' => -0.25, 'unit' => 'ratio'],
        ], $actor);

        self::assertSame(
            ['x' => 1.0, 'y' => 0.0, 'unit' => 'ratio'],
            $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0]['position'],
        );
    }

    public function testPositionCommandStillAcceptsLegacyPixelPosition(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('card-1', 'Bear', 'battlefield', 2, 2, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.position.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'position' => ['x' => 120, 'y' => 240],
        ], $actor);

        self::assertSame(
            ['x' => 120, 'y' => 240],
            $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0]['position'],
        );
    }

    public function testDayNightLegacyBattlefieldCardCannotBeMoved(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('day-night-1', 'Day // Night', 'battlefield', 0, 0, 0, 0),
                    'layout' => 'double_faced_token',
                    'position' => ['x' => 1, 'y' => 0, 'unit' => 'ratio'],
                ],
            ],
        ]));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Card not found.');

        (new GameCommandHandler())->apply($game, 'card.position.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'day-night-1',
            'position' => ['x' => 0.2, 'y' => 0.8, 'unit' => 'ratio'],
        ], $actor);
    }

    public function testDungeonMarkerCommandClampsMarkerAndPreservesItWhenCardMoves(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('dungeon-1', 'Lost Mine of Phandelver', 'battlefield', 0, 0, 0, 0),
                    'typeLine' => 'Dungeon',
                    'layout' => 'normal',
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.dungeon_marker.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'dungeon-1',
            'position' => ['x' => 1.2, 'y' => -0.25],
        ], $actor);

        (new GameCommandHandler())->apply($game, 'card.position.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'dungeon-1',
            'position' => ['x' => 0.1, 'y' => 0.2, 'unit' => 'ratio'],
        ], $actor);

        $dungeon = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame(['x' => 1.0, 'y' => 0.0], $dungeon['dungeonMarker']);
        self::assertSame(['x' => 0.1, 'y' => 0.2, 'unit' => 'ratio'], $dungeon['position']);
    }

    public function testDungeonMarkerCommandRejectsNonDungeonCards(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Dungeon Master', 'battlefield', 2, 2, 2, 2),
                    'typeLine' => 'Creature - Human Wizard',
                ],
            ],
        ]));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Only dungeon cards can have a dungeon marker.');

        (new GameCommandHandler())->apply($game, 'card.dungeon_marker.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'position' => ['x' => 0.4, 'y' => 0.6],
        ], $actor);
    }

    public function testCardsPositionCommandPersistsMultipleBattlefieldPositionsAtomically(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('land-top', 'Forest', 'battlefield', 2, 2, 2, 2),
                $this->card('land-under', 'Island', 'battlefield', 2, 2, 2, 2),
                $this->card('land-bottom', 'Plains', 'battlefield', 2, 2, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'cards.position.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'positions' => [
                ['instanceId' => 'land-top', 'position' => ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio']],
                ['instanceId' => 'land-under', 'position' => ['x' => 0.5, 'y' => 0.46, 'unit' => 'ratio']],
                ['instanceId' => 'land-bottom', 'position' => ['x' => 0.5, 'y' => 0.42, 'unit' => 'ratio']],
            ],
        ], $actor);

        $battlefield = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'];
        self::assertSame(['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'], $battlefield[0]['position']);
        self::assertSame(['x' => 0.5, 'y' => 0.46, 'unit' => 'ratio'], $battlefield[1]['position']);
        self::assertSame(['x' => 0.5, 'y' => 0.42, 'unit' => 'ratio'], $battlefield[2]['position']);
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
        self::assertArrayNotHasKey('lang', $copy);
        self::assertArrayNotHasKey('printedName', $copy);
        self::assertSame(2, $copy['power']);
        self::assertSame(2, $copy['toughness']);
        self::assertSame(3, $copy['loyalty']);
        self::assertTrue($copy['tapped']);
        self::assertSame([], $copy['counters']);
        self::assertSame(['x' => 252, 'y' => 240], $copy['position']);
        self::assertTrue($copy['isToken']);
        self::assertTrue($copy['isTokenCopy']);
        self::assertSame('Created Token Copy Of Bear.', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testCreateTokenCommandCreatesGenericBattlefieldToken(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), []));

        (new GameCommandHandler())->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
        ], $actor);

        $battlefield = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'];
        self::assertCount(1, $battlefield);
        $token = $battlefield[0];
        self::assertNotEmpty($token['instanceId']);
        self::assertSame('Token', $token['name']);
        self::assertSame('Token Creature', $token['typeLine']);
        self::assertSame(1, $token['power']);
        self::assertSame(1, $token['toughness']);
        self::assertTrue($token['isToken']);
        self::assertFalse($token['isTokenCopy']);
        self::assertSame(['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'], $token['position']);
        self::assertSame('Created Token.', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testCreateTokenCommandUsesSelectedTokenPayload(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), []));

        (new GameCommandHandler())->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'card' => [
                'scryfallId' => 'token-scryfall-id',
                'name' => 'Goblin Token',
                'typeLine' => 'Token Creature - Goblin',
                'imageUris' => ['normal' => 'https://cards.scryfall.io/token.jpg'],
                'colorIdentity' => ['R'],
                'power' => '1',
                'toughness' => '1',
            ],
        ], $actor);

        $token = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame('token-scryfall-id', $token['scryfallId']);
        self::assertSame('Goblin Token', $token['name']);
        self::assertSame('Token Creature - Goblin', $token['typeLine']);
        self::assertSame('https://cards.scryfall.io/token.jpg', $token['imageUris']['normal']);
        self::assertSame(['R'], $token['colorIdentity']);
        self::assertSame(1, $token['power']);
        self::assertSame(1, $token['toughness']);
        self::assertTrue($token['isToken']);
        self::assertFalse($token['isTokenCopy']);
        self::assertSame('Created Goblin Token.', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testCreateTokenCommandUsesExplicitBattlefieldPosition(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), []));

        (new GameCommandHandler())->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'position' => ['x' => 0, 'y' => 0, 'unit' => 'ratio'],
            'card' => [
                'scryfallId' => 'emblem-scryfall-id',
                'name' => 'Chandra Emblem',
                'typeLine' => 'Emblem',
                'layout' => 'emblem',
                'imageUris' => ['normal' => 'https://cards.scryfall.io/emblem.jpg'],
            ],
        ], $actor);

        $token = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame('Chandra Emblem', $token['name']);
        self::assertSame('emblem', $token['layout']);
        self::assertTrue($token['isToken']);
        self::assertSame(['x' => 0.0, 'y' => 0.0, 'unit' => 'ratio'], $token['position']);
    }

    public function testCreateEmblemTokenLogsThatPlayerGetsTheEmblem(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), []));

        (new GameCommandHandler())->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'card' => [
                'scryfallId' => 'emblem-scryfall-id',
                'name' => 'Chandra Emblem',
                'typeLine' => 'Emblem',
                'layout' => 'emblem',
            ],
        ], $actor);

        self::assertSame(
            sprintf('%s gets emblem Chandra Emblem.', $actor->id()),
            $game->snapshot()['eventLog'][0]['message'],
        );
    }

    public function testCreateDungeonTokenReplacesOnlyCurrentPlayersActiveDungeon(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [[
                ...$this->card('old-dungeon', 'Lost Mine of Phandelver', 'battlefield', 0, 0, 0, 0),
                'typeLine' => 'Dungeon',
                'layout' => 'dungeon',
                'dungeonMarker' => ['x' => 0.8, 'y' => 0.2],
            ]],
        ], $opponent->id());
        $snapshot['players'][$opponent->id()]['zones']['battlefield'] = [[
            ...$this->card('opponent-dungeon', 'Tomb of Annihilation', 'battlefield', 0, 0, 0, 0),
            'typeLine' => 'Dungeon',
            'layout' => 'dungeon',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'card' => [
                'scryfallId' => 'undercity-scryfall-id',
                'name' => 'Undercity',
                'typeLine' => 'Dungeon',
                'layout' => 'dungeon',
            ],
        ], $actor);

        $actorBattlefield = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'];
        $opponentBattlefield = $game->snapshot()['players'][$opponent->id()]['zones']['battlefield'];
        self::assertCount(1, $actorBattlefield);
        self::assertSame('Undercity', $actorBattlefield[0]['name']);
        self::assertNotSame('old-dungeon', $actorBattlefield[0]['instanceId']);
        self::assertSame(['x' => 0.5, 'y' => 0.5], $actorBattlefield[0]['dungeonMarker']);
        self::assertCount(1, $opponentBattlefield);
        self::assertSame('opponent-dungeon', $opponentBattlefield[0]['instanceId']);
    }

    public function testCreateTheRingTokenStartsAtLevelOneAndReplacesPreviousCopyForThatPlayer(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [[
                ...$this->card('old-ring', 'The Ring', 'battlefield', 0, 0, 0, 0),
                'scryfallId' => '7215460e-8c06-47d0-94e5-d1832d0218af',
                'typeLine' => 'Emblem // Card',
                'layout' => 'double_faced_token',
                'counters' => ['Level' => 3],
            ]],
        ], $opponent->id());
        $snapshot['players'][$opponent->id()]['zones']['battlefield'] = [[
            ...$this->card('opponent-ring', 'The Ring // The Ring Tempts You', 'battlefield', 0, 0, 0, 0),
            'typeLine' => 'Emblem // Card',
            'layout' => 'double_faced_token',
            'counters' => ['Level' => 2],
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'card' => [
                'scryfallId' => '7215460e-8c06-47d0-94e5-d1832d0218af',
                'name' => 'The Ring // The Ring Tempts You',
                'typeLine' => 'Emblem // Card',
                'layout' => 'double_faced_token',
            ],
        ], $actor);

        $actorBattlefield = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'];
        $opponentBattlefield = $game->snapshot()['players'][$opponent->id()]['zones']['battlefield'];
        self::assertCount(1, $actorBattlefield);
        self::assertSame('The Ring // The Ring Tempts You', $actorBattlefield[0]['name']);
        self::assertSame(['Level' => 1], $actorBattlefield[0]['counters']);
        self::assertNotSame('old-ring', $actorBattlefield[0]['instanceId']);
        self::assertCount(1, $opponentBattlefield);
        self::assertSame('opponent-ring', $opponentBattlefield[0]['instanceId']);
    }

    public function testTheRingLevelCounterIsClampedBetweenOneAndFour(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [[
                ...$this->card('the-ring', 'The Ring // The Ring Tempts You', 'battlefield', 0, 0, 0, 0),
                'scryfallId' => '7215460e-8c06-47d0-94e5-d1832d0218af',
                'typeLine' => 'Emblem // Card',
                'layout' => 'double_faced_token',
                'counters' => ['Level' => 2],
            ]],
        ]);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'card.counter.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'the-ring',
            'key' => 'Level',
            'value' => 9,
        ], $actor);

        self::assertSame(4, $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0]['counters']['Level']);

        $handler->apply($game, 'card.counter.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'the-ring',
            'key' => 'Level',
            'value' => 0,
        ], $actor);

        self::assertSame(1, $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0]['counters']['Level']);

        $handler->apply($game, 'card.counter.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'the-ring',
            'key' => 'Level',
            'remove' => true,
        ], $actor);

        self::assertSame(['Level' => 1], $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0]['counters']);
    }

    public function testCreateTokenCommandCreatesRequestedQuantityInSingleCommand(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), []));

        (new GameCommandHandler())->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'quantity' => 3,
            'card' => [
                'scryfallId' => 'token-scryfall-id',
                'name' => 'Goblin Token',
                'typeLine' => 'Token Creature - Goblin',
                'power' => '1',
                'toughness' => '1',
            ],
        ], $actor);

        $battlefield = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'];
        self::assertCount(3, $battlefield);
        self::assertCount(3, array_unique(array_column($battlefield, 'instanceId')));
        self::assertSame('Goblin Token', $battlefield[0]['name']);
        self::assertSame('Goblin Token', $battlefield[1]['name']);
        self::assertSame('Goblin Token', $battlefield[2]['name']);
        self::assertNotSame($battlefield[0]['position'], $battlefield[1]['position']);
        self::assertSame('Created 3 Goblin Tokens.', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testDiceRollCommandLogsResult(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), []));
        $handler = new GameCommandHandler(null, new class() extends GameRandomizer {
            public function roll(string $kind): string|int
            {
                TestCase::assertSame('d20', $kind);

                return 17;
            }
        });

        $event = $handler->apply($game, 'dice.rolled', [
            'kind' => 'd20',
        ], $actor);

        self::assertSame('ha tirado un d20, ha salido un 17.', $game->snapshot()['eventLog'][0]['message']);
        self::assertSame([
            'kind' => 'd20',
            'finalResult' => '17',
        ], $event->toArray()['payload']);
    }

    public function testUntapAllBattlefieldCardsUntapsOnlyActorBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Tapped Card', 'battlefield', 2, 2, 2, 2),
                    'tapped' => true,
                ],
                $this->card('card-2', 'Untapped Card', 'battlefield', 2, 2, 2, 2),
            ],
        ], $opponent->id());
        $snapshot['players'][$opponent->id()]['zones']['battlefield'] = [[
            ...$this->card('card-3', 'Opponent Card', 'battlefield', 2, 2, 2, 2),
            'tapped' => true,
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'battlefield.untap_all', [
            'playerId' => $actor->id(),
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertFalse($snapshot['players'][$actor->id()]['zones']['battlefield'][0]['tapped']);
        self::assertFalse($snapshot['players'][$actor->id()]['zones']['battlefield'][1]['tapped']);
        self::assertTrue($snapshot['players'][$opponent->id()]['zones']['battlefield'][0]['tapped']);
        self::assertSame('Untapped 1 battlefield card.', $snapshot['eventLog'][0]['message']);
    }

    public function testRevealedHandCardStoresTargetsWithoutLoggingCardName(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id(), [
            'hand' => [
                $this->card('card-1', 'Secret Tutor', 'hand', 0, 0, 0, 0),
            ],
        ], $opponent->id());
        $snapshot['players'][$opponent->id()]['user']['displayName'] = 'Opponent';
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'card.revealed', [
            'playerId' => $actor->id(),
            'zone' => 'hand',
            'instanceId' => 'card-1',
            'to' => $opponent->id(),
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame([$opponent->id()], $snapshot['players'][$actor->id()]['zones']['hand'][0]['revealedTo']);
        self::assertSame('ha revelado una carta a Opponent.', $snapshot['eventLog'][0]['message']);
        self::assertStringNotContainsString('Secret Tutor', $snapshot['eventLog'][0]['message']);
    }

    public function testTokenCopyPreservesRatioPositionSystem(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Bear', 'battlefield', 4, 4, 2, 2),
                    'position' => ['x' => 0.5, 'y' => 0.25, 'unit' => 'ratio'],
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.token_copy.created', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        $copy = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][1];
        self::assertSame(['x' => 0.6683673469387755, 'y' => 0.25, 'unit' => 'ratio'], $copy['position']);
    }

    public function testTokenCopyUsesFreeSideWhenDefaultSideIsOccupied(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Bear', 'battlefield', 4, 4, 2, 2),
                    'position' => ['x' => 0.5, 'y' => 0.25, 'unit' => 'ratio'],
                ],
                [
                    ...$this->card('card-2', 'Occupied', 'battlefield', 1, 1, 1, 1),
                    'position' => ['x' => 0.6683673469387755, 'y' => 0.25, 'unit' => 'ratio'],
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.token_copy.created', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        $copy = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][2];
        self::assertSame(['x' => 0.33163265306122447, 'y' => 0.25, 'unit' => 'ratio'], $copy['position']);
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

    public function testRegularTokenEvaporatesWithoutCopyPrefixWhenItLeavesBattlefieldForNonBattlefieldZone(): void
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
            'Bear Token evaporated instead of moving to graveyard.',
            $game->snapshot()['eventLog'][0]['message'],
        );
    }

    public function testTokenCopyEvaporatesWithCopyPrefixWhenItLeavesBattlefieldForNonBattlefieldZone(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('token-copy-1', 'Bear Token', 'battlefield', 4, 4, 2, 2),
                    'isToken' => true,
                    'isTokenCopy' => true,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'token-copy-1',
        ], $actor);

        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['battlefield']);
        self::assertSame([], $game->snapshot()['players'][$actor->id()]['zones']['graveyard']);
        self::assertSame(
            'Token Copy Bear Token evaporated instead of moving to graveyard.',
            $game->snapshot()['eventLog'][0]['message'],
        );
    }

    public function testTokensAndTokenCopiesEvaporateWhenMovedToHandOrZonePiles(): void
    {
        $destinations = ['hand', 'library', 'graveyard', 'exile', 'command'];

        foreach ($destinations as $toZone) {
            foreach ([false, true] as $isTokenCopy) {
                $actor = new User('owner@example.test', 'Owner');
                $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
                    'battlefield' => [
                        [
                            ...$this->card('token-1', 'Bear Token', 'battlefield', 2, 2, 2, 2),
                            'isToken' => true,
                            'isTokenCopy' => $isTokenCopy,
                        ],
                    ],
                ]));

                (new GameCommandHandler())->apply($game, 'card.moved', [
                    'playerId' => $actor->id(),
                    'fromZone' => 'battlefield',
                    'toZone' => $toZone,
                    'instanceId' => 'token-1',
                ], $actor);

                $zones = $game->snapshot()['players'][$actor->id()]['zones'];
                self::assertSame([], $zones['battlefield'], sprintf('Battlefield should be empty for %s token move to %s.', $isTokenCopy ? 'copy' : 'regular', $toZone));
                self::assertSame([], $zones[$toZone], sprintf('Token should not enter %s.', $toZone));
            }
        }
    }

    public function testBatchMovedTokensEvaporateWhenTheyLeaveBattlefieldForNonBattlefieldZone(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('token-1', 'Bear Token', 'battlefield', 2, 2, 2, 2),
                    'isToken' => true,
                ],
                [
                    ...$this->card('card-1', 'Real Bear', 'battlefield', 2, 2, 2, 2),
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'cards.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceIds' => ['token-1', 'card-1'],
        ], $actor);

        $zones = $game->snapshot()['players'][$actor->id()]['zones'];
        self::assertSame([], $zones['battlefield']);
        self::assertSame(['card-1'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $zones['graveyard'],
        ));
    }

    public function testBatchMovedTokenCopiesEvaporateWhenMovedToHandOrZonePiles(): void
    {
        foreach (['hand', 'library', 'graveyard', 'exile', 'command'] as $toZone) {
            $actor = new User('owner@example.test', 'Owner');
            $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
                'battlefield' => [
                    [
                        ...$this->card('token-copy-1', 'Bear Token', 'battlefield', 2, 2, 2, 2),
                        'isToken' => true,
                        'isTokenCopy' => true,
                    ],
                    $this->card('card-1', 'Real Bear', 'battlefield', 2, 2, 2, 2),
                ],
            ]));

            (new GameCommandHandler())->apply($game, 'cards.moved', [
                'playerId' => $actor->id(),
                'fromZone' => 'battlefield',
                'toZone' => $toZone,
                'instanceIds' => ['token-copy-1', 'card-1'],
            ], $actor);

            $zones = $game->snapshot()['players'][$actor->id()]['zones'];
            self::assertSame([], $zones['battlefield']);
            self::assertSame(['card-1'], array_map(
                static fn (array $card): string => $card['instanceId'],
                $zones[$toZone],
            ), sprintf('Only the real card should enter %s.', $toZone));
        }
    }

    public function testBattlefieldCountersAreClearedWhenCardLeavesBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Counter Bear', 'battlefield', 3, 3, 2, 2),
                    'counters' => ['+1/+1' => 1, 'red' => 2],
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'card-1',
        ], $actor);

        $graveyardCard = $game->snapshot()['players'][$actor->id()]['zones']['graveyard'][0];
        self::assertSame([], $graveyardCard['counters']);
        self::assertSame(2, $graveyardCard['power']);
        self::assertSame(2, $graveyardCard['toughness']);
    }

    public function testBattlefieldCountersArePreservedWhenCardMovesToAnotherBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Counter Bear', 'battlefield', 3, 3, 2, 2),
                    'counters' => ['+1/+1' => 1],
                ],
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'battlefield',
            'targetPlayerId' => $opponent->id(),
            'instanceId' => 'card-1',
        ], $actor);

        $movedCard = $game->snapshot()['players'][$opponent->id()]['zones']['battlefield'][0];
        self::assertSame(['+1/+1' => 1], $movedCard['counters']);
        self::assertSame(3, $movedCard['power']);
        self::assertSame(3, $movedCard['toughness']);
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

    public function testChangesBattleDefense(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Invasion of Zendikar', 'battlefield', 0, 0, 0, 0),
                    'defense' => 5,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.power_toughness.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'defense' => 6,
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame(6, $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['defense']);
        self::assertSame('Invasion of Zendikar defense increased from 5 to 6 (+1).', $snapshot['eventLog'][0]['message']);
    }

    public function testChangesSagaChapter(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Binding the Old Gods', 'battlefield', 0, 0, 0, 0),
                    'typeLine' => 'Enchantment - Saga',
                    'saga' => 1,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.power_toughness.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'saga' => 2,
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame(2, $snapshot['players'][$actor->id()]['zones']['battlefield'][0]['saga']);
        self::assertSame('Binding the Old Gods saga increased to II.', $snapshot['eventLog'][0]['message']);
    }

    public function testSagaZeroDeltaUsesShortMessage(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Binding the Old Gods', 'battlefield', 0, 0, 0, 0),
                    'typeLine' => 'Enchantment - Saga',
                    'saga' => 2,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.power_toughness.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'saga' => 2,
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame('Binding the Old Gods saga increased to II.', $snapshot['eventLog'][0]['message']);
    }

    public function testClampsBattleDefenseRange(): void
    {
        $actor = new User('owner@example.test', 'Owner');

        $highGame = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Invasion of Zendikar', 'battlefield', 0, 0, 0, 0),
                    'defense' => 5,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($highGame, 'card.power_toughness.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'defense' => 120,
        ], $actor);

        $highSnapshot = $highGame->snapshot();
        self::assertSame(99, $highSnapshot['players'][$actor->id()]['zones']['battlefield'][0]['defense']);
        self::assertSame('Invasion of Zendikar defense increased from 5 to 99 (+94).', $highSnapshot['eventLog'][0]['message']);

        $lowGame = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Invasion of Zendikar', 'battlefield', 0, 0, 0, 0),
                    'defense' => 5,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($lowGame, 'card.power_toughness.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'defense' => -5,
        ], $actor);

        $lowSnapshot = $lowGame->snapshot();
        self::assertSame(-1, $lowSnapshot['players'][$actor->id()]['zones']['battlefield'][0]['defense']);
        self::assertSame('Invasion of Zendikar defense decreased from 5 to -1 (-6).', $lowSnapshot['eventLog'][0]['message']);
    }

    public function testClearsManualPowerToughness(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Treasure', 'battlefield', 3, 3, 0, 0),
                    'power' => 3,
                    'toughness' => 3,
                    'defaultPower' => null,
                    'defaultToughness' => null,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.power_toughness.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'power' => null,
            'toughness' => null,
        ], $actor);

        $card = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertNull($card['power']);
        self::assertNull($card['toughness']);
        self::assertSame('Changed Treasure from 3/3 to -/-.', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testChangesDisplayedCardFace(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'hand' => [
                [
                    ...$this->card('card-1', 'Front // Back', 'hand', 0, 0, 0, 0),
                    'cardFaces' => [
                        ['name' => 'Front', 'imageUris' => ['normal' => '/front.jpg']],
                        ['name' => 'Back', 'imageUris' => ['normal' => '/back.jpg']],
                    ],
                    'activeFaceIndex' => 0,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.face.changed', [
            'playerId' => $actor->id(),
            'zone' => 'hand',
            'instanceId' => 'card-1',
            'faceIndex' => 1,
        ], $actor);

        $card = $game->snapshot()['players'][$actor->id()]['zones']['hand'][0];
        self::assertSame(1, $card['activeFaceIndex']);
        self::assertSame([], $game->snapshot()['eventLog']);
    }

    public function testLogsDisplayedCardFaceChangesOnBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Front // Back', 'battlefield', 0, 0, 0, 0),
                    'cardFaces' => [
                        ['name' => 'Front', 'imageUris' => ['normal' => '/front.jpg']],
                        ['name' => 'Back', 'imageUris' => ['normal' => '/back.jpg']],
                    ],
                    'activeFaceIndex' => 0,
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.face.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
            'faceIndex' => 1,
        ], $actor);

        $card = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame(1, $card['activeFaceIndex']);
        self::assertSame('Flipped Front to Back.', $game->snapshot()['eventLog'][0]['message']);
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

    public function testDefaultLoyaltyFallbackPrioritizesFaceStatsThenLegacyThenCardFaces(): void
    {
        $actor = new User('owner@example.test', 'Owner');

        $gameWithFaceStats = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-1', 'Adept', 'battlefield', 0, 0, 0, 0),
                    'loyalty' => 7,
                    'defaultLoyalty' => null,
                    'faceStats' => [
                        'root' => ['loyalty' => '3'],
                        'faces' => [['loyalty' => '2']],
                    ],
                    'cardFaces' => [['loyalty' => '1']],
                ],
            ],
        ]));
        (new GameCommandHandler())->apply($gameWithFaceStats, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'exile',
            'instanceId' => 'card-1',
        ], $actor);
        $faceStatsCard = $gameWithFaceStats->snapshot()['players'][$actor->id()]['zones']['exile'][0];
        self::assertSame(3, $faceStatsCard['loyalty']);
        self::assertSame(3, $faceStatsCard['defaultLoyalty']);

        $gameWithLegacy = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('card-2', 'Adept', 'battlefield', 0, 0, 0, 0),
                    'loyalty' => 6,
                    'defaultLoyalty' => null,
                    'faceStats' => [
                        'root' => ['loyalty' => null],
                        'faces' => [],
                    ],
                    'cardFaces' => [['loyalty' => '1']],
                ],
            ],
        ]));
        (new GameCommandHandler())->apply($gameWithLegacy, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'exile',
            'instanceId' => 'card-2',
        ], $actor);
        $legacyCard = $gameWithLegacy->snapshot()['players'][$actor->id()]['zones']['exile'][0];
        self::assertSame(6, $legacyCard['loyalty']);
        self::assertSame(6, $legacyCard['defaultLoyalty']);
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
        self::assertSame('ha robado 2 cartas.', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testLibraryViewLogsWithoutChangingLibrary(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'library.view', [
            'playerId' => $actor->id(),
            'count' => 2,
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame(['top-card', 'second-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $snapshot['players'][$actor->id()]['zones']['library'],
        ));
        self::assertSame('ha mirado sus proximos 2 robos en library.', $snapshot['eventLog'][0]['message']);
    }

    public function testRevealTopOnlyLeavesTopLibraryCardRevealed(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top', 'library', 1, 1, 1, 1),
                [
                    ...$this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
                    'revealedTo' => ['all'],
                ],
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'library.reveal_top', [
            'playerId' => $actor->id(),
            'count' => 1,
            'to' => $opponent->id(),
        ], $actor);

        $library = $game->snapshot()['players'][$actor->id()]['zones']['library'];
        self::assertFalse($library[0]['faceDown']);
        self::assertSame([$opponent->id()], $library[0]['revealedTo']);
        self::assertSame([], $library[1]['revealedTo']);
    }

    public function testRevealLibraryLetsTargetCloseByShufflingAndClearingReveal(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $other = new User('other@example.test', 'Other');
        $snapshot = $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
            ],
        ], $opponent->id());
        $snapshot['players'][$other->id()] = $this->player($other->id(), []);
        $game = new Game(new Room($actor), $snapshot);

        $handler = new GameCommandHandler();
        $handler->apply($game, 'library.reveal', [
            'playerId' => $actor->id(),
            'to' => $opponent->id(),
        ], $actor);

        $revealedLibrary = $game->snapshot()['players'][$actor->id()]['zones']['library'];
        self::assertSame([$opponent->id()], $revealedLibrary[0]['revealedTo']);
        self::assertSame([$opponent->id()], $revealedLibrary[1]['revealedTo']);
        self::assertSame([$opponent->id()], $game->snapshot()['players'][$actor->id()]['revealedLibraryTo']);
        self::assertFalse($revealedLibrary[0]['faceDown']);

        $this->expectException(\InvalidArgumentException::class);
        $handler->apply($game, 'library.shuffle', [
            'playerId' => $actor->id(),
            'reason' => 'revealed-library-closed',
        ], $other);
    }

    public function testRevealLibraryTargetCanCloseByShufflingAndClearingReveal(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
            ],
        ], $opponent->id()));

        $handler = new GameCommandHandler();
        $handler->apply($game, 'library.reveal', [
            'playerId' => $actor->id(),
            'to' => $opponent->id(),
        ], $actor);

        $handler->apply($game, 'library.shuffle', [
            'playerId' => $actor->id(),
            'reason' => 'revealed-library-closed',
        ], $opponent);

        foreach ($game->snapshot()['players'][$actor->id()]['zones']['library'] as $card) {
            self::assertSame([], $card['revealedTo']);
        }
        self::assertSame([], $game->snapshot()['players'][$actor->id()]['revealedLibraryTo']);
    }

    public function testMovingLibraryCardToHandCanHideOrRevealCardName(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top Secret', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Public Draw', 'library', 1, 1, 1, 1),
            ],
        ]));

        $handler = new GameCommandHandler();
        $handler->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'library',
            'toZone' => 'hand',
            'instanceId' => 'top-card',
            'reveal' => false,
        ], $actor);
        $handler->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'library',
            'toZone' => 'hand',
            'instanceId' => 'second-card',
            'reveal' => true,
        ], $actor);

        $hand = $game->snapshot()['players'][$actor->id()]['zones']['hand'];
        self::assertSame([], $hand[0]['revealedTo']);
        self::assertSame(['all'], $hand[1]['revealedTo']);
        self::assertStringNotContainsString('Top Secret', $game->snapshot()['eventLog'][0]['message']);
        self::assertStringContainsString('Public Draw', $game->snapshot()['eventLog'][1]['message']);
    }

    public function testPlayTopLibraryRevealedTogglesPersistentPlayerFlag(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
            ],
        ]));

        $handler = new GameCommandHandler();
        $handler->apply($game, 'library.play_top_revealed', [
            'playerId' => $actor->id(),
            'enabled' => true,
        ], $actor);

        self::assertTrue($game->snapshot()['players'][$actor->id()]['playTopLibraryRevealed']);
        self::assertSame(['top-card', 'second-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $game->snapshot()['players'][$actor->id()]['zones']['library'],
        ));

        $handler->apply($game, 'library.play_top_revealed', [
            'playerId' => $actor->id(),
            'enabled' => false,
        ], $actor);

        self::assertFalse($game->snapshot()['players'][$actor->id()]['playTopLibraryRevealed']);
    }

    public function testMoveTopCanMoveCardsToBottomOfLibrary(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
                $this->card('bottom-card', 'Bottom', 'library', 1, 1, 1, 1),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'library.move_top', [
            'playerId' => $actor->id(),
            'toZone' => 'library',
            'count' => 2,
            'position' => 'bottom',
        ], $actor);

        self::assertSame(['bottom-card', 'top-card', 'second-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $game->snapshot()['players'][$actor->id()]['zones']['library'],
        ));
        self::assertSame('Moved top 2 cards to bottom of library.', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testMoveTopCanMoveCardsToOpponentHandWithoutRevealingNames(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top Secret', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second Secret', 'library', 1, 1, 1, 1),
                $this->card('bottom-card', 'Bottom', 'library', 1, 1, 1, 1),
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'library.move_top', [
            'playerId' => $actor->id(),
            'toZone' => 'hand',
            'targetPlayerId' => $opponent->id(),
            'count' => 2,
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame(['bottom-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $snapshot['players'][$actor->id()]['zones']['library'],
        ));
        self::assertSame(['top-card', 'second-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $snapshot['players'][$opponent->id()]['zones']['hand'],
        ));
        self::assertSame($opponent->id(), $snapshot['players'][$opponent->id()]['zones']['hand'][0]['controllerId']);
        self::assertArrayNotHasKey('cardNames', $snapshot['eventLog'][0]);
        self::assertStringNotContainsString('Top Secret', $snapshot['eventLog'][0]['message']);
    }

    public function testMoveTopToOpponentBattlefieldLogsLinkedCardNames(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top Permanent', 'library', 1, 1, 1, 1),
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'library.move_top', [
            'playerId' => $actor->id(),
            'toZone' => 'battlefield',
            'targetPlayerId' => $opponent->id(),
            'count' => 1,
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame('top-card', $snapshot['players'][$opponent->id()]['zones']['battlefield'][0]['instanceId']);
        self::assertSame($opponent->id(), $snapshot['players'][$opponent->id()]['zones']['battlefield'][0]['controllerId']);
        self::assertSame(['Top Permanent'], $snapshot['eventLog'][0]['cardNames']);
    }

    public function testSelectRandomZoneCardLogsSelectedCardNameWithoutMovingIt(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Hidden Tutor', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Wrong Tutor', 'library', 1, 1, 1, 1),
            ],
        ]));
        $handler = new GameCommandHandler(null, new class() extends GameRandomizer {
            public function pickOne(array $items): mixed
            {
                return $items[0];
            }
        });

        $event = $handler->apply($game, 'zone.random_card.selected', [
            'playerId' => $actor->id(),
            'zone' => 'library',
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame(['top-card', 'second-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $snapshot['players'][$actor->id()]['zones']['library'],
        ));
        self::assertSame('ha seleccionado al azar Hidden Tutor de library.', $snapshot['eventLog'][0]['message']);
        self::assertSame('top-card', $snapshot['eventLog'][0]['cardInstanceId']);
        self::assertSame($actor->id(), $snapshot['eventLog'][0]['cardPlayerId']);
        self::assertSame('library', $snapshot['eventLog'][0]['cardZone']);
        self::assertSame([
            'playerId' => $actor->id(),
            'zone' => 'library',
            'instanceId' => 'top-card',
        ], $event->toArray()['payload']);
    }

    public function testReorderTopLibraryCardsOnlyChangesViewedPrefix(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
                $this->card('third-card', 'Third', 'library', 1, 1, 1, 1),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'library.reorder_top', [
            'playerId' => $actor->id(),
            'instanceIds' => ['second-card', 'top-card'],
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame(['second-card', 'top-card', 'third-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $snapshot['players'][$actor->id()]['zones']['library'],
        ));
        self::assertSame('ha alterado el orden de sus proximos 2 robos.', $snapshot['eventLog'][0]['message']);
    }

    public function testMovingCardToBattlefieldWithoutExplicitPositionUsesCenterPosition(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'graveyard' => [
                $this->card('card-1', 'Returned Bear', 'graveyard', 2, 2, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        $battlefieldCard = $game->snapshot()['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame(['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'], $battlefieldCard['position']);
    }

    public function testCommanderCastCounterLogIncludesPreviousAndNextValue(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), [
            'command' => [
                $this->card('commander-1', 'Atraxa', 'command', 4, 4, 4, 4),
            ],
        ]);
        $snapshot['counters'] = [
            'commander:commander-1' => ['casts' => 2],
        ];
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'counter.changed', [
            'scope' => 'commander:commander-1',
            'key' => 'casts',
            'value' => 3,
        ], $actor);
        $handler->apply($game, 'counter.changed', [
            'scope' => 'commander:commander-1',
            'key' => 'casts',
            'value' => 2,
        ], $actor);

        self::assertSame([
            'Atraxa cast count increased from 2 to 3.',
            'Atraxa cast count decreased from 3 to 2.',
        ], array_map(
            static fn (array $entry): string => $entry['message'],
            $game->snapshot()['eventLog'],
        ));
    }

    public function testCommanderCastCounterCannotGoBelowZeroOrCreateNoopLog(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), [
            'command' => [
                $this->card('commander-1', 'Atraxa', 'command', 4, 4, 4, 4),
            ],
        ]);
        $snapshot['counters'] = [
            'commander:commander-1' => ['casts' => 0],
        ];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'counter.changed', [
            'scope' => 'commander:commander-1',
            'key' => 'casts',
            'value' => -1,
        ], $actor);

        self::assertSame(0, $game->snapshot()['counters']['commander:commander-1']['casts']);
        self::assertSame([], $game->snapshot()['eventLog']);
    }

    public function testCommanderDamageIsTrackedByCommanderCard(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id(), [], $opponent->id());
        $snapshot['players'][$opponent->id()]['zones']['command'] = [
            $this->card('commander-1', 'Rograkh', 'command', 0, 1, 0, 1),
            $this->card('commander-2', 'Silas Renn', 'command', 2, 2, 2, 2),
        ];
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler();

        $handler->apply($game, 'commander.damage.changed', [
            'targetPlayerId' => $actor->id(),
            'sourcePlayerId' => $opponent->id(),
            'commanderInstanceId' => 'commander-1',
            'damage' => 11,
        ], $actor);
        $handler->apply($game, 'commander.damage.changed', [
            'targetPlayerId' => $actor->id(),
            'sourcePlayerId' => $opponent->id(),
            'commanderInstanceId' => 'commander-2',
            'damage' => 10,
        ], $actor);

        $damage = $game->snapshot()['players'][$actor->id()]['commanderDamage'];
        self::assertSame(11, $damage['commander-1']);
        self::assertSame(10, $damage['commander-2']);
        self::assertFalse($this->eventLogContains($game->snapshot(), 'ha muerto.'));

        $handler->apply($game, 'commander.damage.changed', [
            'targetPlayerId' => $actor->id(),
            'sourcePlayerId' => $opponent->id(),
            'commanderInstanceId' => 'commander-2',
            'damage' => 21,
        ], $actor);

        self::assertTrue($this->eventLogContains($game->snapshot(), 'ha muerto.'));
    }

    public function testCommanderDamageRequiresCommanderInstanceId(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [], $opponent->id()));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('commanderInstanceId is required.');

        (new GameCommandHandler())->apply($game, 'commander.damage.changed', [
            'targetPlayerId' => $actor->id(),
            'sourcePlayerId' => $opponent->id(),
            'damage' => 1,
        ], $actor);
    }

    public function testLifeAtZeroCreatesFinalDefeatedLogAndSuppressesFutureActorLogs(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('card-1', 'Bear', 'library', 2, 2, 2, 2),
            ],
        ]));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'life.changed', [
            'playerId' => $actor->id(),
            'delta' => -40,
        ], $actor);
        $handler->apply($game, 'library.draw', [
            'playerId' => $actor->id(),
        ], $actor);
        $handler->apply($game, 'life.changed', [
            'playerId' => $actor->id(),
            'delta' => -1,
        ], $actor);

        $snapshot = $game->snapshot();
        self::assertSame(-1, $snapshot['players'][$actor->id()]['life']);
        self::assertSame(['card-1'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $snapshot['players'][$actor->id()]['zones']['hand'],
        ));
        self::assertSame([
            'Lost 40 life (40 -> 0).',
            'ha muerto.',
        ], array_map(
            static fn (array $entry): string => $entry['message'],
            $snapshot['eventLog'],
        ));
        self::assertSame('player.defeated', $snapshot['eventLog'][1]['type']);
    }

    public function testAlreadyDefeatedPlayerWithoutDeathLogGetsDeathLogInsteadOfActionLog(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), [
            'library' => [
                $this->card('card-1', 'Bear', 'library', 2, 2, 2, 2),
            ],
        ]);
        $snapshot['players'][$actor->id()]['life'] = 0;
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'library.draw', [
            'playerId' => $actor->id(),
        ], $actor);

        self::assertSame(['card-1'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $game->snapshot()['players'][$actor->id()]['zones']['hand'],
        ));
        self::assertSame([
            'ha muerto.',
        ], array_map(
            static fn (array $entry): string => $entry['message'],
            $game->snapshot()['eventLog'],
        ));
        self::assertSame('player.defeated', $game->snapshot()['eventLog'][0]['type']);
    }

    public function testAlreadyDefeatedPlayerCannotCreateLifeLogByRaisingLifeBeforeDeathIsLogged(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), []);
        $snapshot['players'][$actor->id()]['life'] = 0;
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'life.changed', [
            'playerId' => $actor->id(),
            'life' => 5,
        ], $actor);

        self::assertSame(5, $game->snapshot()['players'][$actor->id()]['life']);
        self::assertSame([
            'ha muerto.',
        ], array_map(
            static fn (array $entry): string => $entry['message'],
            $game->snapshot()['eventLog'],
        ));
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

    public function testTurnPlayerChangeSkipsDefeatedPlayersWhileGameContinues(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $defeated = new User('defeated@example.test', 'Defeated');
        $alive = new User('alive@example.test', 'Alive');
        $snapshot = $this->snapshot($actor->id(), [], $defeated->id());
        $snapshot['players'][$alive->id()] = $this->player($alive->id(), []);
        $snapshot['players'][$defeated->id()]['life'] = 0;
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'turn.changed', [
            'activePlayerId' => $defeated->id(),
            'phase' => 'untap',
            'number' => 2,
        ], $actor);

        self::assertSame($alive->id(), $game->snapshot()['turn']['activePlayerId']);
        self::assertSame(
            sprintf('Turno 2: empieza el turno de %s. Fase untap.', $alive->id()),
            $game->snapshot()['eventLog'][0]['message'] ?? null,
        );
    }

    public function testTurnPlayerChangeKeepsTwoPlayerEndgameBehaviorWhenOnlyOnePlayerIsAlive(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $defeated = new User('defeated@example.test', 'Defeated');
        $snapshot = $this->snapshot($actor->id(), [], $defeated->id());
        $snapshot['players'][$defeated->id()]['life'] = 0;
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'turn.changed', [
            'activePlayerId' => $defeated->id(),
            'phase' => 'untap',
            'number' => 2,
        ], $actor);

        self::assertSame($defeated->id(), $game->snapshot()['turn']['activePlayerId']);
    }

    public function testConcedeByActiveTurnPlayerAdvancesTurnToNextAlivePlayer(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $next = new User('next@example.test', 'Next');
        $other = new User('other@example.test', 'Other');
        $snapshot = $this->snapshot($actor->id(), [], $next->id());
        $snapshot['players'][$other->id()] = $this->player($other->id(), []);
        $snapshot['turn'] = [
            'activePlayerId' => $actor->id(),
            'phase' => 'main-1',
            'number' => 3,
        ];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'game.concede', [], $actor);

        self::assertSame('conceded', $game->snapshot()['players'][$actor->id()]['status']);
        self::assertSame($next->id(), $game->snapshot()['turn']['activePlayerId']);
        self::assertSame('untap', $game->snapshot()['turn']['phase']);
        self::assertSame(3, $game->snapshot()['turn']['number']);
    }

    public function testConcedeReassignsMonarchToNextActivePlayerWhenCurrentMonarchLeaves(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $next = new User('next@example.test', 'Next');
        $snapshot = $this->snapshot($actor->id(), [], $next->id());
        $snapshot['turn'] = [
            'activePlayerId' => $actor->id(),
            'phase' => 'main-1',
            'number' => 4,
        ];
        $snapshot['specialEntities'] = [[
            'id' => 'monarch-1',
            'template' => 'monarch',
            'scope' => 'global',
            'ownerPlayerId' => $actor->id(),
            'card' => null,
            'state' => [],
            'createdAt' => '2026-06-16T00:00:00+00:00',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'game.concede', [], $actor);

        self::assertSame($next->id(), $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
    }

    public function testConcedeReassignsMonarchToActivePlayerWhenCurrentMonarchLeavesDuringAnotherPlayersTurn(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $active = new User('active@example.test', 'Active');
        $snapshot = $this->snapshot($actor->id(), [], $active->id());
        $snapshot['turn'] = [
            'activePlayerId' => $active->id(),
            'phase' => 'combat',
            'number' => 7,
        ];
        $snapshot['specialEntities'] = [[
            'id' => 'monarch-1',
            'template' => 'monarch',
            'scope' => 'global',
            'ownerPlayerId' => $actor->id(),
            'card' => null,
            'state' => [],
            'createdAt' => '2026-06-16T00:00:00+00:00',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'game.concede', [], $actor);

        self::assertSame($active->id(), $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
    }

    public function testConcedeReassignsInitiativeToNextActivePlayerWhenCurrentHolderLeaves(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $next = new User('next@example.test', 'Next');
        $snapshot = $this->snapshot($actor->id(), [], $next->id());
        $snapshot['turn'] = [
            'activePlayerId' => $actor->id(),
            'phase' => 'main-1',
            'number' => 4,
        ];
        $snapshot['specialEntities'] = [[
            'id' => 'initiative-1',
            'template' => 'initiative',
            'scope' => 'global',
            'ownerPlayerId' => $actor->id(),
            'card' => null,
            'state' => [],
            'createdAt' => '2026-06-16T00:00:00+00:00',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'game.concede', [], $actor);

        self::assertSame($next->id(), $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
    }

    public function testConcedeReassignsInitiativeToActivePlayerWhenCurrentHolderLeavesDuringAnotherPlayersTurn(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $active = new User('active@example.test', 'Active');
        $snapshot = $this->snapshot($actor->id(), [], $active->id());
        $snapshot['turn'] = [
            'activePlayerId' => $active->id(),
            'phase' => 'combat',
            'number' => 7,
        ];
        $snapshot['specialEntities'] = [[
            'id' => 'initiative-1',
            'template' => 'initiative',
            'scope' => 'global',
            'ownerPlayerId' => $actor->id(),
            'card' => null,
            'state' => [],
            'createdAt' => '2026-06-16T00:00:00+00:00',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'game.concede', [], $actor);

        self::assertSame($active->id(), $game->snapshot()['specialEntities'][0]['ownerPlayerId']);
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

    public function testZoneMoveAllEvaporatesTokensLeavingBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('token-1', 'Bear Token', 'battlefield', 2, 2, 2, 2),
                    'isToken' => true,
                ],
                $this->card('card-1', 'Real Bear', 'battlefield', 2, 2, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'zone.move_all', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
        ], $actor);

        $zones = $game->snapshot()['players'][$actor->id()]['zones'];
        self::assertSame([], $zones['battlefield']);
        self::assertSame(['card-1'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $zones['graveyard'],
        ));
    }

    public function testZoneMoveAllEvaporatesTokenCopiesLeavingBattlefieldForHandOrZonePiles(): void
    {
        foreach (['hand', 'library', 'graveyard', 'exile', 'command'] as $toZone) {
            $actor = new User('owner@example.test', 'Owner');
            $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
                'battlefield' => [
                    [
                        ...$this->card('token-copy-1', 'Bear Token', 'battlefield', 2, 2, 2, 2),
                        'isToken' => true,
                        'isTokenCopy' => true,
                    ],
                    $this->card('card-1', 'Real Bear', 'battlefield', 2, 2, 2, 2),
                ],
            ]));

            (new GameCommandHandler())->apply($game, 'zone.move_all', [
                'playerId' => $actor->id(),
                'fromZone' => 'battlefield',
                'toZone' => $toZone,
            ], $actor);

            $zones = $game->snapshot()['players'][$actor->id()]['zones'];
            self::assertSame([], $zones['battlefield']);
            self::assertSame(['card-1'], array_map(
                static fn (array $card): string => $card['instanceId'],
                $zones[$toZone],
            ), sprintf('Only the real card should enter %s.', $toZone));
        }
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
        self::assertSame('Moved Top Return from graveyard to top of library.', $game->snapshot()['eventLog'][0]['message']);
        self::assertSame('Moved Bottom Return from graveyard to bottom of library.', $game->snapshot()['eventLog'][1]['message']);
    }

    public function testViewedLibraryCardCanMoveToBottomOfSameLibrary(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top Secret', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
                $this->card('bottom-card', 'Bottom', 'library', 1, 1, 1, 1),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'library',
            'toZone' => 'library',
            'instanceId' => 'top-card',
            'position' => 'bottom',
        ], $actor);

        self::assertSame(['second-card', 'bottom-card', 'top-card'], array_map(
            static fn (array $card): string => $card['instanceId'],
            $game->snapshot()['players'][$actor->id()]['zones']['library'],
        ));
        self::assertSame('Moved a card to bottom of library.', $game->snapshot()['eventLog'][0]['message']);
        self::assertStringNotContainsString('Top Secret', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testViewedTopLibraryMoveUsesPrivateSourceContextInLog(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top Secret', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second', 'library', 1, 1, 1, 1),
                $this->card('third-card', 'Third', 'library', 1, 1, 1, 1),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'library',
            'toZone' => 'graveyard',
            'instanceId' => 'top-card',
            'sourceContext' => ['type' => 'libraryTopView', 'count' => 3],
        ], $actor);

        self::assertSame('Moved a card from the viewed top 3 library cards to graveyard.', $game->snapshot()['eventLog'][0]['message']);
        self::assertStringNotContainsString('Top Secret', $game->snapshot()['eventLog'][0]['message']);
    }

    public function testPublicZoneCardReturnedToLibraryExposesCardNameInLog(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('card-1', 'Private Return', 'battlefield', 1, 1, 1, 1),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'library',
            'instanceId' => 'card-1',
            'position' => 'top',
        ], $actor);

        $log = $game->snapshot()['eventLog'][0] ?? null;
        self::assertIsArray($log);
        self::assertSame('Moved Private Return from battlefield to top of library.', $log['message']);
        self::assertStringContainsString('Private Return', $log['message']);
        self::assertArrayNotHasKey('cardNames', $log);
    }

    public function testHandCardReturnedToLibraryDoesNotExposeCardNameInLog(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'hand' => [
                $this->card('card-1', 'Private Return', 'hand', 1, 1, 1, 1),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'hand',
            'toZone' => 'library',
            'instanceId' => 'card-1',
            'position' => 'top',
        ], $actor);

        $log = $game->snapshot()['eventLog'][0] ?? null;
        self::assertIsArray($log);
        self::assertSame('Moved a card from hand to top of library.', $log['message']);
        self::assertStringNotContainsString('Private Return', $log['message']);
        self::assertArrayNotHasKey('cardNames', $log);
    }

    public function testMultipleCardsCanReturnToLibraryInRandomOrder(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'library' => [
                $this->card('library-top', 'Top', 'library', 1, 1, 1, 1),
                $this->card('library-bottom', 'Bottom', 'library', 1, 1, 1, 1),
            ],
            'graveyard' => [
                $this->card('return-1', 'Return One', 'graveyard', 1, 1, 1, 1),
                $this->card('return-2', 'Return Two', 'graveyard', 1, 1, 1, 1),
                $this->card('return-3', 'Return Three', 'graveyard', 1, 1, 1, 1),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'cards.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'library',
            'instanceIds' => ['return-1', 'return-2', 'return-3'],
            'position' => 'top',
            'randomOrder' => true,
        ], $actor);

        $libraryIds = array_map(
            static fn (array $card): string => $card['instanceId'],
            $game->snapshot()['players'][$actor->id()]['zones']['library'],
        );
        self::assertEqualsCanonicalizing(['return-1', 'return-2', 'return-3'], array_slice($libraryIds, 0, 3));
        self::assertSame(['library-top', 'library-bottom'], array_slice($libraryIds, 3));
        self::assertSame(
            'Moved 3 cards from graveyard to top of library in random order.',
            $game->snapshot()['eventLog'][0]['message'] ?? null,
        );
        self::assertSame(['Return One', 'Return Two', 'Return Three'], $game->snapshot()['eventLog'][0]['cardNames']);
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

    public function testStackCommandsPreserveCardPayloadAndEventLog(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [[
                ...$this->card('card-1', 'Stack Bear', 'battlefield', 2, 2, 2, 2),
                'ownerId' => $actor->id(),
                'controllerId' => $actor->id(),
                'position' => ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
                'revealedTo' => [],
                'counters' => ['+1/+1' => 1],
            ]],
        ]));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'stack.card_added', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        $stackItem = $game->snapshot()['stack'][0];
        self::assertSame('card', $stackItem['kind']);
        self::assertSame('card-1', $stackItem['card']['instanceId']);
        self::assertSame($actor->id(), $stackItem['card']['ownerId']);
        self::assertSame($actor->id(), $stackItem['card']['controllerId']);
        self::assertSame('battlefield', $stackItem['card']['zone']);
        self::assertFalse($stackItem['card']['tapped']);
        self::assertSame(['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'], $stackItem['card']['position']);
        self::assertSame([], $stackItem['card']['revealedTo']);
        self::assertSame(['+1/+1' => 1], $stackItem['card']['counters']);
        self::assertSame('Added Stack Bear to stack.', $game->snapshot()['eventLog'][0]['message']);

        $handler->apply($game, 'stack.item_removed', [
            'id' => $stackItem['id'],
        ], $actor);

        self::assertSame([], $game->snapshot()['stack']);
        self::assertSame('Removed item from stack.', $game->snapshot()['eventLog'][1]['message']);
    }

    public function testArrowCreatedStoresOwnerAndOnlyOwnerCanRemoveIt(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('card-1', 'Bear', 'battlefield', 2, 2, 2, 2),
                $this->card('card-2', 'Elf', 'battlefield', 1, 1, 1, 1),
            ],
        ], $opponent->id()));

        (new GameCommandHandler())->apply($game, 'arrow.created', [
            'fromInstanceId' => 'card-1',
            'toInstanceId' => 'card-2',
        ], $actor);

        $arrow = $game->snapshot()['arrows'][0];
        self::assertSame($actor->id(), $arrow['ownerId']);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Only the arrow owner can remove it.');

        (new GameCommandHandler())->apply($game, 'arrow.removed', [
            'id' => $arrow['id'],
        ], $opponent);
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
        self::assertSame(['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'], $game->snapshot()['players'][$opponent->id()]['zones']['battlefield'][0]['position']);
    }

    public function testAttachmentCreatedStoresManualPermanentRelation(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('equipment-card', 'Sword', 'battlefield', 1, 1, 1, 1),
                $this->card('target-card', 'Bear', 'battlefield', 2, 2, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'target-card',
        ], $actor);

        $attachment = $game->snapshot()['attachments'][0];
        self::assertSame($actor->id(), $attachment['ownerId']);
        self::assertSame('equipment-card', $attachment['equipmentInstanceId']);
        self::assertSame('target-card', $attachment['attachedToInstanceId']);
        self::assertSame([], $game->snapshot()['eventLog']);
    }

    public function testAttachmentReequipReplacesPreviousTarget(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('equipment-card', 'Sword', 'battlefield', 1, 1, 1, 1),
                $this->card('first-target', 'Bear', 'battlefield', 2, 2, 2, 2),
                $this->card('second-target', 'Elf', 'battlefield', 1, 1, 1, 1),
            ],
        ]));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'first-target',
        ], $actor);
        $handler->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'second-target',
        ], $actor);

        self::assertCount(1, $game->snapshot()['attachments']);
        self::assertSame('second-target', $game->snapshot()['attachments'][0]['attachedToInstanceId']);
    }

    public function testAttachmentCannotUseLandAsEquipmentSource(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('land-card', 'Forest', 'battlefield', 0, 0, 0, 0),
                    'typeLine' => 'Basic Land - Forest',
                ],
                [
                    ...$this->card('target-card', 'Bear', 'battlefield', 2, 2, 2, 2),
                    'typeLine' => 'Creature - Bear',
                ],
            ],
        ]));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Lands cannot be attached to another permanent.');

        (new GameCommandHandler())->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'land-card',
            'attachedToInstanceId' => 'target-card',
        ], $actor);
    }

    public function testAttachmentCannotUseGameplayCardAsEquipmentSource(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler();

        foreach ([
            'emblem-card' => ['typeLine' => 'Emblem', 'layout' => 'emblem', 'message' => 'Emblems cannot be attached to another permanent.'],
            'dungeon-card' => ['typeLine' => 'Dungeon', 'layout' => 'dungeon', 'message' => 'Dungeons cannot be attached to another permanent.'],
        ] as $instanceId => $metadata) {
            $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
                'battlefield' => [
                    [
                        ...$this->card($instanceId, $instanceId, 'battlefield', 0, 0, 0, 0),
                        'typeLine' => $metadata['typeLine'],
                        'layout' => $metadata['layout'],
                    ],
                    [
                        ...$this->card('target-card', 'Bear', 'battlefield', 2, 2, 2, 2),
                        'typeLine' => 'Creature - Bear',
                    ],
                ],
            ]));

            try {
                $handler->apply($game, 'attachment.created', [
                    'equipmentInstanceId' => $instanceId,
                    'attachedToInstanceId' => 'target-card',
                ], $actor);
                self::fail('Expected gameplay attachment source to be rejected.');
            } catch (\InvalidArgumentException $exception) {
                self::assertSame($metadata['message'], $exception->getMessage());
            }
        }
    }

    public function testAttachmentCanUseTheRingAsEquipmentSource(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('the-ring-card', 'The Ring', 'battlefield', 0, 0, 0, 0),
                    'scryfallId' => '7215460e-8c06-47d0-94e5-d1832d0218af',
                    'typeLine' => 'Emblem // Card',
                    'layout' => 'double_faced_token',
                ],
                [
                    ...$this->card('target-card', 'Bear', 'battlefield', 2, 2, 2, 2),
                    'typeLine' => 'Creature - Bear',
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'the-ring-card',
            'attachedToInstanceId' => 'target-card',
        ], $actor);

        self::assertSame('the-ring-card', $game->snapshot()['attachments'][0]['equipmentInstanceId']);
    }

    public function testAttachmentCannotTargetGameplayCard(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler();

        foreach ([
            'emblem-card' => ['typeLine' => 'Emblem', 'layout' => 'emblem', 'message' => 'Emblems cannot be attachment targets.'],
            'dungeon-card' => ['typeLine' => 'Dungeon', 'layout' => 'dungeon', 'message' => 'Dungeons cannot be attachment targets.'],
        ] as $instanceId => $metadata) {
            $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
                'battlefield' => [
                    [
                        ...$this->card('equipment-card', 'Sword', 'battlefield', 1, 1, 1, 1),
                        'typeLine' => 'Artifact',
                    ],
                    [
                        ...$this->card($instanceId, $instanceId, 'battlefield', 0, 0, 0, 0),
                        'typeLine' => $metadata['typeLine'],
                        'layout' => $metadata['layout'],
                    ],
                ],
            ]));

            try {
                $handler->apply($game, 'attachment.created', [
                    'equipmentInstanceId' => 'equipment-card',
                    'attachedToInstanceId' => $instanceId,
                ], $actor);
                self::fail('Expected gameplay attachment target to be rejected.');
            } catch (\InvalidArgumentException $exception) {
                self::assertSame($metadata['message'], $exception->getMessage());
            }
        }
    }

    public function testAttachmentCannotTargetTheRing(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('equipment-card', 'Sword', 'battlefield', 1, 1, 1, 1),
                    'typeLine' => 'Artifact',
                ],
                [
                    ...$this->card('the-ring-card', 'The Ring // The Ring Tempts You', 'battlefield', 0, 0, 0, 0),
                    'typeLine' => 'Emblem // Card',
                    'layout' => 'double_faced_token',
                ],
            ],
        ]));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('The Ring cannot be an attachment target.');

        (new GameCommandHandler())->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'the-ring-card',
        ], $actor);
    }

    public function testAttachmentCanTargetLand(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('equipment-card', 'Sword', 'battlefield', 1, 1, 1, 1),
                    'typeLine' => 'Artifact',
                ],
                [
                    ...$this->card('land-card', 'Forest', 'battlefield', 0, 0, 0, 0),
                    'typeLine' => 'Basic Land - Forest',
                ],
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'land-card',
        ], $actor);

        self::assertSame('land-card', $game->snapshot()['attachments'][0]['attachedToInstanceId']);
    }

    public function testAttachmentCannotCrossPlayerBattlefields(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('equipment-card', 'Sword', 'battlefield', 1, 1, 1, 1),
            ],
        ]);
        $snapshot['players'][$opponent->id()] = [
            'user' => [
                'id' => $opponent->id(),
                'email' => $opponent->email(),
                'displayName' => $opponent->displayName(),
                'roles' => $opponent->getRoles(),
            ],
            'life' => 40,
            'zones' => [
                'library' => [],
                'hand' => [],
                'battlefield' => [
                    $this->card('target-card', 'Bear', 'battlefield', 2, 2, 2, 2),
                ],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ],
            'commanderDamage' => [],
            'counters' => [],
            'status' => 'active',
        ];
        $game = new Game(new Room($actor), $snapshot);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Attachments must stay on the same battlefield.');

        (new GameCommandHandler())->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'target-card',
        ], $actor);
    }

    public function testAttachmentAllowsBorrowedCardControlledOnActorBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('borrowed-equipment', 'Sword', 'battlefield', 1, 1, 1, 1),
                    'ownerId' => $opponent->id(),
                    'controllerId' => $actor->id(),
                ],
                $this->card('target-card', 'Bear', 'battlefield', 2, 2, 2, 2),
            ],
        ]));

        (new GameCommandHandler())->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'borrowed-equipment',
            'attachedToInstanceId' => 'target-card',
        ], $actor);

        self::assertSame('borrowed-equipment', $game->snapshot()['attachments'][0]['equipmentInstanceId']);
    }

    public function testAttachmentCannotUsePermanentWithAttachedCardsAsSource(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('source-target', 'Bear', 'battlefield', 2, 2, 2, 2),
                $this->card('attached-card', 'Sword', 'battlefield', 1, 1, 1, 1),
                $this->card('new-target', 'Elf', 'battlefield', 1, 1, 1, 1),
            ],
        ]);
        $snapshot['attachments'] = [[
            'id' => 'attachment-1',
            'ownerId' => $actor->id(),
            'equipmentInstanceId' => 'attached-card',
            'attachedToInstanceId' => 'source-target',
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Cards with attached permanents cannot be attached to another permanent.');

        (new GameCommandHandler())->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'source-target',
            'attachedToInstanceId' => 'new-target',
        ], $actor);
    }

    public function testAttachmentCanReequipNonLandPermanent(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [
            'battlefield' => [
                [
                    ...$this->card('equipment-card', 'Sword', 'battlefield', 1, 1, 1, 1),
                    'typeLine' => 'Artifact',
                ],
                [
                    ...$this->card('creature-card', 'Bear', 'battlefield', 2, 2, 2, 2),
                    'typeLine' => 'Creature - Bear',
                ],
                [
                    ...$this->card('artifact-card', 'Relic', 'battlefield', 0, 0, 0, 0),
                    'typeLine' => 'Artifact',
                ],
            ],
        ]));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'creature-card',
        ], $actor);
        $handler->apply($game, 'attachment.created', [
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'artifact-card',
        ], $actor);

        self::assertCount(1, $game->snapshot()['attachments']);
        self::assertSame('artifact-card', $game->snapshot()['attachments'][0]['attachedToInstanceId']);
    }

    public function testAttachmentCanBeRemovedByEquipmentInstanceId(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('equipment-card', 'Sword', 'battlefield', 1, 1, 1, 1),
                $this->card('target-card', 'Bear', 'battlefield', 2, 2, 2, 2),
            ],
        ]);
        $snapshot['attachments'] = [[
            'id' => 'attachment-1',
            'ownerId' => $actor->id(),
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'target-card',
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'attachment.removed', [
            'equipmentInstanceId' => 'equipment-card',
        ], $actor);

        self::assertSame([], $game->snapshot()['attachments']);
        self::assertSame([], $game->snapshot()['eventLog']);
    }

    public function testAttachmentIsPrunedWhenEndpointLeavesBattlefield(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->snapshot($actor->id(), [
            'battlefield' => [
                $this->card('equipment-card', 'Sword', 'battlefield', 1, 1, 1, 1),
                $this->card('target-card', 'Bear', 'battlefield', 2, 2, 2, 2),
            ],
        ]);
        $snapshot['attachments'] = [[
            'id' => 'attachment-1',
            'equipmentInstanceId' => 'equipment-card',
            'attachedToInstanceId' => 'target-card',
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]];
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'target-card',
        ], $actor);

        self::assertSame([], $game->snapshot()['attachments']);
    }

    public function testChatReactionIsPersistedAndToggledPerPlayer(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), [], $opponent->id()));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'chat.message', ['message' => 'hello table'], $actor);
        $messageId = $game->snapshot()['chat'][0]['id'] ?? null;

        self::assertIsString($messageId);

        $handler->apply($game, 'chat.reaction.toggled', [
            'messageId' => $messageId,
            'reaction' => 'like',
        ], $opponent);

        $message = $game->snapshot()['chat'][0];
        self::assertSame($opponent->id(), $message['reactions']['like'][0]['userId'] ?? null);
        self::assertSame('Opponent', $message['reactions']['like'][0]['displayName'] ?? null);

        $handler->apply($game, 'chat.reaction.toggled', [
            'messageId' => $messageId,
            'reaction' => 'love',
        ], $opponent);

        $message = $game->snapshot()['chat'][0];
        self::assertArrayNotHasKey('like', $message['reactions']);
        self::assertSame($opponent->id(), $message['reactions']['love'][0]['userId'] ?? null);

        $handler->apply($game, 'chat.reaction.toggled', [
            'messageId' => $messageId,
            'reaction' => 'love',
        ], $opponent);

        self::assertSame([], $game->snapshot()['chat'][0]['reactions']);
    }

    public function testChatReactionRejectsOwnMessage(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id(), []));
        $handler = new GameCommandHandler();

        $handler->apply($game, 'chat.message', ['message' => 'own message'], $actor);
        $messageId = $game->snapshot()['chat'][0]['id'] ?? null;

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('You cannot react to this chat message.');

        $handler->apply($game, 'chat.reaction.toggled', [
            'messageId' => $messageId,
            'reaction' => 'like',
        ], $actor);
    }

    public function testTakeMulliganReturnsHandToLibraryShufflesAndDrawsNewHand(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $snapshot = $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 2, 'hand'),
            'library' => $this->cards('library', 7, 'library'),
        ]);
        $game = new Game(new Room($actor), $snapshot);
        $handler = new GameCommandHandler(null, new class() extends GameRandomizer {
            public function shuffle(array $items): array
            {
                return array_reverse($items);
            }
        });

        $handler->apply($game, 'mulligan.take', [], $actor);

        $player = $game->snapshot()['players'][$actor->id()];
        self::assertSame(1, $player['mulligan']['mulligansTaken']);
        self::assertSame('DECIDING', $player['mulligan']['status']);
        self::assertCount(7, $player['zones']['hand']);
        self::assertCount(2, $player['zones']['library']);
        self::assertSame('hand-2', $player['zones']['hand'][0]['instanceId']);
    }

    public function testNormalGameplayCommandsAreRejectedDuringMulligan(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => [],
            'library' => $this->cards('library', 3, 'library'),
        ]));

        try {
            (new GameCommandHandler())->apply($game, 'library.draw', [
                'playerId' => $actor->id(),
            ], $actor);
            self::fail('Normal draw was accepted during mulligan.');
        } catch (\InvalidArgumentException $exception) {
            self::assertSame('Game is in mulligan phase.', $exception->getMessage());
        }

        self::assertCount(0, $game->snapshot()['players'][$actor->id()]['zones']['hand']);
        self::assertCount(3, $game->snapshot()['players'][$actor->id()]['zones']['library']);
        self::assertSame('MULLIGAN', $game->snapshot()['gamePhase']);
    }

    public function testLondonSecondEffectiveMulliganRequiresOneBottomCard(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 7, 'hand'),
        ], Room::MULLIGAN_LONDON, true, 2));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Incorrect number of bottom cards selected.');

        (new GameCommandHandler())->apply($game, 'mulligan.keep', [], $actor);
    }

    public function testLondonBottomsCardsInClientOrder(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 1, 'library'),
        ], Room::MULLIGAN_LONDON, false, 2));

        $event = (new GameCommandHandler())->apply($game, 'mulligan.keep', [
            'bottomCardInstanceIds' => ['hand-2', 'hand-1'],
        ], $actor);

        $libraryIds = array_map(
            static fn (array $card): string => $card['instanceId'],
            $game->snapshot()['players'][$actor->id()]['zones']['library'],
        );
        self::assertSame(['library-1', 'hand-2', 'hand-1'], $libraryIds);
        self::assertSame('READY', $game->snapshot()['players'][$actor->id()]['mulligan']['status']);
        self::assertSame(['bottomCardCount' => 2], $event->toArray()['payload']);
    }

    public function testGenerousRequiresThreeBottomCardsAtStart(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 10, 'hand'),
        ], Room::MULLIGAN_GENEROUS));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Incorrect number of bottom cards selected.');

        (new GameCommandHandler())->apply($game, 'mulligan.keep', [], $actor);
    }

    public function testGenerousRandomizesBottomOrderServerSide(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 10, 'hand'),
        ], Room::MULLIGAN_GENEROUS));
        $handler = new GameCommandHandler(null, new class() extends GameRandomizer {
            public function shuffle(array $items): array
            {
                return array_reverse($items);
            }
        });

        $handler->apply($game, 'mulligan.keep', [
            'bottomCardInstanceIds' => ['hand-1', 'hand-2', 'hand-3'],
        ], $actor);

        $libraryIds = array_map(
            static fn (array $card): string => $card['instanceId'],
            $game->snapshot()['players'][$actor->id()]['zones']['library'],
        );
        self::assertSame(['hand-3', 'hand-2', 'hand-1'], $libraryIds);
        self::assertNotSame(['hand-1', 'hand-2', 'hand-3'], $libraryIds);
    }

    public function testVancouverEntersScryingWhenEffectiveMulligansIsGreaterThanZero(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 6, 'hand'),
            'library' => $this->cards('library', 1, 'library'),
        ], Room::MULLIGAN_VANCOUVER, false, 1));

        $event = (new GameCommandHandler())->apply($game, 'mulligan.keep', [], $actor);

        $mulligan = $game->snapshot()['players'][$actor->id()]['mulligan'];
        self::assertSame('SCRYING', $mulligan['status']);
        self::assertSame('library-1', $mulligan['scryCardInstanceId']);
        self::assertSame('MULLIGAN', $game->snapshot()['gamePhase']);
        self::assertSame(['bottomCardCount' => 0], $event->toArray()['payload']);
    }

    public function testVancouverScryConfirmEventDoesNotExposeScryChoice(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 6, 'hand'),
            'library' => $this->cards('library', 1, 'library'),
        ], Room::MULLIGAN_VANCOUVER, false, 1, 'SCRYING'));
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['mulligan']['scryCardInstanceId'] = 'library-1';
        $game->replaceSnapshot($snapshot);

        $event = (new GameCommandHandler())->apply($game, 'mulligan.scry_confirm', [
            'destination' => 'BOTTOM',
        ], $actor);

        self::assertSame([], $event->toArray()['payload']);
    }

    public function testVancouverDoesNotEnterScryingWhenEffectiveMulligansIsZero(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 7, 'hand'),
            'library' => $this->cards('library', 1, 'library'),
        ], Room::MULLIGAN_VANCOUVER, true, 1));

        (new GameCommandHandler())->apply($game, 'mulligan.keep', [], $actor);

        self::assertSame('READY', $game->snapshot()['players'][$actor->id()]['mulligan']['status']);
        self::assertSame('PLAYING', $game->snapshot()['gamePhase']);
    }

    public function testParisNeverEntersScrying(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 6, 'hand'),
            'library' => $this->cards('library', 1, 'library'),
        ], Room::MULLIGAN_PARIS, false, 1));

        (new GameCommandHandler())->apply($game, 'mulligan.keep', [], $actor);

        self::assertSame('READY', $game->snapshot()['players'][$actor->id()]['mulligan']['status']);
        self::assertSame('PLAYING', $game->snapshot()['gamePhase']);
    }

    public function testRejectsBottomCardThatIsNotInHand(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 7, 'hand'),
        ], Room::MULLIGAN_LONDON, false, 1));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Selected bottom card is not in hand.');

        (new GameCommandHandler())->apply($game, 'mulligan.keep', [
            'bottomCardInstanceIds' => ['library-1'],
        ], $actor);
    }

    public function testRejectsIncorrectBottomSelectionCount(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 7, 'hand'),
        ], Room::MULLIGAN_LONDON, false, 2));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Incorrect number of bottom cards selected.');

        (new GameCommandHandler())->apply($game, 'mulligan.keep', [
            'bottomCardInstanceIds' => ['hand-1'],
        ], $actor);
    }

    public function testRejectsBottomSelectionForVancouverAndParis(): void
    {
        foreach ([Room::MULLIGAN_VANCOUVER, Room::MULLIGAN_PARIS] as $rule) {
            $actor = new User($rule.'@example.test', $rule);
            $game = new Game(new Room($actor), $this->mulliganSnapshot($actor->id(), [
                'hand' => $this->cards('hand', 7, 'hand'),
            ], $rule));

            try {
                (new GameCommandHandler())->apply($game, 'mulligan.keep', [
                    'bottomCardInstanceIds' => ['hand-1'],
                ], $actor);
                self::fail(sprintf('%s accepted bottom card selections.', $rule));
            } catch (\InvalidArgumentException $exception) {
                self::assertSame('This mulligan rule does not allow bottom card selections.', $exception->getMessage());
            }
        }
    }

    public function testAllReadyPlayersAdvanceGamePhaseToPlaying(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $snapshot = $this->mulliganSnapshot($actor->id(), [
            'hand' => $this->cards('hand', 7, 'hand'),
        ], Room::MULLIGAN_LONDON, true, 0, 'DECIDING', $opponent->id(), 'READY');
        $game = new Game(new Room($actor), $snapshot);

        (new GameCommandHandler())->apply($game, 'mulligan.keep', [], $actor);

        self::assertSame('READY', $game->snapshot()['players'][$actor->id()]['mulligan']['status']);
        self::assertSame('PLAYING', $game->snapshot()['gamePhase']);
    }

    public function testNormalizeSnapshotBuildsLocationIndex(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler();

        $snapshot = $handler->normalizeSnapshot($this->snapshot($actor->id(), [
            'library' => [$this->card('library-1', 'Library Card', 'library', 1, 1, 1, 1)],
            'battlefield' => [$this->card('battlefield-1', 'Battlefield Card', 'battlefield', 2, 2, 2, 2)],
        ]));

        self::assertSame('library', $snapshot['loc']['library-1']['zone']);
        self::assertSame(0, $snapshot['loc']['library-1']['index']);
        self::assertSame('battlefield', $snapshot['loc']['battlefield-1']['zone']);
        self::assertSame(0, $snapshot['loc']['battlefield-1']['index']);
    }

    public function testLocationIndexUpdatesAfterCardMove(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler();
        $game = new Game(new Room($actor), $handler->normalizeSnapshot($this->snapshot($actor->id(), [
            'graveyard' => [$this->card('card-1', 'Recovered Bear', 'graveyard', 2, 2, 2, 2)],
        ])));

        $handler->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'battlefield',
            'instanceId' => 'card-1',
        ], $actor);

        self::assertSame('battlefield', $game->snapshot()['loc']['card-1']['zone']);
        self::assertSame(0, $game->snapshot()['loc']['card-1']['index']);
    }

    public function testLocationIndexUpdatesAfterLibraryDraw(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler();
        $game = new Game(new Room($actor), $handler->normalizeSnapshot($this->snapshot($actor->id(), [
            'library' => [
                $this->card('top-card', 'Top Card', 'library', 1, 1, 1, 1),
                $this->card('second-card', 'Second Card', 'library', 1, 1, 1, 1),
            ],
        ])));

        $handler->apply($game, 'library.draw', [
            'playerId' => $actor->id(),
        ], $actor);

        self::assertSame('hand', $game->snapshot()['loc']['top-card']['zone']);
        self::assertSame('library', $game->snapshot()['loc']['second-card']['zone']);
        self::assertSame(0, $game->snapshot()['loc']['second-card']['index']);
    }

    public function testLocationIndexUpdatesAfterMovingManyCards(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler();
        $game = new Game(new Room($actor), $handler->normalizeSnapshot($this->snapshot($actor->id(), [
            'graveyard' => [
                $this->card('card-1', 'One', 'graveyard', 1, 1, 1, 1),
                $this->card('card-2', 'Two', 'graveyard', 1, 1, 1, 1),
                $this->card('card-3', 'Three', 'graveyard', 1, 1, 1, 1),
            ],
        ])));

        $handler->apply($game, 'cards.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'library',
            'instanceIds' => ['card-1', 'card-2', 'card-3'],
            'position' => 'bottom',
        ], $actor);

        self::assertSame('library', $game->snapshot()['loc']['card-1']['zone']);
        self::assertSame(0, $game->snapshot()['loc']['card-1']['index']);
        self::assertSame(1, $game->snapshot()['loc']['card-2']['index']);
        self::assertSame(2, $game->snapshot()['loc']['card-3']['index']);
    }

    public function testEvaporatingTokenMoveRemovesLocationIndexEntry(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler();
        $snapshot = $handler->normalizeSnapshot($this->snapshot($actor->id(), [
            'battlefield' => [[
                ...$this->card('token-1', 'Goblin Token', 'battlefield', 1, 1, 1, 1),
                'isToken' => true,
            ]],
        ]));
        $game = new Game(new Room($actor), $snapshot);

        $handler->apply($game, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'token-1',
        ], $actor);

        self::assertArrayNotHasKey('token-1', $game->snapshot()['loc']);
    }

    public function testSimpleInstanceCommandDoesNotTriggerFullScanWhenLocAlreadyExists(): void
    {
        $actor = new User('owner@example.test', 'Owner');
        $handler = new GameCommandHandler();
        $game = new Game(new Room($actor), $handler->normalizeSnapshot($this->snapshot($actor->id(), [
            'battlefield' => [$this->card('card-1', 'Tap Target', 'battlefield', 2, 2, 2, 2)],
        ])));

        $handler->apply($game, 'card.tapped', [
            'playerId' => $actor->id(),
            'instanceId' => 'card-1',
            'tapped' => true,
        ], $actor);

        self::assertSame(0, $handler->consumeLastCommandMetrics()['full_scan_count'] ?? null);
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
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ];
    }

    /**
     * @param array<string,list<array<string,mixed>>> $actorZones
     */
    private function mulliganSnapshot(
        string $actorId,
        array $actorZones,
        string $rule = Room::MULLIGAN_LONDON,
        bool $firstMulliganFree = true,
        int $mulligansTaken = 0,
        string $status = 'DECIDING',
        ?string $opponentId = null,
        string $opponentStatus = 'DECIDING',
    ): array {
        $snapshot = $this->snapshot($actorId, $actorZones, $opponentId);
        $snapshot['gamePhase'] = 'MULLIGAN';
        $snapshot['mulligan'] = [
            'rule' => $rule,
            'firstMulliganFree' => $firstMulliganFree,
        ];
        $snapshot['players'][$actorId]['mulligan'] = $this->mulliganPlayerState($rule, $firstMulliganFree, $mulligansTaken, $status);
        if ($opponentId !== null) {
            $snapshot['players'][$opponentId]['mulligan'] = $this->mulliganPlayerState($rule, $firstMulliganFree, 0, $opponentStatus);
        }

        return $snapshot;
    }

    /**
     * @return array<string,mixed>
     */
    private function mulliganPlayerState(string $rule, bool $firstMulliganFree, int $mulligansTaken, string $status): array
    {
        return [
            ...GameMulliganRules::calculateMulliganState($rule, $firstMulliganFree, $mulligansTaken),
            'status' => $status,
            'ready' => $status === 'READY',
            'scryCardInstanceId' => null,
        ];
    }

    private function eventLogContains(array $snapshot, string $message): bool
    {
        foreach ($snapshot['eventLog'] ?? [] as $entry) {
            if (($entry['message'] ?? null) === $message) {
                return true;
            }
        }

        return false;
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

    /**
     * @return list<array<string,mixed>>
     */
    private function cards(string $prefix, int $count, string $zone): array
    {
        $cards = [];
        for ($index = 1; $index <= $count; ++$index) {
            $cards[] = $this->card(
                sprintf('%s-%d', $prefix, $index),
                sprintf('%s %d', $prefix, $index),
                $zone,
                2,
                2,
                2,
                2,
            );
        }

        return $cards;
    }

    private function card(
        string $instanceId,
        string $name,
        string $zone,
        int $power,
        int $toughness,
        int $basePower,
        int $baseToughness,
        ?int $baseDefense = null,
    ): array {
        return [
            'instanceId' => $instanceId,
            'name' => $name,
            'zone' => $zone,
            'power' => $power,
            'toughness' => $toughness,
            'defaultPower' => $basePower,
            'defaultToughness' => $baseToughness,
            'defaultDefense' => $baseDefense,
            'tapped' => false,
        ];
    }
}
