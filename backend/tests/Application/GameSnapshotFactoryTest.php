<?php

namespace App\Tests\Application;

use App\Application\Game\GameSnapshotFactory;
use App\Application\Game\GameplayStreamsFlags;
use App\Application\Game\GameRandomizer;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameSnapshotFactoryTest extends TestCase
{
    public function testOmitsChatAndEventLogFromInitialSnapshotWhenStreamsEnabled(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $this->setPrivateProperty($owner, 'id', 'owner-id');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner, new Deck($owner, 'Deck')));

        $snapshot = (new GameSnapshotFactory(
            streamFlags: new GameplayStreamsFlags(true),
        ))->fromRoom($room);

        self::assertArrayNotHasKey('chat', $snapshot);
        self::assertArrayNotHasKey('eventLog', $snapshot);
    }

    public function testUsesFaceStatsRootLoyaltyWhenLegacyIsNull(): void
    {
        $snapshot = $this->snapshotWithCommander($this->cardWithLoyaltySources(
            legacyLoyalty: null,
            faceStats: $this->faceStats(rootLoyalty: '4'),
            cardFaces: [['name' => 'Commander Face', 'loyalty' => '2']],
        ));

        $commander = $snapshot['players']['owner-id']['zones']['command'][0];
        self::assertSame(4, $commander['loyalty']);
        self::assertSame(4, $commander['defaultLoyalty']);
    }

    public function testUsesFaceStatsFacesLoyaltyWhenRootIsNull(): void
    {
        $snapshot = $this->snapshotWithCommander($this->cardWithLoyaltySources(
            legacyLoyalty: null,
            faceStats: $this->faceStats(rootLoyalty: null, faces: [
                ['name' => 'Front', 'loyalty' => null],
                ['name' => 'Back', 'loyalty' => '6'],
            ]),
            cardFaces: [['name' => 'Fallback Face', 'loyalty' => '2']],
        ));

        $commander = $snapshot['players']['owner-id']['zones']['command'][0];
        self::assertSame(6, $commander['loyalty']);
        self::assertSame(6, $commander['defaultLoyalty']);
    }

    public function testKeepsLegacyLoyaltyWhenFaceStatsHasNoLoyalty(): void
    {
        $snapshot = $this->snapshotWithCommander($this->cardWithLoyaltySources(
            legacyLoyalty: '3',
            faceStats: $this->faceStats(rootLoyalty: null),
            cardFaces: [['name' => 'Fallback Face', 'loyalty' => '2']],
        ));

        $commander = $snapshot['players']['owner-id']['zones']['command'][0];
        self::assertSame(3, $commander['loyalty']);
        self::assertSame(3, $commander['defaultLoyalty']);
    }

    public function testUsesFaceStatsRootDefenseWhenLegacyIsNull(): void
    {
        $snapshot = $this->snapshotWithCommander($this->cardWithDefenseSources(
            faceStats: $this->faceStats(rootLoyalty: null, rootDefense: '7'),
            cardFaces: [['name' => 'Front Face', 'defense' => '4']],
        ));

        $commander = $snapshot['players']['owner-id']['zones']['command'][0];
        self::assertSame(7, $commander['defense']);
        self::assertSame(7, $commander['defaultDefense']);
    }

    public function testKeepsPrintedLoyaltyAndDefenseInInitialSnapshot(): void
    {
        $snapshot = $this->snapshotWithCommander($this->cardWithLoyaltySources(
            legacyLoyalty: 'X',
            faceStats: $this->faceStats(rootLoyalty: null, rootDefense: 'X+1'),
            cardFaces: [],
        ));

        $commander = $snapshot['players']['owner-id']['zones']['command'][0];
        self::assertSame(0, $commander['loyalty']);
        self::assertSame('X', $commander['defaultLoyalty']);
        self::assertSame(0, $commander['defense']);
        self::assertSame('X+1', $commander['defaultDefense']);
    }

    public function testKeepsPrintedPowerAndToughnessInInitialSnapshot(): void
    {
        $snapshot = $this->snapshotWithCommander($this->cardWithPrintedPowerToughness('X', '*+1'));

        $commander = $snapshot['players']['owner-id']['zones']['command'][0];
        self::assertSame(0, $commander['power']);
        self::assertSame(0, $commander['toughness']);
        self::assertSame('X', $commander['defaultPower']);
        self::assertSame('*+1', $commander['defaultToughness']);
    }

    public function testPicksTemporaryPlayMatFromCommanderColorIdentity(): void
    {
        $snapshot = $this->snapshotWithCommander($this->cardWithColorIdentity(['G']));

        self::assertMatchesRegularExpression(
            '/^G_\d+$/',
            $snapshot['players']['owner-id']['backgroundName'],
        );
    }

    public function testPicksTemporaryColorlessPlayMatWhenCommanderIsColorless(): void
    {
        $snapshot = $this->snapshotWithCommander($this->cardWithColorIdentity([]));

        self::assertMatchesRegularExpression(
            '/^C_\d+$/',
            $snapshot['players']['owner-id']['backgroundName'],
        );
    }

    public function testPicksTemporaryPlayMatFromOneOfTheCommanderColors(): void
    {
        $snapshot = $this->snapshotWithCommander($this->cardWithColorIdentity(['B', 'G']));

        self::assertMatchesRegularExpression(
            '/^(B|G)_\d+$/',
            $snapshot['players']['owner-id']['backgroundName'],
        );
    }

    public function testTemporaryPlayMatsDoNotRepeatInsideSameRoom(): void
    {
        $snapshot = $this->snapshotWithTwoCommanders(
            $this->cardWithColorIdentity(['G']),
            $this->cardWithColorIdentity(['G']),
        );
        $backgroundNames = array_map(
            static fn (array $player): string => $player['backgroundName'],
            $snapshot['players'],
        );

        self::assertCount(2, array_unique($backgroundNames));
    }

    public function testInitialCommanderDamageIsKeyedByEachCommanderInstance(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $opponent = new User('opponent@example.test', 'Opponent');
        $this->setPrivateProperty($owner, 'id', 'owner-id');
        $this->setPrivateProperty($opponent, 'id', 'opponent-id');
        $room = new Room($owner);

        $ownerDeck = new Deck($owner, 'Owner Deck');
        $ownerDeck->addCard(new DeckCard($ownerDeck, $this->cardWithColorIdentity(['R']), 1, DeckCard::SECTION_COMMANDER));
        $ownerDeck->addCard(new DeckCard($ownerDeck, $this->cardWithColorIdentity(['B']), 1, DeckCard::SECTION_COMMANDER));
        $opponentDeck = new Deck($opponent, 'Opponent Deck');
        $opponentDeck->addCard(new DeckCard($opponentDeck, $this->cardWithColorIdentity(['G']), 1, DeckCard::SECTION_COMMANDER));

        $room->addPlayer(new RoomPlayer($room, $owner, $ownerDeck));
        $room->addPlayer(new RoomPlayer($room, $opponent, $opponentDeck));

        $snapshot = (new GameSnapshotFactory())->fromRoom($room);
        $ownerCommanderIds = array_map(
            static fn (array $commander): string => $commander['instanceId'],
            $snapshot['players']['owner-id']['zones']['command'],
        );

        self::assertCount(2, $ownerCommanderIds);
        self::assertSame([
            $ownerCommanderIds[0] => 0,
            $ownerCommanderIds[1] => 0,
        ], $snapshot['players']['opponent-id']['commanderDamage']);
    }

    public function testBuildsOpeningHandFromShuffledLibraryWithSevenCards(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $this->setPrivateProperty($owner, 'id', 'owner-id');

        $room = new Room($owner);
        $deck = new Deck($owner, 'Deck');
        $commander = $this->cardWithColorIdentity(['G']);
        $deck->addCard(new DeckCard($deck, $commander, 1, DeckCard::SECTION_COMMANDER));
        for ($index = 1; $index <= 9; ++$index) {
            $card = new Card(sprintf('11111111-1111-4111-8111-%012d', $index));
            $card->updateFromScryfall([
                'id' => sprintf('11111111-1111-4111-8111-%012d', $index),
                'name' => sprintf('Library Card %d', $index),
                'type_line' => 'Artifact',
                'oracle_text' => 'Test text',
                'legalities' => ['commander' => 'legal'],
                'image_uris' => ['normal' => sprintf('https://cards.scryfall.io/normal/front/library-%d.jpg', $index)],
            ]);
            $deck->addCard(new DeckCard($deck, $card, 1, DeckCard::SECTION_MAIN));
        }

        $room->addPlayer(new RoomPlayer($room, $owner, $deck));

        $snapshot = (new GameSnapshotFactory(new class() extends GameRandomizer {
            public function shuffle(array $items): array
            {
                return array_reverse($items);
            }
        }))->fromRoom($room);

        self::assertSame('MULLIGAN', $snapshot['gamePhase']);
        self::assertSame(Room::MULLIGAN_LONDON, $snapshot['mulligan']['rule']);
        self::assertCount(7, $snapshot['players']['owner-id']['zones']['hand']);
        self::assertCount(2, $snapshot['players']['owner-id']['zones']['library']);
        self::assertSame(
            ['Library Card 9', 'Library Card 8', 'Library Card 7', 'Library Card 6', 'Library Card 5', 'Library Card 4', 'Library Card 3'],
            array_map(static fn (array $card): string => $card['name'], $snapshot['players']['owner-id']['zones']['hand']),
        );
    }

    public function testBuildsGenerousOpeningHandWithTenCards(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $this->setPrivateProperty($owner, 'id', 'owner-id');

        $room = new Room($owner);
        $room->setMulliganRule(Room::MULLIGAN_GENEROUS);
        $deck = new Deck($owner, 'Deck');
        $deck->addCard(new DeckCard($deck, $this->cardWithColorIdentity(['G']), 1, DeckCard::SECTION_COMMANDER));
        for ($index = 1; $index <= 12; ++$index) {
            $card = new Card(sprintf('22222222-2222-4222-8222-%012d', $index));
            $card->updateFromScryfall([
                'id' => sprintf('22222222-2222-4222-8222-%012d', $index),
                'name' => sprintf('Generous Card %d', $index),
                'type_line' => 'Artifact',
                'oracle_text' => 'Test text',
                'legalities' => ['commander' => 'legal'],
            ]);
            $deck->addCard(new DeckCard($deck, $card, 1, DeckCard::SECTION_MAIN));
        }

        $room->addPlayer(new RoomPlayer($room, $owner, $deck));

        $snapshot = (new GameSnapshotFactory(new class() extends GameRandomizer {
            public function shuffle(array $items): array
            {
                return $items;
            }
        }))->fromRoom($room);

        self::assertSame('MULLIGAN', $snapshot['gamePhase']);
        self::assertSame(Room::MULLIGAN_GENEROUS, $snapshot['mulligan']['rule']);
        self::assertCount(10, $snapshot['players']['owner-id']['zones']['hand']);
        self::assertSame(3, $snapshot['players']['owner-id']['mulligan']['bottomSelectionCount']);
        self::assertSame(7, $snapshot['players']['owner-id']['mulligan']['finalHandSize']);
    }

    public function testIncludesPersistedRulingsMetadataInGameCardSnapshots(): void
    {
        $card = $this->cardWithColorIdentity(['G']);
        $this->setPrivateProperty($card, 'hasRulings', true);

        $snapshot = $this->snapshotWithCommander($card);

        self::assertTrue($snapshot['players']['owner-id']['zones']['command'][0]['hasRulings']);
    }

    /**
     * @param array<string,mixed> $faceStats
     * @param list<array<string,mixed>> $cardFaces
     */
    private function cardWithLoyaltySources(?string $legacyLoyalty, array $faceStats, array $cardFaces): Card
    {
        $card = new Card('11111111-1111-4111-8111-111111111111');
        $card->updateFromScryfall([
            'id' => '11111111-1111-4111-8111-111111111111',
            'name' => 'FaceStats Commander',
            'type_line' => 'Legendary Planeswalker - Test',
            'oracle_text' => 'Test text',
            'legalities' => ['commander' => 'legal'],
            'card_faces' => $cardFaces,
            'layout' => 'transform',
        ]);

        $this->setPrivateProperty($card, 'loyalty', $legacyLoyalty);
        $this->setPrivateProperty($card, 'faceStats', $faceStats);

        return $card;
    }

    /**
     * @param array<string,mixed> $faceStats
     * @param list<array<string,mixed>> $cardFaces
     */
    private function cardWithDefenseSources(array $faceStats, array $cardFaces): Card
    {
        $card = new Card('22222222-2222-4222-8222-222222222222');
        $card->updateFromScryfall([
            'id' => '22222222-2222-4222-8222-222222222222',
            'name' => 'FaceStats Battle',
            'type_line' => 'Battle - Siege',
            'oracle_text' => 'Test text',
            'legalities' => ['commander' => 'legal'],
            'card_faces' => $cardFaces,
            'layout' => 'transform',
        ]);

        $this->setPrivateProperty($card, 'faceStats', $faceStats);

        return $card;
    }

    /**
     * @param list<string> $colorIdentity
     */
    private function cardWithColorIdentity(array $colorIdentity): Card
    {
        $card = new Card('11111111-1111-4111-8111-111111111111');
        $card->updateFromScryfall([
            'id' => '11111111-1111-4111-8111-111111111111',
            'name' => 'Playmat Commander',
            'type_line' => 'Legendary Creature - Test',
            'oracle_text' => 'Test text',
            'legalities' => ['commander' => 'legal'],
            'color_identity' => $colorIdentity,
        ]);

        return $card;
    }

    private function cardWithPrintedPowerToughness(string $power, string $toughness): Card
    {
        $card = new Card('44444444-4444-4444-8444-444444444444');
        $card->updateFromScryfall([
            'id' => '44444444-4444-4444-8444-444444444444',
            'name' => 'Printed Stats Commander',
            'type_line' => 'Legendary Creature - Test',
            'oracle_text' => 'Test text',
            'legalities' => ['commander' => 'legal'],
            'power' => $power,
            'toughness' => $toughness,
            'color_identity' => ['G'],
        ]);

        return $card;
    }

    /**
     * @param list<array{name:?string,loyalty:?string,defense:?string}> $faces
     *
     * @return array{root:array{power:?string,toughness:?string,loyalty:?string,defense:?string,handModifier:?string,lifeModifier:?string},faces:list<array{name:?string,power:?string,toughness:?string,loyalty:?string,defense:?string,handModifier:?string,lifeModifier:?string}>}
     */
    private function faceStats(?string $rootLoyalty, ?string $rootDefense = null, array $faces = []): array
    {
        $normalizedFaces = [];
        foreach ($faces as $face) {
            $normalizedFaces[] = [
                'name' => $face['name'] ?? null,
                'power' => null,
                'toughness' => null,
                'loyalty' => $face['loyalty'] ?? null,
                'defense' => $face['defense'] ?? null,
                'handModifier' => null,
                'lifeModifier' => null,
            ];
        }

        return [
            'root' => [
                'power' => null,
                'toughness' => null,
                'loyalty' => $rootLoyalty,
                'defense' => $rootDefense,
                'handModifier' => null,
                'lifeModifier' => null,
            ],
            'faces' => $normalizedFaces,
        ];
    }

    private function snapshotWithCommander(Card $commander): array
    {
        $owner = new User('owner@example.test', 'Owner');
        $this->setPrivateProperty($owner, 'id', 'owner-id');

        $room = new Room($owner);
        $deck = new Deck($owner, 'Deck');
        $deck->addCard(new DeckCard($deck, $commander, 1, DeckCard::SECTION_COMMANDER));

        $room->addPlayer(new RoomPlayer($room, $owner, $deck));

        return (new GameSnapshotFactory())->fromRoom($room);
    }

    private function snapshotWithTwoCommanders(Card $firstCommander, Card $secondCommander): array
    {
        $owner = new User('owner@example.test', 'Owner');
        $guest = new User('guest@example.test', 'Guest');
        $this->setPrivateProperty($owner, 'id', 'owner-id');
        $this->setPrivateProperty($guest, 'id', 'guest-id');

        $room = new Room($owner);
        $firstDeck = new Deck($owner, 'First Deck');
        $firstDeck->addCard(new DeckCard($firstDeck, $firstCommander, 1, DeckCard::SECTION_COMMANDER));
        $secondDeck = new Deck($guest, 'Second Deck');
        $secondDeck->addCard(new DeckCard($secondDeck, $secondCommander, 1, DeckCard::SECTION_COMMANDER));

        $room->addPlayer(new RoomPlayer($room, $owner, $firstDeck));
        $room->addPlayer(new RoomPlayer($room, $guest, $secondDeck));

        return (new GameSnapshotFactory())->fromRoom($room);
    }

    private function setPrivateProperty(object $object, string $property, mixed $value): void
    {
        $reflection = new \ReflectionClass($object);
        $prop = $reflection->getProperty($property);
        $prop->setAccessible(true);
        $prop->setValue($object, $value);
    }
}

