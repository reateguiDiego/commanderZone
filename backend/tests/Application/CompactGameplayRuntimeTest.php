<?php

namespace App\Tests\Application;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Compact\CompactGameStateInvariantChecker;
use App\Application\Game\Compact\GameplayCompactRuntimeFlags;
use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameLibraryOps;
use App\Application\Game\GameProjectionService;
use App\Application\Game\GameSnapshotFactory;
use App\Application\Game\GameVisibilityIndex;
use App\Application\Game\Performance\GameplayBaselineFixtureFactory;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class CompactGameplayRuntimeTest extends TestCase
{
    public function testSnapshotFactoryCanBuildCompactRuntimeWithoutPerInstanceStaticPayload(): void
    {
        $owner = $this->user('owner@example.test', 'Owner', 'owner-id');
        $room = new Room($owner);
        $deck = new Deck($owner, 'Compact Deck');
        $deck->addCard(new DeckCard($deck, $this->domainCard(
            '11111111-1111-4111-8111-111111111111',
            'Compact Commander',
            ['type_line' => 'Legendary Creature - Human Soldier'],
        ), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->domainCard(
            '22222222-2222-4222-8222-222222222222',
            'Compact Land',
            ['type_line' => 'Basic Land - Plains'],
        ), 1, DeckCard::SECTION_MAIN));
        $room->addPlayer(new RoomPlayer($room, $owner, $deck));

        $snapshot = (new GameSnapshotFactory(
            compactRuntimeFlags: new GameplayCompactRuntimeFlags(true),
        ))->fromRoom($room);

        self::assertSame(CompactGameCardStateMapper::SNAPSHOT_FORMAT, $snapshot['runtimeFormat'] ?? null);
        self::assertArrayHasKey('instances', $snapshot);
        self::assertArrayHasKey('zones', $snapshot);
        self::assertArrayHasKey('loc', $snapshot);
        self::assertArrayHasKey('cardCatalog', $snapshot);
        self::assertArrayHasKey('owner-id', $snapshot['zones']);
        self::assertNotEmpty($snapshot['cardCatalog']);

        $commanderInstanceId = $snapshot['zones']['owner-id']['command'][0];
        self::assertIsString($commanderInstanceId);
        self::assertArrayHasKey($commanderInstanceId, $snapshot['instances']);
        self::assertArrayNotHasKey('name', $snapshot['instances'][$commanderInstanceId]);
        self::assertArrayNotHasKey('imageUris', $snapshot['instances'][$commanderInstanceId]);
        self::assertArrayNotHasKey('oracleText', $snapshot['instances'][$commanderInstanceId]);
        self::assertArrayNotHasKey('cardFaces', $snapshot['instances'][$commanderInstanceId]);
        self::assertArrayHasKey($snapshot['instances'][$commanderInstanceId]['cardKey'], $snapshot['cardCatalog']);
    }

    public function testCompactRuntimePreservesPrivateLibraryStaticBundleForOwnerBootstrapOnly(): void
    {
        $owner = $this->user('owner-draw@example.test', 'Owner Draw', 'owner-draw-id');
        $opponent = $this->user('opponent-draw@example.test', 'Opponent Draw', 'opponent-draw-id');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $opponent));
        $snapshot = (new GameCommandHandler())->normalizeSnapshot($this->snapshot($owner, [
            'library' => [[
                ...$this->richCard('library-draw-1', 'Immediate Draw Forest', 'library', [
                    'ownerId' => $owner->id(),
                    'controllerId' => $owner->id(),
                    'scryfallId' => '00000000-0000-7000-8000-00000000d048',
                    'imageUris' => ['normal' => 'https://cards.example/immediate-draw-forest.jpg'],
                    'cardFaces' => [[
                        'name' => 'Immediate Draw Forest',
                        'typeLine' => 'Basic Land - Forest',
                        'oracleText' => 'Private forest face.',
                        'imageUris' => ['normal' => 'https://cards.example/immediate-draw-forest-face.jpg'],
                    ]],
                    'typeLine' => 'Basic Land - Forest',
                    'oracleText' => 'Private forest oracle.',
                ]),
            ]],
        ], $opponent));

        $mapper = new CompactGameCardStateMapper();
        $compact = $mapper->compactSnapshot($snapshot, 'game-runtime-draw-static', Game::STATUS_ACTIVE);
        $compactInstance = $compact['instances']['library-draw-1'] ?? [];
        $cardKey = is_string($compactInstance['cardKey'] ?? null) ? $compactInstance['cardKey'] : '';
        $cardVersion = is_string($compact['cardCatalog'][$cardKey]['cardVersion'] ?? null) ? $compact['cardCatalog'][$cardKey]['cardVersion'] : null;

        self::assertNotSame('', $cardKey);
        self::assertSame($cardKey, $compactInstance['cardKey'] ?? null);
        self::assertArrayHasKey($cardKey, $compact['cardCatalog']);
        self::assertSame('Immediate Draw Forest', $compact['cardCatalog'][$cardKey]['name'] ?? null);
        self::assertNotNull($cardVersion);
        self::assertSame('https://cards.example/immediate-draw-forest.jpg', $compact['cardCatalog'][$cardKey]['imageUris']['normal'] ?? null);
        self::assertArrayNotHasKey('name', $compactInstance);
        self::assertArrayNotHasKey('imageUris', $compactInstance);
        self::assertArrayNotHasKey('oracleText', $compactInstance);
        self::assertArrayNotHasKey('cardFaces', $compactInstance);

        $game = new Game($room, $compact);
        $projection = new GameProjectionService(new GameCommandHandler());
        $factory = new GameplayV2ContractFactory();
        $ownerBootstrap = $factory->bootstrap($game, $owner, $projection->project($game, $owner))->toArray();
        $opponentBootstrap = $factory->bootstrap($game, $opponent, $projection->project($game, $opponent))->toArray();

        self::assertSame($cardKey, $ownerBootstrap['instances']['library-draw-1']['cardKey'] ?? null);
        self::assertArrayHasKey($cardKey, $ownerBootstrap['staticCards']);
        self::assertSame('Immediate Draw Forest', $ownerBootstrap['staticCards'][$cardKey]['name'] ?? null);
        self::assertSame($cardVersion, $ownerBootstrap['staticCards'][$cardKey]['cardVersion'] ?? null);
        self::assertSame('private', $ownerBootstrap['staticCards'][$cardKey]['viewerVisibility'] ?? null);
        self::assertSame('https://cards.example/immediate-draw-forest.jpg', $ownerBootstrap['staticCards'][$cardKey]['imageUris']['normal'] ?? null);

        $opponentEncoded = json_encode($opponentBootstrap, JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString($cardKey, $opponentEncoded);
        self::assertStringNotContainsString('Immediate Draw Forest', $opponentEncoded);
        self::assertStringNotContainsString('https://cards.example/immediate-draw-forest.jpg', $opponentEncoded);
    }

    public function testProjectionHydratesCompactRuntimeForBootstrapWithoutLeakingOpponentPrivateCardData(): void
    {
        $owner = $this->user('owner@example.test', 'Owner', 'owner-id');
        $viewer = $this->user('viewer@example.test', 'Viewer', 'viewer-id');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $viewer));

        $snapshot = $this->snapshot($owner, [
            'hand' => [
                $this->richCard('hand-1', 'Private Tutor', 'hand'),
            ],
            'library' => [
                [
                    ...$this->richCard('library-1', 'Private Top', 'library'),
                    'revealedTo' => ['other-viewer'],
                ],
            ],
            'battlefield' => [
                [
                    ...$this->richCard('battlefield-1', 'Visible Ring', 'battlefield'),
                    'revealedTo' => ['all'],
                ],
            ],
            'command' => [
                $this->richCard('commander-1', 'Visible Commander', 'command', ['isCommander' => true]),
            ],
        ], $viewer);

        $game = new Game($room, (new CompactGameCardStateMapper())->compactSnapshot($snapshot));
        $projected = (new GameProjectionService(new GameCommandHandler()))->project($game, $viewer);
        $ownerProjection = $projected['players'][$owner->id()];
        $privacyIssues = (new CompactGameStateInvariantChecker())->checkProjectionPrivacy($projected, $viewer->id());

        self::assertSame('Visible Ring', $ownerProjection['zones']['battlefield'][0]['name']);
        self::assertSame('Visible Commander', $ownerProjection['zones']['command'][0]['name']);
        self::assertSame([], $privacyIssues);

        $hiddenHandCard = $ownerProjection['zones']['hand'][0];
        self::assertSame('Hidden card', $hiddenHandCard['name']);
        self::assertArrayNotHasKey('cardKey', $hiddenHandCard);
        self::assertArrayNotHasKey('oracleText', $hiddenHandCard);
        self::assertArrayNotHasKey('imageUris', $hiddenHandCard);

        $hiddenLibraryTop = $ownerProjection['zones']['library'][0];
        self::assertSame('Hidden card', $hiddenLibraryTop['name']);
        self::assertArrayNotHasKey('cardKey', $hiddenLibraryTop);
        self::assertArrayNotHasKey('oracleText', $hiddenLibraryTop);
        self::assertArrayNotHasKey('imageUris', $hiddenLibraryTop);
    }

    public function testCompactRuntimeDoesNotHydrateMissingBattlefieldPositionAsOrigin(): void
    {
        $owner = $this->user('position-owner@example.test', 'Position Owner', 'position-owner');
        $mapper = new CompactGameCardStateMapper();
        $snapshot = $this->snapshot($owner, [
            'battlefield' => [
                $this->richCard('battlefield-no-position', 'Visible Ring', 'battlefield', [
                    'ownerId' => $owner->id(),
                    'controllerId' => $owner->id(),
                ]),
            ],
        ]);
        unset($snapshot['players'][$owner->id()]['zones']['battlefield'][0]['position']);

        $compact = $mapper->compactSnapshot($snapshot, 'game-position-compact', Game::STATUS_ACTIVE);
        self::assertArrayNotHasKey('position', $compact['instances']['battlefield-no-position']);

        $roundTrip = $mapper->hydrateSnapshot($compact);
        self::assertNull($roundTrip['players'][$owner->id()]['zones']['battlefield'][0]['position'] ?? null);
    }

    public function testCommandHandlerCompactsTokenCopiesAndStackEntriesWithoutStaticPayloadDuplication(): void
    {
        $actor = $this->user('actor@example.test', 'Actor', 'actor-id');
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));
        $game = new Game($room, $this->snapshot($actor, [
            'battlefield' => [
                $this->richCard('battlefield-1', 'Copy Source', 'battlefield', [
                    'ownerId' => $actor->id(),
                    'controllerId' => $actor->id(),
                ]),
            ],
        ]));
        $handler = new GameCommandHandler(compactRuntimeFlags: new GameplayCompactRuntimeFlags(true));

        $handler->apply($game, 'card.token_copy.created', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
        ], $actor);

        $snapshot = $game->snapshot();
        $battlefieldIds = $snapshot['zones'][$actor->id()]['battlefield'];
        self::assertSame(CompactGameCardStateMapper::SNAPSHOT_FORMAT, $snapshot['runtimeFormat'] ?? null);
        self::assertCount(2, $battlefieldIds);
        self::assertSame(
            $snapshot['instances'][$battlefieldIds[0]]['cardKey'],
            $snapshot['instances'][$battlefieldIds[1]]['cardKey'],
        );
        self::assertCount(1, $snapshot['cardCatalog']);
        self::assertSame('battlefield-1', $snapshot['instances'][$battlefieldIds[1]]['tokenMeta']['copiedFromInstanceId'] ?? null);
        self::assertSame(
            $snapshot['instances'][$battlefieldIds[0]]['cardKey'],
            $snapshot['instances'][$battlefieldIds[1]]['tokenMeta']['copiedFromCardKey'] ?? null,
        );
        self::assertArrayNotHasKey('name', $snapshot['instances'][$battlefieldIds[0]]);
        self::assertArrayNotHasKey('imageUris', $snapshot['instances'][$battlefieldIds[0]]);
        self::assertArrayNotHasKey('oracleText', $snapshot['instances'][$battlefieldIds[1]]);
        self::assertArrayNotHasKey('cardFaces', $snapshot['instances'][$battlefieldIds[1]]);

        $handler->apply($game, 'stack.card_added', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
        ], $actor);

        $stackItem = $game->snapshot()['stack'][0];
        self::assertSame($stackItem['id'], $stackItem['stackId']);
        self::assertSame('battlefield-1', $stackItem['instanceId']);
        self::assertSame('battlefield-1', $stackItem['sourceInstanceId']);
        self::assertSame($snapshot['instances'][$battlefieldIds[0]]['cardKey'], $stackItem['cardKey']);
        self::assertArrayNotHasKey('card', $stackItem);
    }

    public function testCommandHandlerCompactsCreatedTokensWithoutDuplicatingStaticPayload(): void
    {
        $actor = $this->user('actor@example.test', 'Actor', 'actor-id');
        $room = new Room($actor);
        $room->addPlayer(new RoomPlayer($room, $actor));
        $game = new Game($room, $this->snapshot($actor));
        $handler = new GameCommandHandler(compactRuntimeFlags: new GameplayCompactRuntimeFlags(true));

        $handler->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'quantity' => 2,
            'card' => [
                'name' => 'Bear Token',
                'typeLine' => 'Token Creature - Bear',
                'oracleText' => 'A compact token.',
                'imageUris' => ['normal' => 'https://cards.example/bear-token.jpg'],
                'cardFaces' => [[
                    'name' => 'Bear Token',
                    'typeLine' => 'Token Creature - Bear',
                    'oracleText' => 'A compact token.',
                    'imageUris' => ['normal' => 'https://cards.example/bear-token-face.jpg'],
                ]],
                'power' => 2,
                'toughness' => 2,
                'layout' => 'token',
            ],
        ], $actor);

        $snapshot = $game->snapshot();
        $tokens = $snapshot['zones'][$actor->id()]['battlefield'];
        self::assertSame(CompactGameCardStateMapper::SNAPSHOT_FORMAT, $snapshot['runtimeFormat'] ?? null);
        self::assertCount(2, $tokens);
        self::assertSame(
            $snapshot['instances'][$tokens[0]]['cardKey'],
            $snapshot['instances'][$tokens[1]]['cardKey'],
        );
        self::assertCount(1, $snapshot['cardCatalog']);
        self::assertSame(
            $snapshot['instances'][$tokens[0]]['cardKey'],
            $snapshot['instances'][$tokens[0]]['tokenMeta']['templateCardKey'] ?? null,
        );
        self::assertSame(
            $snapshot['cardCatalog'][$snapshot['instances'][$tokens[0]]['cardKey']]['cardVersion'] ?? null,
            $snapshot['instances'][$tokens[0]]['tokenMeta']['templateCardVersion'] ?? null,
        );
        self::assertArrayNotHasKey('name', $snapshot['instances'][$tokens[0]]);
        self::assertArrayNotHasKey('imageUris', $snapshot['instances'][$tokens[0]]);
        self::assertArrayNotHasKey('oracleText', $snapshot['instances'][$tokens[1]]);
        self::assertArrayNotHasKey('cardFaces', $snapshot['instances'][$tokens[1]]);
    }

    public function testCompactGameStateRoundTripsLargeFourPlayerLegacyGameWithLocRelationsAndInvariantChecks(): void
    {
        [$snapshot, $viewer] = $this->fourPlayerLegacySnapshot();
        $snapshot['attachments'] = [[
            'id' => 'attachment-1',
            'equipmentInstanceId' => 'p1-battlefield-001',
            'attachedToInstanceId' => 'p1-battlefield-002',
            'createdAt' => '2026-01-01T00:10:00+00:00',
        ]];
        $snapshot['arrows'] = [[
            'id' => 'arrow-1',
            'fromInstanceId' => 'p1-battlefield-001',
            'toInstanceId' => 'p2-battlefield-001',
            'color' => 'yellow',
            'createdAt' => '2026-01-01T00:11:00+00:00',
        ]];
        $snapshot['specialEntities'] = [[
            'id' => 'helper-1',
            'template' => 'monarch',
            'scope' => 'global',
            'ownerPlayerId' => 'p1',
            'state' => [],
            'createdAt' => '2026-01-01T00:12:00+00:00',
        ]];

        $mapper = new CompactGameCardStateMapper();
        $checker = new CompactGameStateInvariantChecker();
        $compact = $mapper->compactSnapshot($snapshot, 'game-large-1', 'active');
        $roundTrip = $mapper->hydrateSnapshot($compact);
        $projected = (new GameProjectionService(new GameCommandHandler()))->projectSnapshot($roundTrip, $viewer);

        self::assertSame('game-large-1', $compact['gameId']);
        self::assertSame('active', $compact['status']);
        self::assertCount(4, $compact['players']);
        self::assertCount(4, $compact['zones']);
        self::assertCount(400, $compact['instances']);
        self::assertCount(400, $compact['loc']);
        self::assertSame('p1', $compact['loc']['p1-battlefield-001']['playerId']);
        self::assertSame('battlefield', $compact['loc']['p1-battlefield-001']['zone']);
        self::assertSame('p1-battlefield-001', $compact['zones']['p1']['battlefield'][0]);
        self::assertArrayHasKey('attachment-1', $compact['relations']['attachments']);
        self::assertArrayHasKey('arrow-1', $compact['relations']['arrows']);
        self::assertArrayHasKey('helper-1', $compact['relations']['helpers']);
        self::assertSame(['attachment-1'], $compact['relations']['indexes']['attachmentsByEquipment']['p1-battlefield-001'] ?? null);
        self::assertSame(['attachment-1'], $compact['relations']['indexes']['attachmentsByTarget']['p1-battlefield-002'] ?? null);
        self::assertSame(['arrow-1'], $compact['relations']['indexes']['arrowsBySource']['p1-battlefield-001'] ?? null);
        self::assertSame(['arrow-1'], $compact['relations']['indexes']['arrowsByTarget']['p2-battlefield-001'] ?? null);
        self::assertSame([], $checker->check($compact));
        self::assertSame([], $checker->checkProjectionPrivacy($projected, $viewer->id()));
        self::assertCount(4, $roundTrip['players']);
        self::assertCount(58, $roundTrip['players']['p1']['zones']['library']);
        self::assertCount(7, $roundTrip['players']['p1']['zones']['hand']);
        self::assertCount(20, $roundTrip['players']['p1']['zones']['battlefield']);
        self::assertTrue($roundTrip['players']['p1']['zones']['battlefield'][5]['faceDown']);
        self::assertTrue($roundTrip['players']['p1']['zones']['command'][0]['isCommander']);
        self::assertSame('Hidden card', $projected['players']['p1']['zones']['hand'][1]['name']);
    }

    public function testBaselineFixtureCanReplayThroughCompactGameStateRoundTrip(): void
    {
        $fixture = (new GameplayBaselineFixtureFactory())->create('compact-replay');
        $game = $fixture->game();
        $owner = $fixture->user('p1');
        $mapper = new CompactGameCardStateMapper();
        $checker = new CompactGameStateInvariantChecker();

        $compact = $mapper->compactSnapshot($game->snapshot(), $game->id(), $game->status());
        $roundTrip = $mapper->hydrateSnapshot($compact);
        $projected = (new GameProjectionService(new GameCommandHandler()))->projectSnapshot($roundTrip, $owner);

        self::assertSame([], $checker->check($compact));
        self::assertSame($game->snapshot()['turn'], $roundTrip['turn']);
        self::assertCount(count($game->snapshot()['chat']), $roundTrip['chat']);
        self::assertCount(count($game->snapshot()['eventLog']), $roundTrip['eventLog']);
        self::assertSame($owner->id(), $projected['turn']['activePlayerId']);
    }

    public function testCompactHydrationPreservesCardIdentityVersionForDoubleFacedCards(): void
    {
        $owner = $this->user('dfc-owner@example.test', 'DFC Owner', 'dfc-owner');
        $mapper = new CompactGameCardStateMapper();
        $snapshot = $this->snapshot($owner, [
            'command' => [
                $this->richCard('dfc-commander', 'Kytheon, Hero of Akros // Gideon, Battle-Forged', 'command', [
                    'ownerId' => $owner->id(),
                    'controllerId' => $owner->id(),
                    'scryfallId' => '04f9ac76-3af9-4beb-a26b-7a75b162b9bd',
                    'layout' => 'transform',
                    'typeLine' => 'Legendary Creature - Human Soldier // Legendary Planeswalker - Gideon',
                    'power' => 2,
                    'toughness' => 1,
                    'loyalty' => 3,
                    'defaultPower' => 2,
                    'defaultToughness' => 1,
                    'defaultLoyalty' => 3,
                    'cardFaces' => [
                        [
                            'name' => 'Kytheon, Hero of Akros',
                            'typeLine' => 'Legendary Creature - Human Soldier',
                            'oracleText' => 'At end of combat, transform Kytheon.',
                            'imageUris' => ['normal' => 'https://cards.example/kytheon.jpg'],
                        ],
                        [
                            'name' => 'Gideon, Battle-Forged',
                            'typeLine' => 'Legendary Planeswalker - Gideon',
                            'oracleText' => '+2: Up to one target creature.',
                            'imageUris' => ['normal' => 'https://cards.example/gideon.jpg'],
                        ],
                    ],
                ]),
            ],
        ]);

        $compact = $mapper->compactSnapshot($snapshot, 'game-dfc-identity', Game::STATUS_ACTIVE);
        $cardKey = $compact['instances']['dfc-commander']['cardKey'] ?? null;
        self::assertIsString($cardKey);
        $catalogVersion = $compact['cardCatalog'][$cardKey]['cardVersion'] ?? null;

        $roundTrip = $mapper->hydrateSnapshot($compact);
        $hydrated = $roundTrip['players'][$owner->id()]['zones']['command'][0] ?? [];
        $bootstrap = (new GameplayV2ContractFactory())->bootstrap(new Game(new Room($owner), $roundTrip), $owner, $roundTrip);

        self::assertSame($catalogVersion, $hydrated['cardVersion'] ?? null);
        self::assertCount(2, $hydrated['cardFaces'] ?? []);
        self::assertSame($catalogVersion, $bootstrap->instances['dfc-commander']['cardVersion'] ?? null);
        self::assertSame($catalogVersion, $bootstrap->staticCards['04f9ac76-3af9-4beb-a26b-7a75b162b9bd:card']['cardVersion'] ?? null);
        self::assertCount(2, $bootstrap->staticCards['04f9ac76-3af9-4beb-a26b-7a75b162b9bd:card']['cardFaces'] ?? []);
    }

    public function testVisibilityIndexRoundTripsCompactStateAndPreservesLibraryPrivacyByViewer(): void
    {
        $owner = $this->user('owner@example.test', 'Owner', 'owner-id');
        $viewer = $this->user('viewer@example.test', 'Viewer', 'viewer-id');
        $spectator = $this->user('spectator@example.test', 'Spectator', 'spectator-id');
        $flags = new GameplayV2Flags(false, false, false, false, true);
        $handler = new GameCommandHandler(flagsV2: $flags);
        $projection = new GameProjectionService($handler, null, null, null, new GameVisibilityIndex(), $flags);

        $snapshot = $this->snapshot($owner, [
            'library' => [
                $this->richCard('library-hidden', 'Hidden Bottom', 'library', [
                    'ownerId' => $owner->id(),
                    'controllerId' => $owner->id(),
                ]),
                [
                    ...$this->richCard('library-visible-2', 'Visible Top Two', 'library', [
                        'ownerId' => $owner->id(),
                        'controllerId' => $owner->id(),
                        'revealedTo' => [$viewer->id()],
                    ]),
                    GameLibraryOps::CARD_VISIBILITY_EPOCH_KEY => 7,
                ],
                [
                    ...$this->richCard('library-visible-1', 'Visible Top One', 'library', [
                        'ownerId' => $owner->id(),
                        'controllerId' => $owner->id(),
                        'revealedTo' => [$viewer->id()],
                    ]),
                    GameLibraryOps::CARD_VISIBILITY_EPOCH_KEY => 7,
                ],
            ],
        ], $viewer);
        $snapshot['players'][$owner->id()][GameLibraryOps::ORIENTATION_KEY] = GameLibraryOps::ORIENTATION_TAIL_TOP;
        $snapshot['players'][$owner->id()][GameLibraryOps::VISIBILITY_EPOCH_KEY] = 7;

        $normalized = $handler->normalizeSnapshot($snapshot);
        $mapper = new CompactGameCardStateMapper();
        $compact = $mapper->compactSnapshot($normalized, 'game-visibility', 'active');
        $roundTrip = $mapper->hydrateSnapshot($compact);
        $viewerProjection = $projection->projectSnapshot($roundTrip, $viewer, false);
        $spectatorProjection = $projection->projectSnapshot($roundTrip, $spectator, false);

        self::assertTrue($compact['visibility']['ready'] ?? false);
        self::assertSame('mask-v1', $compact['visibility']['strategy'] ?? null);
        self::assertSame($compact['visibility'], $roundTrip['visibility']);
        self::assertArrayHasKey('player:owner-id', $compact['visibility']['groups']);
        self::assertArrayHasKey('player:viewer-id', $compact['visibility']['groups']);
        self::assertSame(['library-visible-1', 'library-visible-2'], $compact['visibility']['library'][$owner->id()]['topWindowIds']);
        self::assertGreaterThan(0, $compact['instances']['library-visible-1']['visibleToMask']);
        self::assertSame(0, $compact['instances']['library-hidden']['visibleToMask']);

        self::assertSame('Visible Top One', $viewerProjection['players'][$owner->id()]['zones']['library'][0]['name']);
        self::assertSame('Visible Top Two', $viewerProjection['players'][$owner->id()]['zones']['library'][1]['name']);

        self::assertCount(1, $spectatorProjection['players'][$owner->id()]['zones']['library']);
        self::assertSame('Hidden card', $spectatorProjection['players'][$owner->id()]['zones']['library'][0]['name']);
        self::assertArrayNotHasKey('cardKey', $spectatorProjection['players'][$owner->id()]['zones']['library'][0]);
        self::assertArrayNotHasKey('oracleText', $spectatorProjection['players'][$owner->id()]['zones']['library'][0]);
        self::assertArrayNotHasKey('imageUris', $spectatorProjection['players'][$owner->id()]['zones']['library'][0]);
    }

    public function testInvariantCheckerDetectsLocationDivergence(): void
    {
        $fixture = (new GameplayBaselineFixtureFactory())->create('compact-divergence');
        $game = $fixture->game();
        $mapper = new CompactGameCardStateMapper();
        $checker = new CompactGameStateInvariantChecker();

        $compact = $mapper->compactSnapshot($game->snapshot(), $game->id(), $game->status());
        $compact['loc']['p1-battlefield-001']['zone'] = 'graveyard';

        self::assertNotSame([], array_values(array_filter(
            $checker->check($compact),
            static fn (string $issue): bool => str_contains($issue, 'loc.p1-battlefield-001'),
        )));
    }

    private function user(string $email, string $displayName, string $id): User
    {
        $user = new User($email, $displayName);
        $this->setPrivateProperty($user, 'id', $id);

        return $user;
    }

    /**
     * @param array<string,mixed> $extra
     */
    private function domainCard(string $scryfallId, string $name, array $extra = []): Card
    {
        $card = new Card($scryfallId);
        $card->updateFromScryfall([
            'id' => $scryfallId,
            'name' => $name,
            'type_line' => $extra['type_line'] ?? 'Artifact',
            'mana_cost' => $extra['mana_cost'] ?? '{1}',
            'oracle_text' => $extra['oracle_text'] ?? 'Compact oracle text.',
            'legalities' => ['commander' => 'legal'],
            'image_uris' => $extra['image_uris'] ?? ['normal' => 'https://cards.example/'.$scryfallId.'.jpg'],
            'card_faces' => $extra['card_faces'] ?? [[
                'name' => $name,
                'type_line' => $extra['type_line'] ?? 'Artifact',
                'oracle_text' => $extra['oracle_text'] ?? 'Compact oracle text.',
                'image_uris' => ['normal' => 'https://cards.example/'.$scryfallId.'-face.jpg'],
            ]],
            'color_identity' => $extra['color_identity'] ?? ['G'],
            'power' => $extra['power'] ?? '2',
            'toughness' => $extra['toughness'] ?? '2',
            'layout' => $extra['layout'] ?? 'normal',
            'has_rulings' => $extra['has_rulings'] ?? true,
        ]);

        return $card;
    }

    /**
     * @param array<string,list<array<string,mixed>>> $ownerZones
     *
     * @return array<string,mixed>
     */
    private function snapshot(User $owner, array $ownerZones = [], ?User $opponent = null): array
    {
        $players = [
            $owner->id() => $this->player($owner, $ownerZones),
        ];
        if ($opponent instanceof User) {
            $players[$opponent->id()] = $this->player($opponent, []);
        }

        return [
            'version' => 1,
            'ownerId' => $owner->id(),
            'gamePhase' => 'PLAYING',
            'players' => $players,
            'turn' => ['activePlayerId' => $owner->id(), 'phase' => 'main', 'number' => 1],
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
     * @return array{0: array<string,mixed>, 1: User}
     */
    private function fourPlayerLegacySnapshot(): array
    {
        $players = [];
        $viewer = $this->user('viewer@example.test', 'Viewer', 'p4');
        $playerUsers = [
            'p1' => $this->user('p1@example.test', 'P1', 'p1'),
            'p2' => $this->user('p2@example.test', 'P2', 'p2'),
            'p3' => $this->user('p3@example.test', 'P3', 'p3'),
            'p4' => $viewer,
        ];

        foreach ($playerUsers as $playerId => $user) {
            $zones = [
                'library' => [],
                'hand' => [],
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ];

            for ($index = 1; $index <= 58; $index++) {
                $zones['library'][] = $this->richCard(sprintf('%s-library-%03d', $playerId, $index), sprintf('%s Library %03d', strtoupper($playerId), $index), 'library', [
                    'ownerId' => $playerId,
                    'controllerId' => $playerId,
                ]);
            }
            for ($index = 1; $index <= 7; $index++) {
                $zones['hand'][] = $this->richCard(sprintf('%s-hand-%03d', $playerId, $index), sprintf('%s Hand %03d', strtoupper($playerId), $index), 'hand', [
                    'ownerId' => $playerId,
                    'controllerId' => $playerId,
                ]);
            }
            for ($index = 1; $index <= 20; $index++) {
                $zones['battlefield'][] = $this->richCard(sprintf('%s-battlefield-%03d', $playerId, $index), sprintf('%s Battlefield %03d', strtoupper($playerId), $index), 'battlefield', [
                    'ownerId' => $playerId,
                    'controllerId' => $playerId,
                    'position' => ['x' => round((($index - 1) % 5) * 0.17 + 0.1, 4), 'y' => round((int) floor(($index - 1) / 5) * 0.14 + 0.1, 4), 'unit' => 'ratio'],
                    'tapped' => $index % 4 === 0,
                    'rotation' => $index % 4 === 0 ? 90 : 0,
                    'faceDown' => $index === 6,
                    'counters' => $index === 8 ? ['+1/+1' => 2] : [],
                    'isToken' => $index >= 19,
                    'isTokenCopy' => $index === 20,
                ]);
            }
            for ($index = 1; $index <= 10; $index++) {
                $zones['graveyard'][] = $this->richCard(sprintf('%s-graveyard-%03d', $playerId, $index), sprintf('%s Graveyard %03d', strtoupper($playerId), $index), 'graveyard', [
                    'ownerId' => $playerId,
                    'controllerId' => $playerId,
                ]);
            }
            for ($index = 1; $index <= 3; $index++) {
                $zones['exile'][] = $this->richCard(sprintf('%s-exile-%03d', $playerId, $index), sprintf('%s Exile %03d', strtoupper($playerId), $index), 'exile', [
                    'ownerId' => $playerId,
                    'controllerId' => $playerId,
                ]);
            }
            for ($index = 1; $index <= 2; $index++) {
                $zones['command'][] = $this->richCard(sprintf('%s-command-%03d', $playerId, $index), sprintf('%s Commander %03d', strtoupper($playerId), $index), 'command', [
                    'ownerId' => $playerId,
                    'controllerId' => $playerId,
                    'isCommander' => true,
                    'typeLine' => 'Legendary Creature - Commander',
                ]);
            }

            $zones['hand'][0]['revealedTo'] = ['all'];
            $zones['library'][0]['revealedTo'] = ['all'];

            $players[$playerId] = $this->player($user, $zones);
        }

        return [[
            'version' => 3,
            'ownerId' => 'p1',
            'gamePhase' => 'PLAYING',
            'mulligan' => ['rule' => 'LONDON', 'firstMulliganFree' => true],
            'players' => $players,
            'turn' => ['activePlayerId' => 'p1', 'phase' => 'main-1', 'number' => 4],
            'timer' => ['mode' => 'none', 'status' => 'idle', 'durationSeconds' => null, 'remainingSeconds' => null],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'specialEntities' => [],
            'chat' => [['id' => 'chat-1', 'userId' => 'p1', 'displayName' => 'P1', 'message' => 'hello', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'eventLog' => [['id' => 'log-1', 'type' => 'card.moved', 'message' => 'moved', 'playerId' => 'p1', 'createdAt' => '2026-01-01T00:00:01+00:00']],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:02+00:00',
        ], $viewer];
    }

    /**
     * @param array<string,list<array<string,mixed>>> $zones
     *
     * @return array<string,mixed>
     */
    private function player(User $user, array $zones): array
    {
        return [
            'user' => $user->toArray(),
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
            'backgroundName' => 'G_1',
            'sleevesName' => 'default',
        ];
    }

    /**
     * @param array<string,mixed> $overrides
     *
     * @return array<string,mixed>
     */
    private function richCard(string $instanceId, string $name, string $zone, array $overrides = []): array
    {
        return [
            'instanceId' => $instanceId,
            'ownerId' => $overrides['ownerId'] ?? 'owner-id',
            'controllerId' => $overrides['controllerId'] ?? ($overrides['ownerId'] ?? 'owner-id'),
            'scryfallId' => $overrides['scryfallId'] ?? ('print-'.$instanceId),
            'name' => $name,
            'imageUris' => $overrides['imageUris'] ?? ['normal' => 'https://cards.example/'.$instanceId.'.jpg'],
            'cardFaces' => $overrides['cardFaces'] ?? [[
                'name' => $name,
                'typeLine' => 'Creature - Test',
                'oracleText' => 'Face oracle '.$instanceId,
                'imageUris' => ['normal' => 'https://cards.example/'.$instanceId.'-face.jpg'],
            ]],
            'hasRulings' => $overrides['hasRulings'] ?? true,
            'typeLine' => $overrides['typeLine'] ?? 'Creature - Test',
            'manaCost' => $overrides['manaCost'] ?? '{2}{G}',
            'oracleText' => $overrides['oracleText'] ?? 'Oracle text for '.$instanceId,
            'colorIdentity' => $overrides['colorIdentity'] ?? ['G'],
            'power' => $overrides['power'] ?? 2,
            'toughness' => $overrides['toughness'] ?? 2,
            'loyalty' => $overrides['loyalty'] ?? null,
            'defense' => $overrides['defense'] ?? null,
            'defaultPower' => $overrides['defaultPower'] ?? 2,
            'defaultToughness' => $overrides['defaultToughness'] ?? 2,
            'defaultLoyalty' => $overrides['defaultLoyalty'] ?? null,
            'defaultDefense' => $overrides['defaultDefense'] ?? null,
            'tapped' => $overrides['tapped'] ?? false,
            'faceDown' => $overrides['faceDown'] ?? false,
            'activeFaceIndex' => $overrides['activeFaceIndex'] ?? 0,
            'revealedTo' => $overrides['revealedTo'] ?? [],
            'position' => $overrides['position'] ?? ['x' => 0, 'y' => 0],
            'rotation' => $overrides['rotation'] ?? 0,
            'counters' => $overrides['counters'] ?? [],
            'zone' => $zone,
            'isToken' => $overrides['isToken'] ?? false,
            'isTokenCopy' => $overrides['isTokenCopy'] ?? false,
            'isCommander' => $overrides['isCommander'] ?? ($zone === 'command'),
            'layout' => $overrides['layout'] ?? 'normal',
        ];
    }

    private function setPrivateProperty(object $object, string $property, mixed $value): void
    {
        $reflection = new \ReflectionClass($object);
        $prop = $reflection->getProperty($property);
        $prop->setAccessible(true);
        $prop->setValue($object, $value);
    }
}
