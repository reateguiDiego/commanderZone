<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameProjectionService;
use App\Application\Game\GameRandomizer;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketPatchBuilder;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameWebsocketPatchBuilderTest extends TestCase
{
    public function testBuildsMinimalLifePatchWithClientActionIdAndConsecutiveVersion(): void
    {
        [$game, $actor] = $this->game();
        $message = $this->applyAndBuild($game, $actor, 'life.changed', ['playerId' => $actor->id(), 'delta' => -3], 'action-life');

        self::assertSame('game_patch', $message['kind']);
        self::assertSame(1, $message['baseVersion']);
        self::assertSame(2, $message['version']);
        self::assertSame('action-life', $message['clientActionId']);
        self::assertSame([
            [
            'op' => 'player.life.set',
            'playerId' => $actor->id(),
            'value' => 37,
            ],
            [
                'op' => 'eventLog.append',
                'entries' => [$message['operations'][1]['entries'][0]],
            ],
        ], $message['operations']);
        self::assertSame('life.changed', $message['operations'][1]['entries'][0]['type']);
    }

    public function testBuildsCommanderDamageAndPlayerCounterPatches(): void
    {
        [$game, $actor, $opponent] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['players'][$opponent->id()]['zones']['command'] = [
            [
                ...$this->card('commander-1', $opponent->id(), ['x' => 0, 'y' => 0]),
                'name' => 'Opponent Commander',
            ],
        ];
        $game->replaceSnapshot($snapshot);

        $commanderDamage = $this->applyAndBuild($game, $actor, 'commander.damage.changed', [
            'targetPlayerId' => $actor->id(),
            'sourcePlayerId' => $opponent->id(),
            'commanderInstanceId' => 'commander-1',
            'damage' => 7,
        ], 'action-damage');
        self::assertSame([
            [
            'op' => 'player.commanderDamage.set',
            'playerId' => $actor->id(),
            'commanderDamage' => ['commander-1' => 7],
            ],
            [
                'op' => 'eventLog.append',
                'entries' => [$commanderDamage['operations'][1]['entries'][0]],
            ],
        ], $commanderDamage['operations']);
        self::assertSame('commander.damage.changed', $commanderDamage['operations'][1]['entries'][0]['type']);

        $counter = $this->applyAndBuild($game, $actor, 'counter.changed', [
            'scope' => 'player:'.$actor->id(),
            'key' => 'poison',
            'value' => 2,
        ], 'action-counter');
        self::assertSame([
            [
            'op' => 'player.counters.set',
            'playerId' => $actor->id(),
            'counters' => ['poison' => 2],
            ],
            [
                'op' => 'eventLog.append',
                'entries' => [$counter['operations'][1]['entries'][0]],
            ],
        ], $counter['operations']);
        self::assertSame('counter.changed', $counter['operations'][1]['entries'][0]['type']);
    }

    public function testBuildsChatDiceAndTurnPatchesFromAppendedEntries(): void
    {
        [$game, $actor, $opponent] = $this->game();

        $chat = $this->applyAndBuild($game, $actor, 'chat.message', ['message' => 'hello'], 'action-chat');
        self::assertSame('chat.append', $chat['operations'][0]['op']);
        self::assertSame('hello', $chat['operations'][0]['entries'][0]['message']);
        $messageId = $chat['operations'][0]['entries'][0]['id'] ?? null;
        self::assertIsString($messageId);

        $reaction = $this->applyAndBuild($game, $opponent, 'chat.reaction.toggled', [
            'messageId' => $messageId,
            'reaction' => 'like',
        ], 'action-chat-reaction');
        self::assertSame('chat.message.set', $reaction['operations'][0]['op']);
        self::assertSame($messageId, $reaction['operations'][0]['message']['id']);
        self::assertSame($opponent->id(), $reaction['operations'][0]['message']['reactions']['like'][0]['userId'] ?? null);

        $dice = $this->applyAndBuild(
            $game,
            $actor,
            'dice.rolled',
            ['kind' => 'd6'],
            'action-dice',
            new GameCommandHandler(null, new class() extends GameRandomizer {
                public function roll(string $kind): string|int
                {
                    TestCase::assertSame('d6', $kind);

                    return 4;
                }
            }),
        );
        self::assertSame('eventLog.append', $dice['operations'][0]['op']);
        self::assertSame('dice.rolled', $dice['operations'][0]['entries'][0]['type']);

        $turn = $this->applyAndBuild($game, $actor, 'turn.changed', [
            'activePlayerId' => $opponent->id(),
            'phase' => 'combat',
            'number' => 2,
        ], 'action-turn');
        self::assertSame('turn.set', $turn['operations'][0]['op']);
        self::assertSame($opponent->id(), $turn['operations'][0]['turn']['activePlayerId']);
        self::assertSame('eventLog.append', $turn['operations'][1]['op']);
    }

    public function testBuildsCardPositionPatchPreservingRatioPosition(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();

        $message = $this->applyAndBuild($game, $actor, 'card.position.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'position' => ['x' => 0.42, 'y' => 0.64, 'unit' => 'ratio'],
        ], 'action-position');

        self::assertSame([[
            'op' => 'card.position.set',
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'position' => ['x' => 0.42, 'y' => 0.64, 'unit' => 'ratio'],
        ]], $message['operations']);
    }

    public function testBuildsSingleCardsPositionPatchForMultipleCards(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();

        $message = $this->applyAndBuild($game, $actor, 'cards.position.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'positions' => [
                ['instanceId' => 'battlefield-1', 'position' => ['x' => 0.1, 'y' => 0.2, 'unit' => 'ratio']],
                ['instanceId' => 'battlefield-2', 'position' => ['x' => 0.3, 'y' => 0.4, 'unit' => 'ratio']],
            ],
        ], 'action-positions');

        self::assertSame([[
            'op' => 'cards.position.set',
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'positions' => [
                ['instanceId' => 'battlefield-1', 'position' => ['x' => 0.1, 'y' => 0.2, 'unit' => 'ratio']],
                ['instanceId' => 'battlefield-2', 'position' => ['x' => 0.3, 'y' => 0.4, 'unit' => 'ratio']],
            ],
        ]], $message['operations']);
    }

    public function testBuildsCardTappedPatchWithoutPosition(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();

        $message = $this->applyAndBuild($game, $actor, 'card.tapped', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'tapped' => true,
        ], 'action-tap');

        self::assertSame([
            [
                'op' => 'card.state.set',
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
                'tapped' => true,
            ],
            [
                'op' => 'eventLog.append',
                'entries' => $message['operations'][1]['entries'],
            ],
        ], $message['operations']);
        self::assertSame('card.tapped', $message['operations'][1]['entries'][0]['type'] ?? null);
        self::assertSame('Tapped Battlefield One.', $message['operations'][1]['entries'][0]['message'] ?? null);
        self::assertArrayNotHasKey('position', $message['operations'][0]);
    }

    public function testBuildsCardUntappedPatchWithEventLog(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();

        $message = $this->applyAndBuild($game, $actor, 'card.tapped', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'tapped' => false,
        ], 'action-untap');

        self::assertSame([
            [
                'op' => 'card.state.set',
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => 'battlefield-1',
                'tapped' => false,
            ],
            [
                'op' => 'eventLog.append',
                'entries' => $message['operations'][1]['entries'],
            ],
        ], $message['operations']);
        self::assertSame('card.tapped', $message['operations'][1]['entries'][0]['type'] ?? null);
        self::assertSame('Untapped Battlefield One.', $message['operations'][1]['entries'][0]['message'] ?? null);
    }

    public function testCardTappedPatchSizeStaysStableAcrossRepeatedToggles(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();

        $tapMessage = $this->applyAndBuild($game, $actor, 'card.tapped', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'tapped' => true,
        ], 'action-tap-1');
        $untapMessage = $this->applyAndBuild($game, $actor, 'card.tapped', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
            'tapped' => false,
        ], 'action-tap-2');
        [$movementGame, $movementActor] = $this->gameWithMovementCards();
        $moveMessage = $this->applyAndBuildProjected($movementGame, $movementActor, 'card.moved', [
            'playerId' => $movementActor->id(),
            'fromZone' => 'hand',
            'toZone' => 'battlefield',
            'instanceId' => 'hand-1',
        ], 'action-move-1', $movementActor);

        $tapCharacters = strlen(json_encode($tapMessage, JSON_THROW_ON_ERROR));
        $untapCharacters = strlen(json_encode($untapMessage, JSON_THROW_ON_ERROR));
        $moveCharacters = strlen(json_encode($moveMessage, JSON_THROW_ON_ERROR));

        self::assertSame(['card.state.set', 'eventLog.append'], array_column($tapMessage['operations'], 'op'));
        self::assertSame(['card.state.set', 'eventLog.append'], array_column($untapMessage['operations'], 'op'));
        self::assertLessThanOrEqual(4, abs($tapCharacters - $untapCharacters));
        self::assertGreaterThan($tapCharacters, $moveCharacters);
        self::assertGreaterThan($untapCharacters, $moveCharacters);
    }

    public function testBuildsCardMovePatchWithCountsForVisibleMovement(): void
    {
        [$game, $actor] = $this->gameWithMovementCards();

        $message = $this->applyAndBuildProjected($game, $actor, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'hand',
            'toZone' => 'battlefield',
            'instanceId' => 'hand-1',
        ], 'action-move', $actor);

        self::assertSame('game_patch', $message['kind']);
        self::assertSame(1, $message['baseVersion']);
        self::assertSame(2, $message['version']);
        self::assertSame('action-move', $message['clientActionId']);
        self::assertSame('card.move', $message['operations'][0]['op']);
        self::assertSame('hand-1', $message['operations'][0]['instanceId']);
        self::assertSame(['playerId' => $actor->id(), 'zone' => 'hand'], $message['operations'][0]['from']);
        self::assertSame('battlefield', $message['operations'][0]['to']['zone']);
        self::assertContains([
            'op' => 'zone.counts.set',
            'playerId' => $actor->id(),
            'counts' => ['hand' => 0, 'battlefield' => 2],
        ], $message['operations']);
    }

    public function testBuildsMultipleCardMovePatchesWithoutFullZones(): void
    {
        [$game, $actor] = $this->gameWithMovementCards();

        $message = $this->applyAndBuildProjected($game, $actor, 'cards.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceIds' => ['battlefield-1'],
        ], 'action-multi-move', $actor);
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertSame('card.move', $message['operations'][0]['op']);
        self::assertStringNotContainsString('"snapshot"', $encoded);
        self::assertStringNotContainsString('"players"', $encoded);
        self::assertStringNotContainsString('"zones"', $encoded);
    }

    public function testBuildsCardRemovePatchForEvaporatedToken(): void
    {
        [$game, $actor] = $this->gameWithMovementCards();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['battlefield'][] = [
            'instanceId' => 'token-1',
            'name' => 'Bear Token',
            'zone' => 'battlefield',
            'power' => 2,
            'toughness' => 2,
            'defaultPower' => 2,
            'defaultToughness' => 2,
            'tapped' => false,
            'isToken' => true,
        ];
        $game->replaceSnapshot($snapshot);

        $message = $this->applyAndBuildProjected($game, $actor, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'token-1',
        ], 'action-token-remove', $actor);

        self::assertSame('card.remove', $message['operations'][0]['op']);
        self::assertSame($actor->id(), $message['operations'][0]['playerId']);
        self::assertSame('battlefield', $message['operations'][0]['zone']);
        self::assertSame('token-1', $message['operations'][0]['instanceId']);
    }

    public function testBuildsCardRemovePatchesForTokensAndTokenCopiesMovedToHandOrZonePiles(): void
    {
        foreach (['card.moved', 'cards.moved', 'zone.move_all'] as $commandType) {
            foreach (['hand', 'library', 'graveyard', 'exile', 'command'] as $toZone) {
                foreach ([false, true] as $isTokenCopy) {
                    [$game, $actor] = $this->gameWithMovementCards();
                    $snapshot = $game->snapshot();
                    $snapshot['players'][$actor->id()]['zones']['battlefield'] = [[
                        ...$this->card('token-1', $actor->id(), ['x' => 0.2, 'y' => 0.2, 'unit' => 'ratio']),
                        'name' => 'Bear Token',
                        'zone' => 'battlefield',
                        'isToken' => true,
                        'isTokenCopy' => $isTokenCopy,
                    ]];
                    $snapshot['players'][$actor->id()]['zoneCounts']['battlefield'] = 1;
                    $game->replaceSnapshot($snapshot);

                    $payload = match ($commandType) {
                        'cards.moved' => [
                            'playerId' => $actor->id(),
                            'fromZone' => 'battlefield',
                            'toZone' => $toZone,
                            'instanceIds' => ['token-1'],
                        ],
                        'zone.move_all' => [
                            'playerId' => $actor->id(),
                            'fromZone' => 'battlefield',
                            'toZone' => $toZone,
                        ],
                        default => [
                            'playerId' => $actor->id(),
                            'fromZone' => 'battlefield',
                            'toZone' => $toZone,
                            'instanceId' => 'token-1',
                        ],
                    };

                    $message = $this->applyAndBuildProjected(
                        $game,
                        $actor,
                        $commandType,
                        $payload,
                        sprintf('action-token-remove-%s-%s-%s', $commandType, $toZone, $isTokenCopy ? 'copy' : 'token'),
                        $actor,
                    );

                    self::assertSame('card.remove', $message['operations'][0]['op']);
                    self::assertSame($actor->id(), $message['operations'][0]['playerId']);
                    self::assertSame('battlefield', $message['operations'][0]['zone']);
                    self::assertSame('token-1', $message['operations'][0]['instanceId']);
                }
            }
        }
    }

    public function testBuildsCardRemoveForEvaporatedTokensMovedToHiddenZonesForOpponent(): void
    {
        foreach (['card.moved', 'cards.moved', 'zone.move_all'] as $commandType) {
            foreach (['hand', 'library'] as $toZone) {
                foreach ([false, true] as $isTokenCopy) {
                    [$game, $actor, $opponent] = $this->gameWithMovementCards();
                    $snapshot = $game->snapshot();
                    $snapshot['players'][$actor->id()]['zones']['hand'] = [];
                    $snapshot['players'][$actor->id()]['zones']['library'] = [];
                    $snapshot['players'][$actor->id()]['zones']['battlefield'] = [[
                        ...$this->card('token-1', $actor->id(), ['x' => 0.2, 'y' => 0.2, 'unit' => 'ratio']),
                        'name' => 'Bear Token',
                        'zone' => 'battlefield',
                        'isToken' => true,
                        'isTokenCopy' => $isTokenCopy,
                    ]];
                    $snapshot['players'][$actor->id()]['zoneCounts']['hand'] = 0;
                    $snapshot['players'][$actor->id()]['zoneCounts']['library'] = 0;
                    $snapshot['players'][$actor->id()]['zoneCounts']['battlefield'] = 1;
                    $game->replaceSnapshot($snapshot);

                    $payload = match ($commandType) {
                        'cards.moved' => [
                            'playerId' => $actor->id(),
                            'fromZone' => 'battlefield',
                            'toZone' => $toZone,
                            'instanceIds' => ['token-1'],
                        ],
                        'zone.move_all' => [
                            'playerId' => $actor->id(),
                            'fromZone' => 'battlefield',
                            'toZone' => $toZone,
                        ],
                        default => [
                            'playerId' => $actor->id(),
                            'fromZone' => 'battlefield',
                            'toZone' => $toZone,
                            'instanceId' => 'token-1',
                        ],
                    };

                    $message = $this->applyAndBuildProjected(
                        $game,
                        $actor,
                        $commandType,
                        $payload,
                        sprintf('action-token-hidden-remove-%s-%s-%s', $commandType, $toZone, $isTokenCopy ? 'copy' : 'token'),
                        $opponent,
                    );

                    self::assertSame('card.remove', $message['operations'][0]['op']);
                    self::assertSame($actor->id(), $message['operations'][0]['playerId']);
                    self::assertSame('battlefield', $message['operations'][0]['zone']);
                    self::assertSame('token-1', $message['operations'][0]['instanceId']);
                    self::assertNotContains('card.move', array_column($message['operations'], 'op'));
                }
            }
        }
    }

    public function testBuildsPrivateMovePatchWithCountsAndPlaceholderForOpponent(): void
    {
        [$game, $actor, $opponent] = $this->gameWithMovementCards();

        $message = $this->applyAndBuildProjected($game, $actor, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'hand',
            'instanceId' => 'battlefield-1',
        ], 'action-private-move', $opponent);
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertSame('card.remove', $message['operations'][0]['op']);
        self::assertSame('battlefield-1', $message['operations'][0]['instanceId']);
        self::assertSame($actor->id(), $message['operations'][0]['playerId']);
        self::assertSame('battlefield', $message['operations'][0]['zone']);
        self::assertContains([                                                                                           
            'op' => 'zone.counts.set',
            'playerId' => $actor->id(),
            'counts' => ['hand' => 2, 'battlefield' => 0],
        ], $message['operations']);
        self::assertStringNotContainsString('oracleText', $encoded);
    }

    public function testLibraryDrawSendsCardToOwnerAndOnlyCountsToOpponent(): void
    {
        [$game, $actor, $opponent] = $this->gameWithLibraryCards();

        $ownerMessage = $this->applyAndBuildProjected($game, $actor, 'library.draw', [
            'playerId' => $actor->id(),
            'count' => 1,
        ], 'action-draw', $actor);

        self::assertSame('game_patch', $ownerMessage['kind']);
        self::assertSame('card.move', $ownerMessage['operations'][0]['op']);
        self::assertSame('library-1', $ownerMessage['operations'][0]['instanceId']);
        self::assertSame('Private Library One', $ownerMessage['operations'][0]['card']['name']);
        self::assertContains([
            'op' => 'zone.counts.set',
            'playerId' => $actor->id(),
            'counts' => ['library' => 1, 'hand' => 1],
        ], $ownerMessage['operations']);

        [$game, $actor, $opponent] = $this->gameWithLibraryCards();
        $opponentMessage = $this->applyAndBuildProjected($game, $actor, 'library.draw', [
            'playerId' => $actor->id(),
            'count' => 1,
        ], 'action-draw', $opponent);
        $encoded = json_encode($opponentMessage, JSON_THROW_ON_ERROR);

        self::assertSame('game_patch', $opponentMessage['kind']);
        self::assertContains([
            'op' => 'zone.counts.set',
            'playerId' => $actor->id(),
            'counts' => ['library' => 1, 'hand' => 1],
        ], $opponentMessage['operations']);
        self::assertStringNotContainsString('Private Library One', $encoded);
        self::assertStringNotContainsString('oracleText', $encoded);
    }

    public function testLibraryRevealTopUsesProjectedVisibleZoneWithoutFullSnapshot(): void
    {
        [$game, $actor, $opponent] = $this->gameWithLibraryCards();

        $message = $this->applyAndBuildProjected($game, $actor, 'library.reveal_top', [
            'playerId' => $actor->id(),
            'count' => 1,
            'to' => 'all',
        ], 'action-reveal-top', $opponent);
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertSame('zone.visible.set', $message['operations'][0]['op']);
        self::assertSame('library', $message['operations'][0]['zone']);
        self::assertCount(1, $message['operations'][0]['cards']);
        self::assertSame('Private Library One', $message['operations'][0]['cards'][0]['name']);
        self::assertStringNotContainsString('"snapshot"', $encoded);
        self::assertStringNotContainsString('"players"', $encoded);
        self::assertStringNotContainsString('"zones"', $encoded);
    }

    public function testLibraryShuffleDoesNotLeakLibraryOrder(): void
    {
        [$game, $actor] = $this->gameWithLibraryCards();

        $message = $this->applyAndBuildProjected($game, $actor, 'library.shuffle', [
            'playerId' => $actor->id(),
        ], 'action-shuffle', $actor);
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertContains([
            'op' => 'zone.visible.set',
            'playerId' => $actor->id(),
            'zone' => 'library',
            'cards' => [],
        ], $message['operations']);
        self::assertStringNotContainsString('Private Library One', $encoded);
        self::assertStringNotContainsString('Private Library Two', $encoded);
    }

    public function testLibraryViewOnlyEmitsVisibleZoneToAuthorizedViewerWithCap(): void
    {
        [$game, $actor, $opponent] = $this->gameWithLibraryCards();

        $ownerMessage = $this->applyAndBuildProjected($game, $actor, 'library.view', [
            'playerId' => $actor->id(),
            'count' => 2,
        ], 'action-view', $actor);
        self::assertSame('zone.visible.set', $ownerMessage['operations'][0]['op']);
        self::assertCount(2, $ownerMessage['operations'][0]['cards']);

        [$game, $actor, $opponent] = $this->gameWithLibraryCards();
        $opponentMessage = $this->applyAndBuildProjected($game, $actor, 'library.view', [
            'playerId' => $actor->id(),
            'count' => 2,
        ], 'action-view', $opponent);
        $encoded = json_encode($opponentMessage, JSON_THROW_ON_ERROR);

        self::assertSame([['op' => 'eventLog.append', 'entries' => $opponentMessage['operations'][0]['entries']]], $opponentMessage['operations']);
        self::assertStringNotContainsString('Private Library One', $encoded);
    }

    public function testLibraryViewRequiresResyncWhenFullViewWouldExceedCap(): void
    {
        [$game, $actor] = $this->gameWithLibraryCards(41);

        $message = $this->applyAndBuildProjected($game, $actor, 'library.view', [
            'playerId' => $actor->id(),
        ], 'action-large-view', $actor);

        self::assertSame('resync_required', $message['kind']);
        self::assertSame('projection_unavailable', $message['reason']);
    }

    public function testLibraryReorderDoesNotLeakOrderToOpponent(): void
    {
        [$game, $actor, $opponent] = $this->gameWithLibraryCards();

        $ownerMessage = $this->applyAndBuildProjected($game, $actor, 'library.reorder_top', [
            'playerId' => $actor->id(),
            'instanceIds' => ['library-2', 'library-1'],
        ], 'action-reorder', $actor);
        self::assertSame('card.move', $ownerMessage['operations'][0]['op']);
        self::assertSame('library-2', $ownerMessage['operations'][0]['instanceId']);

        [$game, $actor, $opponent] = $this->gameWithLibraryCards();
        $opponentMessage = $this->applyAndBuildProjected($game, $actor, 'library.reorder_top', [
            'playerId' => $actor->id(),
            'instanceIds' => ['library-2', 'library-1'],
        ], 'action-reorder', $opponent);
        $encoded = json_encode($opponentMessage, JSON_THROW_ON_ERROR);

        self::assertStringNotContainsString('library-2","library-1', $encoded);
        self::assertStringNotContainsString('Private Library One', $encoded);
    }

    public function testZoneChangedPrivateHandDoesNotRequireResyncOrLeakIdsToOpponent(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateHandCards();
        $handlerPayload = [
            'playerId' => $actor->id(),
            'zone' => 'hand',
            'cards' => array_reverse($game->snapshot()['players'][$actor->id()]['zones']['hand']),
        ];
        $eventPayload = [
            'playerId' => $actor->id(),
            'zone' => 'hand',
            'instanceIds' => ['hand-2', 'hand-1'],
        ];

        $ownerMessage = $this->applyAndBuildProjectedWithEventPayload($game, $actor, 'zone.changed', $handlerPayload, $eventPayload, 'action-hand-reorder', $actor);
        self::assertSame('game_patch', $ownerMessage['kind']);
        self::assertSame('card.move', $ownerMessage['operations'][0]['op']);
        self::assertSame('hand-2', $ownerMessage['operations'][0]['instanceId']);

        [$game, $actor, $opponent] = $this->gameWithPrivateHandCards();
        $handlerPayload = [
            'playerId' => $actor->id(),
            'zone' => 'hand',
            'cards' => array_reverse($game->snapshot()['players'][$actor->id()]['zones']['hand']),
        ];
        $opponentMessage = $this->applyAndBuildProjectedWithEventPayload($game, $actor, 'zone.changed', $handlerPayload, $eventPayload, 'action-hand-reorder', $opponent);
        $encoded = json_encode($opponentMessage, JSON_THROW_ON_ERROR);

        self::assertSame('game_patch', $opponentMessage['kind']);
        self::assertNotContains('card.move', array_column($opponentMessage['operations'], 'op'));
        self::assertSame('eventLog.append', $opponentMessage['operations'][0]['op']);
        self::assertStringNotContainsString('hand-1', $encoded);
        self::assertStringNotContainsString('hand-2', $encoded);
        self::assertStringNotContainsString('Private Hand One', $encoded);
        self::assertStringNotContainsString('Private hand oracle', $encoded);
        self::assertStringNotContainsString('imageUris', $encoded);
        self::assertStringNotContainsString('"snapshot"', $encoded);
        self::assertStringNotContainsString('"players"', $encoded);
        self::assertStringNotContainsString('"zones"', $encoded);
    }

    public function testZoneChangedPrivateLibraryDoesNotRequireResyncOrLeakOrderToOpponent(): void
    {
        [$game, $actor, $opponent] = $this->gameWithLibraryCards();
        $handlerPayload = [
            'playerId' => $actor->id(),
            'zone' => 'library',
            'cards' => array_reverse($game->snapshot()['players'][$actor->id()]['zones']['library']),
        ];
        $eventPayload = [
            'playerId' => $actor->id(),
            'zone' => 'library',
            'instanceIds' => ['library-2', 'library-1'],
        ];

        $ownerMessage = $this->applyAndBuildProjectedWithEventPayload($game, $actor, 'zone.changed', $handlerPayload, $eventPayload, 'action-library-zone-reorder', $actor);
        self::assertSame('game_patch', $ownerMessage['kind']);
        self::assertSame('card.move', $ownerMessage['operations'][0]['op']);
        self::assertSame('library-2', $ownerMessage['operations'][0]['instanceId']);

        [$game, $actor, $opponent] = $this->gameWithLibraryCards();
        $handlerPayload = [
            'playerId' => $actor->id(),
            'zone' => 'library',
            'cards' => array_reverse($game->snapshot()['players'][$actor->id()]['zones']['library']),
        ];
        $opponentMessage = $this->applyAndBuildProjectedWithEventPayload($game, $actor, 'zone.changed', $handlerPayload, $eventPayload, 'action-library-zone-reorder', $opponent);
        $encoded = json_encode($opponentMessage, JSON_THROW_ON_ERROR);

        self::assertSame('game_patch', $opponentMessage['kind']);
        self::assertNotContains('card.move', array_column($opponentMessage['operations'], 'op'));
        self::assertStringNotContainsString('library-2","library-1', $encoded);
        self::assertStringNotContainsString('Private Library One', $encoded);
        self::assertStringNotContainsString('oracleText', $encoded);
        self::assertStringNotContainsString('"snapshot"', $encoded);
        self::assertStringNotContainsString('"players"', $encoded);
        self::assertStringNotContainsString('"zones"', $encoded);
    }

    public function testZoneChangedBattlefieldStillUsesCardMovesForVisibleReorder(): void
    {
        [$game, $actor, $opponent] = $this->gameWithBattlefieldCards();
        $handlerPayload = [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'cards' => array_reverse($game->snapshot()['players'][$actor->id()]['zones']['battlefield']),
        ];
        $eventPayload = [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceIds' => ['battlefield-2', 'battlefield-1'],
        ];

        $message = $this->applyAndBuildProjectedWithEventPayload($game, $actor, 'zone.changed', $handlerPayload, $eventPayload, 'action-battlefield-reorder', $opponent);

        self::assertSame('game_patch', $message['kind']);
        self::assertSame('card.move', $message['operations'][0]['op']);
        self::assertSame('battlefield-2', $message['operations'][0]['instanceId']);
    }

    public function testZoneRandomCardSelectedSanitizesPrivateHiddenCardLogsForOpponent(): void
    {
        [$game, $actor, $opponent] = $this->gameWithLibraryCards();

        $message = $this->applyAndBuildProjected(
            $game,
            $actor,
            'zone.random_card.selected',
            [
                'playerId' => $actor->id(),
                'zone' => 'library',
            ],
            'action-random',
            $opponent,
            new GameCommandHandler(null, new class() extends GameRandomizer {
                public function pickOne(array $items): mixed
                {
                    return $items[0];
                }
            }),
        );
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertSame('eventLog.append', $message['operations'][0]['op']);
        self::assertArrayNotHasKey('cardInstanceId', $message['operations'][0]['entries'][0]);
        self::assertStringNotContainsString('Private Library One', $encoded);
        self::assertStringNotContainsString('library-1', $encoded);
    }

    public function testFaceDownPatchDoesNotLeakCardToOpponent(): void
    {
        [$game, $actor, $opponent] = $this->gameWithAdvancedBattlefieldCards();

        $message = $this->applyAndBuildProjected($game, $actor, 'card.face_down.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'advanced-1',
            'faceDown' => true,
        ], 'action-face-down', $opponent);
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertSame('card.projection.set', $message['operations'][0]['op']);
        self::assertSame('Face-down card', $message['operations'][0]['card']['name']);
        self::assertTrue($message['operations'][0]['card']['hidden']);
        self::assertStringNotContainsString('Secret Dragon', $encoded);
        self::assertStringNotContainsString('Private oracle', $encoded);
    }

    public function testRevealPatchUsesViewerProjectionForHiddenZones(): void
    {
        [$game, $actor, $opponent] = $this->gameWithPrivateHandCard();

        $message = $this->applyAndBuildProjected($game, $actor, 'card.revealed', [
            'playerId' => $actor->id(),
            'zone' => 'hand',
            'instanceId' => 'private-hand-1',
            'to' => $opponent->id(),
        ], 'action-reveal-card', $opponent);

        self::assertSame('zone.visible.set', $message['operations'][0]['op']);
        self::assertSame('hand', $message['operations'][0]['zone']);
        self::assertStringContainsString('Private Hand Reveal', json_encode($message['operations'][0]['cards'], JSON_THROW_ON_ERROR));
    }

    public function testCounterAndStatsPatchesUpdateOnlyTheTargetCard(): void
    {
        [$game, $actor] = $this->gameWithAdvancedBattlefieldCards();

        $counter = $this->applyAndBuildProjected($game, $actor, 'card.counter.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'advanced-1',
            'key' => 'charge',
            'value' => 2,
        ], 'action-card-counter', $actor);
        self::assertSame('card.counters.set', $counter['operations'][0]['op']);
        self::assertSame(['charge' => 2], $counter['operations'][0]['counters']);

        $stats = $this->applyAndBuildProjected($game, $actor, 'card.power_toughness.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'advanced-1',
            'power' => 6,
            'toughness' => 7,
        ], 'action-card-stats', $actor);
        self::assertSame('card.stats.set', $stats['operations'][0]['op']);
        self::assertSame(6, $stats['operations'][0]['power']);
        self::assertSame(7, $stats['operations'][0]['toughness']);
    }

    public function testControllerChangeMovesCardWithoutChangingOwner(): void
    {
        [$game, $actor, $opponent] = $this->gameWithAdvancedBattlefieldCards();

        $message = $this->applyAndBuildProjected($game, $actor, 'card.controller.changed', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'advanced-1',
            'targetPlayerId' => $opponent->id(),
        ], 'action-controller', $actor);

        self::assertSame('card.move', $message['operations'][0]['op']);
        self::assertSame($actor->id(), $message['operations'][0]['card']['ownerId']);
        self::assertSame($opponent->id(), $message['operations'][0]['card']['controllerId']);
        self::assertSame(['playerId' => $opponent->id(), 'zone' => 'battlefield', 'index' => 0], $message['operations'][0]['to']);
    }

    public function testBattlefieldUntapAllUsesSmallBatchStatePatch(): void
    {
        [$game, $actor] = $this->gameWithAdvancedBattlefieldCards(tapped: true);

        $message = $this->applyAndBuildProjected($game, $actor, 'battlefield.untap_all', [
            'playerId' => $actor->id(),
        ], 'action-untap-all', $actor);

        self::assertSame('cards.state.set', $message['operations'][0]['op']);
        self::assertSame('battlefield', $message['operations'][0]['zone']);
        self::assertSame([
            ['instanceId' => 'advanced-1', 'tapped' => false, 'rotation' => 90],
            ['instanceId' => 'advanced-2', 'tapped' => false, 'rotation' => 90],
        ], $message['operations'][0]['cards']);
    }

    public function testBattlefieldUntapAllReturnsEveryTappedCardForPlayerInSinglePatch(): void
    {
        foreach ([1, 10] as $tappedCount) {
            [$game, $actor, $opponent] = $this->game();
            $snapshot = $game->snapshot();
            $battlefield = [];
            for ($index = 1; $index <= $tappedCount; ++$index) {
                $battlefield[] = [
                    ...$this->card('tapped-'.$index, $actor->id(), ['x' => $index / 20, 'y' => $index / 20, 'unit' => 'ratio']),
                    'tapped' => true,
                    'rotation' => 90,
                    'zone' => 'battlefield',
                ];
            }
            $battlefield[] = [
                ...$this->card('already-untapped', $actor->id(), ['x' => 0.8, 'y' => 0.8, 'unit' => 'ratio']),
                'tapped' => false,
                'rotation' => 0,
                'zone' => 'battlefield',
            ];
            $snapshot['players'][$actor->id()]['zones']['battlefield'] = $battlefield;
            $snapshot['players'][$actor->id()]['zoneCounts']['battlefield'] = count($battlefield);
            $snapshot['players'][$opponent->id()]['zones']['battlefield'] = [[
                ...$this->card('opponent-tapped', $opponent->id(), ['x' => 0.1, 'y' => 0.1, 'unit' => 'ratio']),
                'tapped' => true,
                'rotation' => 90,
                'zone' => 'battlefield',
            ]];
            $snapshot['players'][$opponent->id()]['zoneCounts']['battlefield'] = 1;
            $game->replaceSnapshot($snapshot);

            $message = $this->applyAndBuildProjected($game, $actor, 'battlefield.untap_all', [
                'playerId' => $actor->id(),
            ], 'action-untap-all-'.$tappedCount, $actor);

            self::assertSame('game_patch', $message['kind']);
            self::assertSame('cards.state.set', $message['operations'][0]['op']);
            self::assertSame($actor->id(), $message['operations'][0]['playerId']);
            self::assertSame('battlefield', $message['operations'][0]['zone']);
            self::assertCount($tappedCount, $message['operations'][0]['cards']);
            self::assertSame(
                array_map(
                    static fn (int $index): array => ['instanceId' => 'tapped-'.$index, 'tapped' => false, 'rotation' => 90],
                    range(1, $tappedCount),
                ),
                $message['operations'][0]['cards'],
            );
            self::assertSame('eventLog.append', $message['operations'][1]['op']);
        }
    }

    public function testTokenCreatedAndTokenCopyCreatedInsertOnlyNewCard(): void
    {
        [$game, $actor] = $this->gameWithAdvancedBattlefieldCards();

        $token = $this->applyAndBuildProjected($game, $actor, 'card.token.created', [
            'playerId' => $actor->id(),
            'card' => ['name' => 'Beast Token', 'power' => 3, 'toughness' => 3],
        ], 'action-token', $actor);
        $encodedToken = json_encode($token, JSON_THROW_ON_ERROR);
        self::assertSame('card.create', $token['operations'][0]['op']);
        self::assertSame('Beast Token', $token['operations'][0]['card']['name']);
        self::assertTrue($token['operations'][0]['card']['isToken']);
        self::assertStringNotContainsString('"snapshot"', $encodedToken);
        self::assertStringNotContainsString('"zones"', $encodedToken);

        [$game, $actor] = $this->gameWithAdvancedBattlefieldCards();
        $copy = $this->applyAndBuildProjected($game, $actor, 'card.token_copy.created', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'advanced-1',
            'targetPlayerId' => $actor->id(),
        ], 'action-token-copy', $actor);

        self::assertSame('card.create', $copy['operations'][0]['op']);
        self::assertTrue($copy['operations'][0]['card']['isTokenCopy']);
        self::assertNotSame('advanced-1', $copy['operations'][0]['card']['instanceId']);
    }

    public function testTokenCreatedQuantityBuildsOnePatchWithMultipleCreateOperations(): void
    {
        [$game, $actor] = $this->gameWithAdvancedBattlefieldCards();

        $message = $this->applyAndBuildProjected($game, $actor, 'card.token.created', [
            'playerId' => $actor->id(),
            'quantity' => 3,
            'card' => ['name' => 'Beast Token', 'power' => 3, 'toughness' => 3],
        ], 'action-token-quantity', $actor);

        self::assertSame(['card.create', 'card.create', 'card.create'], array_column(array_slice($message['operations'], 0, 3), 'op'));
        self::assertSame(['Beast Token', 'Beast Token', 'Beast Token'], array_column(array_column(array_slice($message['operations'], 0, 3), 'card'), 'name'));
        self::assertCount(3, array_unique(array_map(
            static fn (array $operation): string => (string) $operation['card']['instanceId'],
            array_slice($message['operations'], 0, 3),
        )));
        self::assertSame('eventLog.append', $message['operations'][count($message['operations']) - 1]['op']);
    }

    public function testBuildsStackAddAndRemovePatchesWithoutFullSnapshot(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();

        $add = $this->applyAndBuild($game, $actor, 'stack.card_added', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
        ], 'action-stack-add');
        $encoded = json_encode($add, JSON_THROW_ON_ERROR);

        self::assertSame('stack.item.add', $add['operations'][0]['op']);
        self::assertSame('card', $add['operations'][0]['item']['kind']);
        self::assertSame('battlefield-1', $add['operations'][0]['item']['card']['instanceId']);
        self::assertSame('eventLog.append', $add['operations'][1]['op']);
        self::assertStringNotContainsString('"snapshot"', $encoded);
        self::assertStringNotContainsString('"players"', $encoded);
        self::assertStringNotContainsString('"zones"', $encoded);

        $remove = $this->applyAndBuild($game, $actor, 'stack.item_removed', [
            'id' => $add['operations'][0]['item']['id'],
        ], 'action-stack-remove');

        self::assertSame('stack.item.remove', $remove['operations'][0]['op']);
        self::assertSame($add['operations'][0]['item']['id'], $remove['operations'][0]['id']);
    }

    public function testBuildsArrowAndAttachmentRelationPatchesPreservingOwner(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();

        $arrow = $this->applyAndBuild($game, $actor, 'arrow.created', [
            'fromInstanceId' => 'battlefield-1',
            'toInstanceId' => 'battlefield-2',
            'color' => 'blue',
        ], 'action-arrow-add');

        self::assertSame('arrow.add', $arrow['operations'][0]['op']);
        self::assertSame($actor->id(), $arrow['operations'][0]['arrow']['ownerId']);
        self::assertSame('blue', $arrow['operations'][0]['arrow']['color']);

        $arrowRemove = $this->applyAndBuild($game, $actor, 'arrow.removed', [
            'id' => $arrow['operations'][0]['arrow']['id'],
        ], 'action-arrow-remove');

        self::assertSame('arrow.remove', $arrowRemove['operations'][0]['op']);
        self::assertSame($arrow['operations'][0]['arrow']['id'], $arrowRemove['operations'][0]['id']);

        $attachment = $this->applyAndBuild($game, $actor, 'attachment.created', [
            'equipmentInstanceId' => 'battlefield-1',
            'attachedToInstanceId' => 'battlefield-2',
        ], 'action-attachment-add');

        self::assertSame('attachment.add', $attachment['operations'][0]['op']);
        self::assertSame($actor->id(), $attachment['operations'][0]['attachment']['ownerId']);
        self::assertSame('battlefield-1', $attachment['operations'][0]['attachment']['equipmentInstanceId']);

        $attachmentRemove = $this->applyAndBuild($game, $actor, 'attachment.removed', [
            'id' => $attachment['operations'][0]['attachment']['id'],
        ], 'action-attachment-remove');

        self::assertSame('attachment.remove', $attachmentRemove['operations'][0]['op']);
        self::assertSame($attachment['operations'][0]['attachment']['id'], $attachmentRemove['operations'][0]['id']);
    }

    public function testMovementPatchIncludesPrunedRelationRemovals(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();
        $snapshot = $game->snapshot();
        $snapshot['arrows'] = [[
            'id' => 'arrow-1',
            'ownerId' => $actor->id(),
            'fromInstanceId' => 'battlefield-1',
            'toInstanceId' => 'battlefield-2',
            'color' => 'yellow',
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]];
        $snapshot['attachments'] = [[
            'id' => 'attachment-1',
            'ownerId' => $actor->id(),
            'equipmentInstanceId' => 'battlefield-1',
            'attachedToInstanceId' => 'battlefield-2',
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]];
        $game->replaceSnapshot($snapshot);

        $message = $this->applyAndBuildProjected($game, $actor, 'card.moved', [
            'playerId' => $actor->id(),
            'fromZone' => 'battlefield',
            'toZone' => 'graveyard',
            'instanceId' => 'battlefield-1',
        ], 'action-prune', $actor);

        self::assertContains(['op' => 'arrow.remove', 'id' => 'arrow-1'], $message['operations']);
        self::assertContains(['op' => 'attachment.remove', 'id' => 'attachment-1'], $message['operations']);
    }

    public function testBuildsConcedeAndClosePatchesWithoutGameStatusSnapshotField(): void
    {
        [$game, $actor] = $this->gameWithBattlefieldCards();

        $concede = $this->applyAndBuild($game, $actor, 'game.concede', [], 'action-concede');

        self::assertSame('player.status.set', $concede['operations'][0]['op']);
        self::assertSame($actor->id(), $concede['operations'][0]['playerId']);
        self::assertSame('conceded', $concede['operations'][0]['status']);
        self::assertArrayHasKey('concededAt', $concede['operations'][0]);
        self::assertSame('eventLog.append', $concede['operations'][1]['op']);

        [$closeGame, $closeActor] = $this->gameWithBattlefieldCards();
        $close = $this->applyAndBuild($closeGame, $closeActor, 'game.close', [], 'action-close');
        $encodedClose = json_encode($close, JSON_THROW_ON_ERROR);

        self::assertSame('game_patch', $close['kind']);
        self::assertSame('eventLog.append', $close['operations'][0]['op']);
        self::assertSame('game.close', $close['operations'][0]['entries'][0]['type']);
        self::assertStringNotContainsString('"snapshot"', $encodedClose);
        self::assertStringNotContainsString('"status":"finished"', $encodedClose);
    }

    public function testConcedeDoesNotEmitTurnSetWhenTurnDoesNotChange(): void
    {
        [$game, $actor, $opponent] = $this->gameWithBattlefieldCards();
        $snapshot = $game->snapshot();
        $snapshot['turn']['activePlayerId'] = $opponent->id();
        $game->replaceSnapshot($snapshot);

        $concede = $this->applyAndBuild($game, $actor, 'game.concede', [], 'action-concede-no-turn');

        self::assertNotContains('turn.set', array_column($concede['operations'], 'op'));
        self::assertContains('player.status.set', array_column($concede['operations'], 'op'));
        self::assertContains('eventLog.append', array_column($concede['operations'], 'op'));
    }

    public function testConcedeEmitsTurnSetWhenTurnChangesInSnapshot(): void
    {
        [$game, $actor, $opponent] = $this->gameWithBattlefieldCards();
        $previous = $game->snapshot();
        $next = $previous;
        $next['version'] = $previous['version'] + 1;
        $next['players'][$actor->id()]['status'] = 'conceded';
        $next['players'][$actor->id()]['concededAt'] = '2026-01-01T00:00:01+00:00';
        $next['turn'] = ['activePlayerId' => $opponent->id(), 'phase' => 'untap', 'number' => 2];
        $next['eventLog'][] = [
            'id' => 'log-concede-turn-shift',
            'type' => 'game.concede',
            'message' => 'Actor conceded.',
            'actorId' => $actor->id(),
            'displayName' => $actor->displayName(),
            'createdAt' => '2026-01-01T00:00:01+00:00',
        ];
        $event = new GameEvent($game, 'game.concede', [], $actor, 'action-concede-turn-shift');

        $message = (new GameWebsocketPatchBuilder(new GameWebsocketMessageFactory()))
            ->build($game->id(), $previous, $next, $event);

        self::assertContains('player.status.set', array_column($message['operations'], 'op'));
        self::assertContains('turn.set', array_column($message['operations'], 'op'));
        self::assertContains('eventLog.append', array_column($message['operations'], 'op'));
    }

    public function testBuildsEventLogAppendAcrossSlidingWindowRollover(): void
    {
        [$game, $actor] = $this->game();
        $previous = $game->snapshot();
        $previous['eventLog'] = [];
        for ($index = 1; $index <= 250; ++$index) {
            $previous['eventLog'][] = [
                'id' => sprintf('log-%03d', $index),
                'type' => 'life.changed',
                'message' => sprintf('Life changed %d', $index),
                'actorId' => $actor->id(),
                'displayName' => $actor->displayName(),
                'createdAt' => sprintf('2026-01-01T00:00:%02d+00:00', $index % 60),
            ];
        }

        $next = $previous;
        $next['version'] = 2;
        $next['eventLog'] = [
            ...array_slice($previous['eventLog'], 2),
            [
                'id' => 'log-251',
                'type' => 'life.changed',
                'message' => 'Life changed 251',
                'actorId' => $actor->id(),
                'displayName' => $actor->displayName(),
                'createdAt' => '2026-01-01T00:04:11+00:00',
            ],
            [
                'id' => 'log-252',
                'type' => 'life.changed',
                'message' => 'Life changed 252',
                'actorId' => $actor->id(),
                'displayName' => $actor->displayName(),
                'createdAt' => '2026-01-01T00:04:12+00:00',
            ],
        ];

        $event = new GameEvent($game, 'dice.rolled', ['kind' => 'd6', 'finalResult' => '4'], $actor, 'action-rollover');
        $message = (new GameWebsocketPatchBuilder(new GameWebsocketMessageFactory()))->build($game->id(), $previous, $next, $event);

        self::assertSame('game_patch', $message['kind']);
        self::assertSame('eventLog.append', $message['operations'][0]['op']);
        self::assertSame(['log-251', 'log-252'], array_map(
            static fn (array $entry): string => (string) $entry['id'],
            $message['operations'][0]['entries'],
        ));
    }

    public function testBuildsDisconnectVotePatchWithEventLogAppend(): void
    {
        [$game, $actor, $opponent] = $this->game();
        $previous = $game->snapshot();
        $next = $previous;
        $next['version'] = 2;
        $next['disconnectVote'] = [
            'targetPlayerId' => $opponent->id(),
            'status' => 'open',
            'openedAt' => '2026-01-01T00:00:00+00:00',
            'deadlineAt' => '2026-01-01T00:01:00+00:00',
            'cooldownUntil' => null,
            'votes' => [],
        ];
        $next['eventLog'][] = [
            'id' => 'log-disconnect',
            'type' => 'disconnect.vote.updated',
            'message' => 'Votacion abierta.',
            'actorId' => null,
            'displayName' => 'System',
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ];

        $event = new GameEvent($game, 'disconnect.vote.updated', ['reason' => 'opened'], null, 'action-disconnect');
        $message = (new GameWebsocketPatchBuilder(new GameWebsocketMessageFactory()))->build($game->id(), $previous, $next, $event);

        self::assertSame('disconnect.vote.set', $message['operations'][0]['op']);
        self::assertSame($opponent->id(), $message['operations'][0]['disconnectVote']['targetPlayerId']);
        self::assertSame('eventLog.append', $message['operations'][1]['op']);
    }

    public function testBuildsDisconnectVotePatchIncludingPlayerStatusWhenExpelled(): void
    {
        [$game, $actor, $opponent] = $this->game();
        $previous = $game->snapshot();
        $next = $previous;
        $next['version'] = 2;
        $next['players'][$opponent->id()]['status'] = 'conceded';
        $next['players'][$opponent->id()]['concededAt'] = '2026-01-01T00:00:10+00:00';
        $next['disconnectVote'] = [
            'targetPlayerId' => $opponent->id(),
            'status' => 'resolved_expel',
            'openedAt' => null,
            'deadlineAt' => null,
            'cooldownUntil' => null,
            'votes' => [
                $actor->id() => [
                    'playerId' => $actor->id(),
                    'displayName' => 'Actor',
                    'vote' => 'expel',
                    'votedAt' => '2026-01-01T00:00:10+00:00',
                ],
            ],
        ];
        $next['eventLog'][] = [
            'id' => 'log-disconnect-expel',
            'type' => 'disconnect.vote.updated',
            'message' => 'Votacion resuelta en expulsion.',
            'actorId' => $actor->id(),
            'displayName' => 'Actor',
            'createdAt' => '2026-01-01T00:00:10+00:00',
        ];

        $event = new GameEvent($game, 'disconnect.vote.updated', ['reason' => 'vote.resolved'], $actor, 'action-disconnect-expel');
        $message = (new GameWebsocketPatchBuilder(new GameWebsocketMessageFactory()))->build($game->id(), $previous, $next, $event);

        self::assertSame('disconnect.vote.set', $message['operations'][0]['op']);
        self::assertSame('player.status.set', $message['operations'][1]['op']);
        self::assertSame($opponent->id(), $message['operations'][1]['playerId']);
        self::assertSame('conceded', $message['operations'][1]['status']);
        self::assertSame('2026-01-01T00:00:10+00:00', $message['operations'][1]['concededAt']);
        self::assertSame('eventLog.append', $message['operations'][2]['op']);
    }

    public function testZoneMoveAllRequiresResyncWhenProjectionWouldBeTooLarge(): void
    {
        [$game, $actor] = $this->gameWithMovementCards();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['graveyard'] = [];
        for ($index = 0; $index < 41; ++$index) {
            $snapshot['players'][$actor->id()]['zones']['graveyard'][] = $this->card('graveyard-'.$index, $actor->id(), ['x' => 0, 'y' => 0]);
        }
        $game->replaceSnapshot($snapshot);

        $message = $this->applyAndBuildProjected($game, $actor, 'zone.move_all', [
            'playerId' => $actor->id(),
            'fromZone' => 'graveyard',
            'toZone' => 'exile',
        ], 'action-move-all-large', $actor);

        self::assertSame('resync_required', $message['kind']);
        self::assertSame('projection_unavailable', $message['reason']);
    }

    public function testPrivateChatDoesNotForceResyncForUnrelatedViewer(): void
    {
        [$game, $actor, $opponent] = $this->game();
        $spectator = new User('spectator@example.test', 'Spectator');

        $privateChatForSpectator = $this->applyAndBuildProjected($game, $actor, 'chat.message', [
            'message' => 'secret',
            'targetPlayerId' => $opponent->id(),
        ], 'action-private-chat', $spectator);
        self::assertSame('game_patch', $privateChatForSpectator['kind']);
        self::assertSame([], $privateChatForSpectator['operations']);
    }

    public function testPrivateChatProjectedToTargetIncludesChatAppend(): void
    {
        [$game, $actor, $opponent] = $this->game();

        $privateChatForTarget = $this->applyAndBuildProjected($game, $actor, 'chat.message', [
            'message' => 'secret',
            'targetPlayerId' => $opponent->id(),
        ], 'action-private-chat-target', $opponent);
        self::assertSame('game_patch', $privateChatForTarget['kind']);
        self::assertSame('chat.append', $privateChatForTarget['operations'][0]['op'] ?? null);
        self::assertCount(1, $privateChatForTarget['operations'][0]['entries'] ?? []);
    }

    public function testCounterChangedSupportsGlobalScopeWithoutResync(): void
    {
        [$game, $actor] = $this->game();

        $globalCounter = $this->applyAndBuild($game, $actor, 'counter.changed', [
            'scope' => 'global',
            'key' => 'storm',
            'value' => 3,
        ], 'action-global-counter');
        self::assertSame('game_patch', $globalCounter['kind']);
        self::assertSame('game.counters.set', $globalCounter['operations'][0]['op'] ?? null);
        self::assertSame('global', $globalCounter['operations'][0]['scope'] ?? null);
        self::assertSame(3, $globalCounter['operations'][0]['counters']['storm'] ?? null);
        self::assertSame('eventLog.append', $globalCounter['operations'][1]['op'] ?? null);
        self::assertSame('counter.changed', $globalCounter['operations'][1]['entries'][0]['type'] ?? null);
    }

    public function testBuildsGranularHelperCreateUpdateAndRemovePatches(): void
    {
        [$game, $actor] = $this->game();
        $handler = new GameCommandHandler();

        $created = $this->applyAndBuild($game, $actor, 'helper.created', [
            'template' => 'the_ring',
            'ownerPlayerId' => $actor->id(),
            'state' => ['level' => 1, 'ringBearerInstanceId' => null],
        ], 'action-helper-create', $handler);
        self::assertSame('specialEntity.add', $created['operations'][0]['op'] ?? null);
        self::assertSame('the_ring', $created['operations'][0]['entity']['template'] ?? null);

        $entityId = $game->snapshot()['specialEntities'][0]['id'] ?? null;
        self::assertIsString($entityId);

        $updated = $this->applyAndBuild($game, $actor, 'helper.updated', [
            'entityId' => $entityId,
            'state' => ['level' => 2, 'ringBearerInstanceId' => null],
        ], 'action-helper-update', $handler);
        self::assertSame([
            'op' => 'specialEntity.update',
            'entityId' => $entityId,
            'state' => ['level' => 2, 'ringBearerInstanceId' => null],
        ], $updated['operations'][0]);

        $removed = $this->applyAndBuild($game, $actor, 'helper.removed', [
            'entityId' => $entityId,
        ], 'action-helper-remove', $handler);
        self::assertSame([
            'op' => 'specialEntity.remove',
            'entityId' => $entityId,
        ], $removed['operations'][0]);
    }

    public function testDoesNotEmitFullSnapshotPlayersOrZonesInGamePatchPayload(): void
    {
        [$game, $actor] = $this->game();
        $message = $this->applyAndBuild($game, $actor, 'life.changed', ['playerId' => $actor->id(), 'life' => 35], 'action-small');
        $encoded = json_encode($message, JSON_THROW_ON_ERROR);

        self::assertStringNotContainsString('"snapshot"', $encoded);
        self::assertStringNotContainsString('"players"', $encoded);
        self::assertStringNotContainsString('"zones"', $encoded);
    }

    public function testRejectsNonConsecutiveVersionWithResyncRequired(): void
    {
        [$game, $actor] = $this->game();
        $previous = $game->snapshot();
        $event = (new GameCommandHandler())->apply($game, 'life.changed', ['playerId' => $actor->id(), 'delta' => -1], $actor, 'action-gap');
        $next = $game->snapshot();
        $next['version'] = 5;

        $message = (new GameWebsocketPatchBuilder(new GameWebsocketMessageFactory()))->build($game->id(), $previous, $next, $event);

        self::assertSame('resync_required', $message['kind']);
        self::assertSame('projection_unavailable', $message['reason']);
        self::assertSame('action-gap', $message['clientActionId']);
    }

    public function testBuilderDoesNotDependOnMercurePublisher(): void
    {
        $constructor = (new \ReflectionClass(GameWebsocketPatchBuilder::class))->getConstructor();
        $types = array_map(
            static fn (\ReflectionParameter $parameter): string => (string) $parameter->getType(),
            $constructor?->getParameters() ?? [],
        );

        self::assertNotContains(\App\Infrastructure\Realtime\GameEventPublisher::class, $types);
    }

    /**
     * @return array{Game, User, User}
     */
    private function game(): array
    {
        $actor = new User('actor@example.test', 'Actor');
        $opponent = new User('opponent@example.test', 'Opponent');
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));
        $room->addPlayer(new RoomPlayer($room, $opponent));

        return [new Game($room, $this->snapshot($actor, $opponent)), $actor, $opponent];
    }

    /**
     * @return array{Game, User, User}
     */
    private function gameWithBattlefieldCards(): array
    {
        [$game, $actor, $opponent] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['battlefield'] = [
            [
                ...$this->card('battlefield-1', $actor->id(), ['x' => 0.2, 'y' => 0.2, 'unit' => 'ratio']),
                'name' => 'Battlefield One',
            ],
            [
                ...$this->card('battlefield-2', $actor->id(), ['x' => 0.4, 'y' => 0.4, 'unit' => 'ratio']),
                'name' => 'Battlefield Two',
            ],
        ];
        $snapshot['players'][$actor->id()]['zoneCounts']['battlefield'] = 2;
        $game->replaceSnapshot($snapshot);

        return [$game, $actor, $opponent];
    }

    /**
     * @return array{Game, User, User}
     */
    private function gameWithMovementCards(): array
    {
        [$game, $actor, $opponent] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['hand'] = [
            [
                ...$this->card('hand-1', $actor->id(), ['x' => 0, 'y' => 0]),
                'name' => 'Private Hand One',
                'zone' => 'hand',
            ],
        ];
        $snapshot['players'][$actor->id()]['zones']['battlefield'] = [
            [
                ...$this->card('battlefield-1', $actor->id(), ['x' => 0.2, 'y' => 0.2, 'unit' => 'ratio']),
                'name' => 'Battlefield One',
                'zone' => 'battlefield',
            ],
        ];
        $snapshot['players'][$actor->id()]['zoneCounts']['hand'] = 1;
        $snapshot['players'][$actor->id()]['zoneCounts']['battlefield'] = 1;
        $game->replaceSnapshot($snapshot);

        return [$game, $actor, $opponent];
    }

    /**
     * @return array{Game, User, User}
     */
    private function gameWithPrivateHandCards(): array
    {
        [$game, $actor, $opponent] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['hand'] = [
            [
                ...$this->card('hand-1', $actor->id(), ['x' => 0, 'y' => 0]),
                'name' => 'Private Hand One',
                'oracleText' => 'Private hand oracle one',
                'imageUris' => ['normal' => 'https://example.test/hand-1.jpg'],
                'zone' => 'hand',
            ],
            [
                ...$this->card('hand-2', $actor->id(), ['x' => 0, 'y' => 0]),
                'name' => 'Private Hand Two',
                'oracleText' => 'Private hand oracle two',
                'imageUris' => ['normal' => 'https://example.test/hand-2.jpg'],
                'zone' => 'hand',
            ],
        ];
        $snapshot['players'][$actor->id()]['zoneCounts']['hand'] = 2;
        $game->replaceSnapshot($snapshot);

        return [$game, $actor, $opponent];
    }

    /**
     * @return array{Game, User, User}
     */
    private function gameWithLibraryCards(int $count = 2): array
    {
        [$game, $actor, $opponent] = $this->game();
        $snapshot = $game->snapshot();
        $library = [];
        for ($index = 1; $index <= $count; ++$index) {
            $library[] = [
                ...$this->card('library-'.$index, $actor->id(), ['x' => 0, 'y' => 0]),
                'name' => 'Private Library '.($index === 1 ? 'One' : ($index === 2 ? 'Two' : (string) $index)),
                'oracleText' => 'Private oracle text '.$index,
                'zone' => 'library',
                'revealedTo' => [],
            ];
        }

        $snapshot['players'][$actor->id()]['zones']['library'] = $library;
        $snapshot['players'][$actor->id()]['zoneCounts']['library'] = count($library);
        $game->replaceSnapshot($snapshot);

        return [$game, $actor, $opponent];
    }

    /**
     * @return array{Game, User, User}
     */
    private function gameWithAdvancedBattlefieldCards(bool $tapped = false): array
    {
        [$game, $actor, $opponent] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['battlefield'] = [
            [
                ...$this->card('advanced-1', $actor->id(), ['x' => 0.2, 'y' => 0.2, 'unit' => 'ratio']),
                'name' => 'Secret Dragon',
                'oracleText' => 'Private oracle',
                'power' => 4,
                'toughness' => 4,
                'defaultPower' => 4,
                'defaultToughness' => 4,
                'tapped' => $tapped,
                'rotation' => $tapped ? 90 : 0,
                'zone' => 'battlefield',
            ],
            [
                ...$this->card('advanced-2', $actor->id(), ['x' => 0.4, 'y' => 0.4, 'unit' => 'ratio']),
                'name' => 'Support Bear',
                'tapped' => $tapped,
                'rotation' => $tapped ? 90 : 0,
                'zone' => 'battlefield',
            ],
        ];
        $snapshot['players'][$actor->id()]['zoneCounts']['battlefield'] = 2;
        $game->replaceSnapshot($snapshot);

        return [$game, $actor, $opponent];
    }

    /**
     * @return array{Game, User, User}
     */
    private function gameWithPrivateHandCard(): array
    {
        [$game, $actor, $opponent] = $this->game();
        $snapshot = $game->snapshot();
        $snapshot['players'][$actor->id()]['zones']['hand'] = [[
            ...$this->card('private-hand-1', $actor->id(), ['x' => 0, 'y' => 0]),
            'name' => 'Private Hand Reveal',
            'oracleText' => 'Secret hand text',
            'zone' => 'hand',
            'revealedTo' => [],
        ]];
        $snapshot['players'][$actor->id()]['zoneCounts']['hand'] = 1;
        $game->replaceSnapshot($snapshot);

        return [$game, $actor, $opponent];
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array<string,mixed>
     */
    private function applyAndBuild(
        Game $game,
        User $actor,
        string $type,
        array $payload,
        string $clientActionId,
        ?GameCommandHandler $handler = null,
    ): array
    {
        $previous = $game->snapshot();
        $handler ??= new GameCommandHandler();
        $event = $handler->apply($game, $type, $payload, $actor, $clientActionId);

        return (new GameWebsocketPatchBuilder(new GameWebsocketMessageFactory()))->build($game->id(), $previous, $game->snapshot(), $event);
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return array<string,mixed>
     */
    private function applyAndBuildProjected(
        Game $game,
        User $actor,
        string $type,
        array $payload,
        string $clientActionId,
        User $viewer,
        ?GameCommandHandler $handler = null,
    ): array
    {
        $previous = $game->snapshot();
        $handler ??= new GameCommandHandler();
        $event = $handler->apply($game, $type, $payload, $actor, $clientActionId);
        $projection = new GameProjectionService($handler);

        return (new GameWebsocketPatchBuilder(new GameWebsocketMessageFactory()))->build(
            $game->id(),
            $projection->projectSnapshot($previous, $viewer, $game->room()->hasPlayer($viewer)),
            $projection->projectSnapshot($game->snapshot(), $viewer, $game->room()->hasPlayer($viewer)),
            $event,
            null,
            $viewer->id(),
        );
    }

    /**
     * @param array<string,mixed> $handlerPayload
     * @param array<string,mixed> $eventPayload
     *
     * @return array<string,mixed>
     */
    private function applyAndBuildProjectedWithEventPayload(
        Game $game,
        User $actor,
        string $type,
        array $handlerPayload,
        array $eventPayload,
        string $clientActionId,
        User $viewer,
        ?GameCommandHandler $handler = null,
    ): array {
        $previous = $game->snapshot();
        $handler ??= new GameCommandHandler();
        $event = $handler->apply($game, $type, $handlerPayload, $actor, $clientActionId);
        $projection = new GameProjectionService($handler);

        return (new GameWebsocketPatchBuilder(new GameWebsocketMessageFactory()))->build(
            $game->id(),
            $projection->projectSnapshot($previous, $viewer, $game->room()->hasPlayer($viewer)),
            $projection->projectSnapshot($game->snapshot(), $viewer, $game->room()->hasPlayer($viewer)),
            $event,
            $eventPayload,
            $viewer->id(),
        );
    }

    /**
     * @return array<string,mixed>
     */
    private function snapshot(User $actor, User $opponent): array
    {
        return [
            'version' => 1,
            'ownerId' => $actor->id(),
            'players' => [
                $actor->id() => $this->player($actor),
                $opponent->id() => $this->player($opponent),
            ],
            'turn' => ['activePlayerId' => $actor->id(), 'phase' => 'main-1', 'number' => 1],
            'timer' => ['mode' => 'none', 'status' => 'idle', 'durationSeconds' => null, 'remainingSeconds' => null],
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
    private function player(User $user): array
    {
        return [
            'user' => $user->toArray(),
            'life' => 40,
            'zones' => [
                'library' => [],
                'hand' => [],
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ],
            'zoneCounts' => [
                'library' => 0,
                'hand' => 0,
                'battlefield' => 0,
                'graveyard' => 0,
                'exile' => 0,
                'command' => 0,
            ],
            'commanderDamage' => [],
            'counters' => [],
            'backgroundName' => 'G_3',
            'sleevesName' => 'default',
        ];
    }

    /**
     * @param array<string,mixed> $position
     *
     * @return array<string,mixed>
     */
    private function card(string $instanceId, string $playerId, array $position): array
    {
        return [
            'instanceId' => $instanceId,
            'ownerId' => $playerId,
            'controllerId' => $playerId,
            'name' => $instanceId,
            'tapped' => false,
            'position' => $position,
        ];
    }
}
