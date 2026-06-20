<?php

namespace App\Tests\Application;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Compact\GameplayCompactRuntimeFlags;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameProjectionService;
use App\Application\Game\GameSnapshotFactory;
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
        self::assertArrayHasKey('cardCatalog', $snapshot);
        self::assertNotEmpty($snapshot['cardCatalog']);

        $commander = $snapshot['players']['owner-id']['zones']['command'][0];
        self::assertArrayHasKey('cardKey', $commander);
        self::assertArrayNotHasKey('name', $commander);
        self::assertArrayNotHasKey('imageUris', $commander);
        self::assertArrayNotHasKey('oracleText', $commander);
        self::assertArrayNotHasKey('cardFaces', $commander);
        self::assertArrayHasKey($commander['cardKey'], $snapshot['cardCatalog']);
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

        self::assertSame('Visible Ring', $ownerProjection['zones']['battlefield'][0]['name']);
        self::assertSame('Visible Commander', $ownerProjection['zones']['command'][0]['name']);

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
        $battlefield = $snapshot['players'][$actor->id()]['zones']['battlefield'];
        self::assertSame(CompactGameCardStateMapper::SNAPSHOT_FORMAT, $snapshot['runtimeFormat'] ?? null);
        self::assertCount(2, $battlefield);
        self::assertSame($battlefield[0]['cardKey'], $battlefield[1]['cardKey']);
        self::assertCount(1, $snapshot['cardCatalog']);
        self::assertArrayNotHasKey('name', $battlefield[0]);
        self::assertArrayNotHasKey('imageUris', $battlefield[0]);
        self::assertArrayNotHasKey('oracleText', $battlefield[1]);
        self::assertArrayNotHasKey('cardFaces', $battlefield[1]);

        $handler->apply($game, 'stack.card_added', [
            'playerId' => $actor->id(),
            'zone' => 'battlefield',
            'instanceId' => 'battlefield-1',
        ], $actor);

        $stackCard = $game->snapshot()['stack'][0]['card'];
        self::assertSame($battlefield[0]['cardKey'], $stackCard['cardKey']);
        self::assertArrayNotHasKey('name', $stackCard);
        self::assertArrayNotHasKey('imageUris', $stackCard);
        self::assertArrayNotHasKey('oracleText', $stackCard);
        self::assertArrayNotHasKey('cardFaces', $stackCard);
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
        $tokens = $snapshot['players'][$actor->id()]['zones']['battlefield'];
        self::assertSame(CompactGameCardStateMapper::SNAPSHOT_FORMAT, $snapshot['runtimeFormat'] ?? null);
        self::assertCount(2, $tokens);
        self::assertSame($tokens[0]['cardKey'], $tokens[1]['cardKey']);
        self::assertCount(1, $snapshot['cardCatalog']);
        self::assertArrayNotHasKey('name', $tokens[0]);
        self::assertArrayNotHasKey('imageUris', $tokens[0]);
        self::assertArrayNotHasKey('oracleText', $tokens[1]);
        self::assertArrayNotHasKey('cardFaces', $tokens[1]);
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
