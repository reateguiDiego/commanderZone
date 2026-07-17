<?php

namespace App\Tests\Application\Game\Contract\V2;

use App\Application\Game\Contract\V2\BootstrapV2;
use App\Application\Game\Contract\V2\CommandEnvelopeV2;
use App\Application\Game\Contract\V2\EventPayloadV2;
use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\PatchEnvelopeV2;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameplayV2ContractFactoryTest extends TestCase
{
    public function testCommandEnvelopeRoundTripsWithOptionalMetadata(): void
    {
        $envelope = CommandEnvelopeV2::fromArray([
            'gameId' => 'game-1',
            'baseVersion' => 3,
            'clientActionId' => 'action-1',
            'type' => 'library.draw',
            'payload' => ['playerId' => 'player-1', 'count' => 1],
            'sentAt' => '2026-01-01T00:00:00+00:00',
            'client' => ['platform' => 'web'],
        ]);

        self::assertSame([
            'gameId' => 'game-1',
            'baseVersion' => 3,
            'clientActionId' => 'action-1',
            'type' => 'library.draw',
            'payload' => ['playerId' => 'player-1', 'count' => 1],
            'sentAt' => '2026-01-01T00:00:00+00:00',
            'client' => ['platform' => 'web'],
        ], $envelope->toArray());
    }

    public function testPatchEnvelopeValidatesVisibilityAndOps(): void
    {
        $patch = PatchEnvelopeV2::fromArray([
            'gameId' => 'game-1',
            'version' => 4,
            'visibility' => 'player:user-1',
            'ackClientActionId' => 'action-1',
            'ops' => [
                ['op' => 'card.move', 'instanceId' => 'c1', 'toZone' => 'battlefield'],
            ],
        ]);

        self::assertSame('player:user-1', $patch->visibility);
        self::assertSame('action-1', $patch->ackClientActionId);
        self::assertSame('card.move', $patch->ops[0]['op']);
    }

    public function testPatchEnvelopeRejectsInvalidVisibility(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        PatchEnvelopeV2::fromArray([
            'gameId' => 'game-1',
            'version' => 2,
            'visibility' => 'private',
            'ops' => [['op' => 'x']],
        ]);
    }

    public function testPatchEnvelopeRejectsNonNumericOrZeroGroupMasks(): void
    {
        foreach (['group:players', 'group:0'] as $visibility) {
            try {
                PatchEnvelopeV2::fromArray([
                    'gameId' => 'game-1',
                    'version' => 2,
                    'visibility' => $visibility,
                    'ops' => [['op' => 'x']],
                ]);
                self::fail(sprintf('Visibility %s should be rejected.', $visibility));
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }

    public function testFactoryBuildsBootstrapV2FromProjectedSnapshot(): void
    {
        [$game, $viewer] = $this->game();
        $factory = new GameplayV2ContractFactory();
        $snapshot = $this->projectedSnapshot($viewer);
        $snapshot['players'][$viewer->id()]['mulligan'] = [
            'rule' => 'GENEROUS',
            'firstMulliganFree' => true,
            'mulligansTaken' => 0,
            'effectiveMulligans' => 0,
            'drawCount' => 10,
            'bottomSelectionCount' => 3,
            'finalHandSize' => 7,
            'needsBottomSelection' => true,
            'bottomOrderMode' => 'RANDOM_SERVER_SIDE',
            'needsScryAfterKeep' => false,
            'canTakeAnotherMulligan' => true,
            'status' => 'DECIDING',
            'ready' => false,
            'handCount' => 10,
        ];
        $snapshot['players'][$viewer->id()]['life'] = 19;
        $snapshot['players'][$viewer->id()]['status'] = 'defeated';
        $snapshot['players'][$viewer->id()]['commanderDamage'] = ['opponent-commander' => 21];
        $snapshot['turn'] = ['activePlayerId' => 'next-player', 'phase' => 'main-1', 'number' => 4];
		$snapshot['presence'] = [$viewer->id() => ['playerId' => $viewer->id(), 'connected' => false, 'activeConnectionCount' => 0, 'connectionEpoch' => 7]];
		$snapshot['disconnectVote'] = ['voteId' => 'vote-1', 'targetPlayerId' => $viewer->id(), 'status' => 'open', 'eligibleVoterIds' => ['next-player'], 'requiredVotes' => 1, 'votes' => []];
		$snapshot['disconnectCooldowns'] = [$viewer->id() => ['targetPlayerId' => $viewer->id(), 'voteId' => 'vote-old', 'reason' => 'wait', 'cooldownUntil' => '2026-07-13T12:05:00Z']];
		$snapshot['rematch'] = ['votes' => [$viewer->id() => ['playerId' => $viewer->id(), 'vote' => 'leave', 'votedAt' => '2026-07-13T12:00:00Z']]];
        $bootstrap = $factory->bootstrap($game, $viewer, $snapshot);

        self::assertInstanceOf(BootstrapV2::class, $bootstrap);
        self::assertSame($game->id(), $bootstrap->game['id']);
        self::assertSame($viewer->id(), $bootstrap->game['viewerId']);
        self::assertArrayHasKey($viewer->id().':battlefield', $bootstrap->zones);
        self::assertArrayHasKey('battlefield-1', $bootstrap->instances);
        self::assertSame('battlefield', $bootstrap->zones[$viewer->id().':battlefield']['name']);
        self::assertSame(1, $bootstrap->zoneCounts[$viewer->id().':battlefield']);
        self::assertSame(['U', 'R', 'G'], $bootstrap->players[$viewer->id()]['colorIdentity']);
        self::assertSame('R_7', $bootstrap->players[$viewer->id()]['backgroundName']);
        self::assertSame('custom-sleeves', $bootstrap->players[$viewer->id()]['sleevesName']);
        self::assertSame(19, $bootstrap->players[$viewer->id()]['life']);
        self::assertSame('defeated', $bootstrap->players[$viewer->id()]['status']);
        self::assertSame(['opponent-commander' => 21], $bootstrap->players[$viewer->id()]['commanderDamage']);
        self::assertSame('next-player', $bootstrap->turn['activePlayerId'] ?? null);
		self::assertFalse($bootstrap->game['presence'][$viewer->id()]['connected']);
		self::assertArrayNotHasKey('connectionEpoch', $bootstrap->game['presence'][$viewer->id()]);
		self::assertSame('vote-1', $bootstrap->game['disconnectVote']['voteId']);
		self::assertSame('vote-old', $bootstrap->game['disconnectCooldowns'][$viewer->id()]['voteId']);
		self::assertSame('leave', $bootstrap->game['rematch']['votes'][$viewer->id()]['vote']);
        self::assertSame(3, $bootstrap->players[$viewer->id()]['mulligan']['bottomSelectionCount'] ?? null);
        self::assertSame('RANDOM_SERVER_SIDE', $bootstrap->players[$viewer->id()]['mulligan']['bottomOrderMode'] ?? null);
        self::assertNotEmpty($bootstrap->staticCards);
        self::assertSame('33333333-3333-3333-3333-333333333333', $bootstrap->staticCards['33333333-3333-3333-3333-333333333333:card']['printId']);
        self::assertSame('legacy-snapshot-v1', $bootstrap->staticCards['33333333-3333-3333-3333-333333333333:card']['cardVersion']);
        self::assertSame('en', $bootstrap->staticCards['33333333-3333-3333-3333-333333333333:card']['language']);
        self::assertSame('public', $bootstrap->staticCards['33333333-3333-3333-3333-333333333333:card']['viewerVisibility']);
        self::assertSame('33333333-3333-3333-3333-333333333333', $bootstrap->instances['battlefield-1']['printId']);
        self::assertSame('en', $bootstrap->instances['battlefield-1']['language']);
        self::assertSame('public', $bootstrap->instances['battlefield-1']['viewerVisibility']);
        self::assertSame('private', $bootstrap->instances['hand-1']['viewerVisibility']);
        self::assertSame('chat-1', $bootstrap->chat[0]['id']);
        self::assertSame('log-1', $bootstrap->eventLog[0]['id']);
        self::assertSame('chat-1', $bootstrap->chatCursor);
        self::assertSame('log-1', $bootstrap->logCursor);
        self::assertSame('chat-1', $bootstrap->toArray()['chat'][0]['id']);
        self::assertSame('log-1', $bootstrap->toArray()['eventLog'][0]['id']);
        self::assertSame('commanderzone-manual-v1', $bootstrap->rulesVersion);
        self::assertSame('legacy-snapshot-v1', $bootstrap->cardCatalogVersion);
        self::assertIsInt($bootstrap->payloadBytes);
    }

    public function testBootstrapRedactsHistoricalPrivateGameLogEntries(): void
    {
        [$game, $viewer] = $this->game();
        $snapshot = $this->projectedSnapshot($viewer);
        $snapshot['eventLog'][] = [
            'id' => 'legacy-private-bootstrap-log',
            'type' => 'hand.cards.reveal',
            'message' => 'Owner revealed a secret card.',
            'i18nKey' => 'gameLog.hand.revealed',
            'cardInstanceId' => 'private-bootstrap-instance',
            'params' => [
                'count' => 1,
                'orderedInstanceIds' => ['private-bootstrap-instance'],
            ],
            'refs' => [
                'cards' => [
                    'private-bootstrap-instance' => [
                        'instanceId' => 'private-bootstrap-instance',
                        'visibility' => 'hidden',
                    ],
                ],
            ],
        ];

        $bootstrap = (new GameplayV2ContractFactory())->bootstrap($game, $viewer, $snapshot);
        $encoded = json_encode($bootstrap->eventLog, JSON_THROW_ON_ERROR);

        self::assertStringNotContainsString('private-bootstrap-instance', $encoded);
        self::assertStringNotContainsString('cardInstanceId', $encoded);
        self::assertSame('gameLog.hand.revealed', $bootstrap->eventLog[array_key_last($bootstrap->eventLog)]['i18nKey'] ?? null);
        self::assertSame(1, $bootstrap->eventLog[array_key_last($bootstrap->eventLog)]['params']['count'] ?? null);
    }

    public function testBootstrapMarksCommandZoneCardsAsCommandersWhenLegacySnapshotOmittedFlag(): void
    {
        [$game, $viewer] = $this->game();
        $snapshot = $this->projectedSnapshot($viewer);
        $snapshot['players'][$viewer->id()]['zones']['command'] = [[
            'instanceId' => 'commander-without-flag',
            'ownerId' => $viewer->id(),
            'controllerId' => $viewer->id(),
            'scryfallId' => '33333333-3333-3333-3333-333333333333',
            'name' => 'Commander Without Flag',
            'zone' => 'command',
        ]];
        $snapshot['players'][$viewer->id()]['zoneCounts']['command'] = 1;

        $bootstrap = (new GameplayV2ContractFactory())->bootstrap($game, $viewer, $snapshot);

        self::assertTrue($bootstrap->instances['commander-without-flag']['isCommander'] ?? false);
    }

	public function testBootstrapNormalizesLegacyEmptyRematchProjection(): void
	{
		[$game, $viewer] = $this->game();
		$snapshot = $this->projectedSnapshot($viewer);
		$snapshot['rematch'] = [];

		$bootstrap = (new GameplayV2ContractFactory())->bootstrap($game, $viewer, $snapshot);

		self::assertSame([], $bootstrap->game['rematch']['votes']);
		self::assertNull($bootstrap->game['disconnectVote']);
	}

    public function testBootstrapUsesSharedStaticRefForGenericTokensAndCompactStackRelations(): void
    {
        [$game, $viewer] = $this->game();
        $factory = new GameplayV2ContractFactory();
        $snapshot = $this->projectedSnapshot($viewer);
        $snapshot['players'][$viewer->id()]['zoneCounts']['battlefield'] = 3;
        $snapshot['players'][$viewer->id()]['zones']['battlefield'][] = [
            'instanceId' => 'token-1',
            'ownerId' => $viewer->id(),
            'controllerId' => $viewer->id(),
            'name' => 'Bear Token',
            'typeLine' => 'Token Creature - Bear',
            'power' => 2,
            'toughness' => 2,
            'defaultPower' => 2,
            'defaultToughness' => 2,
            'zone' => 'battlefield',
            'isToken' => true,
            'tokenMeta' => [
                'templateCardKey' => 'synthetic:bear-token',
                'templateCardVersion' => 'bear-token-v1',
            ],
        ];
        $snapshot['players'][$viewer->id()]['zones']['battlefield'][] = [
            'instanceId' => 'token-2',
            'ownerId' => $viewer->id(),
            'controllerId' => $viewer->id(),
            'name' => 'Bear Token',
            'typeLine' => 'Token Creature - Bear',
            'power' => 2,
            'toughness' => 2,
            'defaultPower' => 2,
            'defaultToughness' => 2,
            'zone' => 'battlefield',
            'isToken' => true,
            'tokenMeta' => [
                'templateCardKey' => 'synthetic:bear-token',
                'templateCardVersion' => 'bear-token-v1',
            ],
        ];
        $snapshot['stack'] = [[
            'id' => 'stack-1',
            'stackId' => 'stack-1',
            'kind' => 'card',
            'sourceInstanceId' => 'battlefield-1',
            'controllerId' => $viewer->id(),
            'text' => 'Custom stack text',
            'card' => $snapshot['players'][$viewer->id()]['zones']['battlefield'][0],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]];

        $bootstrap = $factory->bootstrap($game, $viewer, $snapshot);

        self::assertSame('synthetic:bear-token', $bootstrap->instances['token-1']['cardRef'] ?? null);
        self::assertSame('synthetic:bear-token', $bootstrap->instances['token-2']['cardRef'] ?? null);
        self::assertArrayHasKey('synthetic:bear-token', $bootstrap->staticCards);
        self::assertCount(4, $bootstrap->staticCards);
        self::assertSame('stack-1', $bootstrap->relations['stack'][0]['stackId'] ?? null);
        self::assertSame('battlefield-1', $bootstrap->relations['stack'][0]['sourceInstanceId'] ?? null);
        self::assertArrayNotHasKey('card', $bootstrap->relations['stack'][0]);
    }

    public function testBootstrapV2KeepsPrivateHandAndLibraryWithoutCardKeyOrStaticPayload(): void
    {
        [$game, $viewer] = $this->game();
        $factory = new GameplayV2ContractFactory();
        $opponentId = 'opponent-player';
        $snapshot = $this->projectedSnapshot($viewer);
        $snapshot['players'][$opponentId] = [
            'user' => ['id' => $opponentId, 'email' => 'opponent@example.test', 'displayName' => 'Opponent', 'roles' => []],
            'life' => 40,
            'status' => 'active',
            'handCount' => 2,
            'zoneCounts' => ['hand' => 2, 'library' => 99],
            'commanderDamage' => [],
            'counters' => [],
            'zones' => [
                'hand' => [[
                    'instanceId' => $opponentId.'-hidden-hand-0',
                    'ownerId' => $opponentId,
                    'controllerId' => $opponentId,
                    'name' => 'Hidden card',
                    'hidden' => true,
                    'faceDown' => true,
                    'zone' => 'hand',
                ]],
                'library' => [[
                    'instanceId' => $opponentId.'-hidden-library-top',
                    'ownerId' => $opponentId,
                    'controllerId' => $opponentId,
                    'name' => 'Hidden card',
                    'hidden' => true,
                    'faceDown' => true,
                    'zone' => 'library',
                ]],
            ],
        ];

        $bootstrap = $factory->bootstrap($game, $viewer, $snapshot);
        $handPlaceholder = $bootstrap->instances[$opponentId.'-hidden-hand-0'] ?? [];
        $libraryPlaceholder = $bootstrap->instances[$opponentId.'-hidden-library-top'] ?? [];

        self::assertArrayNotHasKey('cardKey', $handPlaceholder);
        self::assertArrayNotHasKey('cardVersion', $handPlaceholder);
        self::assertArrayNotHasKey('cardKey', $libraryPlaceholder);
        self::assertArrayNotHasKey('cardVersion', $libraryPlaceholder);
        self::assertArrayNotHasKey('instance:'.$opponentId.'-hidden-hand-0', $bootstrap->staticCards);
        self::assertArrayNotHasKey('instance:'.$opponentId.'-hidden-library-top', $bootstrap->staticCards);
    }

    public function testBootstrapV2HydratesVisibleZonesAndRevealedTopOnly(): void
    {
        [$game, $viewer] = $this->game();
        $factory = new GameplayV2ContractFactory();
        $opponentId = 'opponent-player';
        $snapshot = $this->projectedSnapshot($viewer);
        $snapshot['players'][$viewer->id()]['zones']['graveyard'] = [[
            'instanceId' => 'graveyard-1',
            'ownerId' => $viewer->id(),
            'controllerId' => $viewer->id(),
            'scryfallId' => '44444444-4444-4444-4444-444444444444',
            'name' => 'Graveyard Card',
            'zone' => 'graveyard',
        ]];
        $snapshot['players'][$viewer->id()]['zones']['exile'] = [[
            'instanceId' => 'exile-1',
            'ownerId' => $viewer->id(),
            'controllerId' => $viewer->id(),
            'scryfallId' => '55555555-5555-5555-5555-555555555555',
            'name' => 'Exile Card',
            'zone' => 'exile',
        ]];
        $snapshot['players'][$opponentId] = [
            'user' => ['id' => $opponentId, 'email' => 'opponent@example.test', 'displayName' => 'Opponent', 'roles' => []],
            'life' => 40,
            'status' => 'active',
            'handCount' => 0,
            'zoneCounts' => ['library' => 2],
            'commanderDamage' => [],
            'counters' => [],
            'zones' => [
                'library' => [
                    [
                        'instanceId' => 'opponent-revealed-top',
                        'ownerId' => $opponentId,
                        'controllerId' => $opponentId,
                        'scryfallId' => '66666666-6666-6666-6666-666666666666',
                        'name' => 'Revealed Top',
                        'zone' => 'library',
                        'revealedTo' => [$viewer->id()],
                    ],
                    [
                        'instanceId' => 'opponent-hidden-library-top',
                        'ownerId' => $opponentId,
                        'controllerId' => $opponentId,
                        'name' => 'Hidden card',
                        'hidden' => true,
                        'faceDown' => true,
                        'zone' => 'library',
                    ],
                ],
            ],
        ];

        $bootstrap = $factory->bootstrap($game, $viewer, $snapshot);

        self::assertArrayHasKey('33333333-3333-3333-3333-333333333333:card', $bootstrap->staticCards);
        self::assertArrayHasKey('44444444-4444-4444-4444-444444444444:card', $bootstrap->staticCards);
        self::assertArrayHasKey('55555555-5555-5555-5555-555555555555:card', $bootstrap->staticCards);
        self::assertArrayHasKey('66666666-6666-6666-6666-666666666666:card', $bootstrap->staticCards);
        self::assertArrayNotHasKey('instance:opponent-hidden-library-top', $bootstrap->staticCards);
    }

    public function testBootstrapV2OmitsStaticCardsKnownByClientCache(): void
    {
        [$game, $viewer] = $this->game();
        $factory = new GameplayV2ContractFactory();

        $bootstrap = $factory->bootstrap($game, $viewer, $this->projectedSnapshot($viewer), [
            '33333333-3333-3333-3333-333333333333%3Acard|33333333-3333-3333-3333-333333333333|legacy-snapshot-v1|en|public',
        ]);

        self::assertSame('33333333-3333-3333-3333-333333333333:card', $bootstrap->instances['battlefield-1']['cardKey']);
        self::assertArrayNotHasKey('33333333-3333-3333-3333-333333333333:card', $bootstrap->staticCards);
        self::assertLessThan(12000, $bootstrap->payloadBytes ?? 0);
    }

    public function testBootstrapV2DoesNotTreatLegacyTwoPartCacheKeyAsValidIdentity(): void
    {
        [$game, $viewer] = $this->game();
        $factory = new GameplayV2ContractFactory();

        $bootstrap = $factory->bootstrap($game, $viewer, $this->projectedSnapshot($viewer), [
            '33333333-3333-3333-3333-333333333333:card@legacy-snapshot-v1',
        ]);

        self::assertArrayHasKey('33333333-3333-3333-3333-333333333333:card', $bootstrap->staticCards);
    }

    public function testFactoryBuildsEventPayloadV2FromCurrentEvent(): void
    {
        [$game, $viewer] = $this->game();
        $event = new GameEvent($game, 'life.changed', ['playerId' => $viewer->id(), 'delta' => -1], $viewer, 'action-1');
        $factory = new GameplayV2ContractFactory();

        $payload = $factory->event($game, $event, 2);

        self::assertInstanceOf(EventPayloadV2::class, $payload);
        self::assertSame($game->id(), $payload->gameId);
        self::assertSame(2, $payload->version);
        self::assertSame('life.changed', $payload->type);
        self::assertSame('action-1', $payload->clientActionId);
        self::assertSame($viewer->id(), $payload->createdBy);
    }

    public function testFactoryConvertsLegacyCommandPayloadIntoV2Envelope(): void
    {
        $factory = new GameplayV2ContractFactory();
        $envelope = $factory->commandFromLegacyPayload('game-1', [
            'baseVersion' => 8,
            'clientActionId' => 'action-legacy',
            'type' => 'life.changed',
            'payload' => ['playerId' => 'p1', 'delta' => -2],
        ]);

        self::assertSame('game-1', $envelope->gameId);
        self::assertSame(8, $envelope->baseVersion);
        self::assertSame('action-legacy', $envelope->clientActionId);
    }

    public function testFactoryDefaultsMissingOrNullCommandPayloadToEmptyObject(): void
    {
        $factory = new GameplayV2ContractFactory();
        $websocketEnvelope = $factory->commandFromWebsocketMessage([
            'gameId' => 'game-1',
            'baseVersion' => 8,
            'clientActionId' => 'action-concede',
            'type' => 'game.concede',
        ]);
        $legacyEnvelope = $factory->commandFromLegacyPayload('game-1', [
            'baseVersion' => 8,
            'clientActionId' => 'action-concede-legacy',
            'type' => 'game.concede',
            'payload' => null,
        ]);

        self::assertSame([], $websocketEnvelope->payload);
        self::assertSame([], $legacyEnvelope->payload);
    }

    public function testBootstrapContractRejectsInvalidZoneCounts(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        BootstrapV2::fromArray([
            'game' => ['id' => 'game-1'],
            'players' => [],
            'zones' => [],
            'instances' => [],
            'zoneCounts' => ['p1:hand' => -1],
            'relations' => [],
            'turn' => [],
            'staticCards' => [],
        ]);
    }

    /**
     * @return array{Game, User}
     */
    private function game(): array
    {
        $viewer = new User('viewer@example.test', 'Viewer');
        $room = new Room($viewer);
        $room->addPlayer(new RoomPlayer($room, $viewer));

        return [new Game($room, ['version' => 1, 'players' => [$viewer->id() => ['zones' => []]]]), $viewer];
    }

    /**
     * @return array<string,mixed>
     */
    private function projectedSnapshot(User $viewer): array
    {
        return [
            'version' => 2,
            'ownerId' => $viewer->id(),
            'players' => [
                $viewer->id() => [
                    'user' => $viewer->toArray(),
                    'life' => 40,
                    'status' => 'active',
                    'handCount' => 1,
                    'deckName' => 'Deck',
                    'colorIdentity' => ['U', 'R', 'G'],
                    'backgroundName' => 'R_7',
                    'sleevesName' => 'custom-sleeves',
                    'commanderDamage' => [],
                    'counters' => [],
                    'zoneCounts' => [
                        'library' => 1,
                        'hand' => 1,
                        'battlefield' => 1,
                    ],
                    'zones' => [
                        'library' => [[
                            'instanceId' => 'library-1',
                            'ownerId' => $viewer->id(),
                            'controllerId' => $viewer->id(),
                            'scryfallId' => '11111111-1111-1111-1111-111111111111',
                            'name' => 'Library Card',
                            'tapped' => false,
                            'zone' => 'library',
                        ]],
                        'hand' => [[
                            'instanceId' => 'hand-1',
                            'ownerId' => $viewer->id(),
                            'controllerId' => $viewer->id(),
                            'scryfallId' => '22222222-2222-2222-2222-222222222222',
                            'name' => 'Hand Card',
                            'tapped' => false,
                            'zone' => 'hand',
                        ]],
                        'battlefield' => [[
                            'instanceId' => 'battlefield-1',
                            'ownerId' => $viewer->id(),
                            'controllerId' => $viewer->id(),
                            'scryfallId' => '33333333-3333-3333-3333-333333333333',
                            'name' => 'Battlefield Card',
                            'tapped' => true,
                            'zone' => 'battlefield',
                            'position' => ['x' => 0.2, 'y' => 0.3, 'unit' => 'ratio'],
                            'counters' => ['+1/+1' => 1],
                            'imageUris' => ['small' => 'https://example.test/card.png'],
                            'cardFaces' => [],
                            'colorIdentity' => ['G'],
                        ]],
                    ],
                ],
            ],
            'turn' => ['activePlayerId' => $viewer->id(), 'phase' => 'main-1', 'number' => 3],
            'stack' => [['id' => 'stack-1', 'kind' => 'spell', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'arrows' => [['id' => 'arrow-1', 'fromInstanceId' => 'battlefield-1', 'toInstanceId' => 'hand-1', 'color' => 'red', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'attachments' => [['id' => 'attachment-1', 'equipmentInstanceId' => 'battlefield-1', 'attachedToInstanceId' => 'hand-1', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'specialEntities' => [['id' => 'entity-1', 'template' => 'monarch', 'scope' => 'global', 'ownerPlayerId' => null, 'card' => null, 'state' => [], 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'chat' => [['id' => 'chat-1', 'message' => 'hola', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'eventLog' => [['id' => 'log-1', 'message' => 'log', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:00+00:00',
        ];
    }
}
