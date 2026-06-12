<?php

namespace App\Tests\Application;

use App\Application\Game\GameSnapshotFactory;
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

        self::assertCount(7, $snapshot['players']['owner-id']['zones']['hand']);
        self::assertCount(2, $snapshot['players']['owner-id']['zones']['library']);
        self::assertSame(
            ['Library Card 9', 'Library Card 8', 'Library Card 7', 'Library Card 6', 'Library Card 5', 'Library Card 4', 'Library Card 3'],
            array_map(static fn (array $card): string => $card['name'], $snapshot['players']['owner-id']['zones']['hand']),
        );
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

    /**
     * @param list<array{name:?string,loyalty:?string}> $faces
     *
     * @return array{root:array{power:?string,toughness:?string,loyalty:?string,defense:?string,handModifier:?string,lifeModifier:?string},faces:list<array{name:?string,power:?string,toughness:?string,loyalty:?string,defense:?string,handModifier:?string,lifeModifier:?string}>}
     */
    private function faceStats(?string $rootLoyalty, array $faces = []): array
    {
        $normalizedFaces = [];
        foreach ($faces as $face) {
            $normalizedFaces[] = [
                'name' => $face['name'] ?? null,
                'power' => null,
                'toughness' => null,
                'loyalty' => $face['loyalty'] ?? null,
                'defense' => null,
                'handModifier' => null,
                'lifeModifier' => null,
            ];
        }

        return [
            'root' => [
                'power' => null,
                'toughness' => null,
                'loyalty' => $rootLoyalty,
                'defense' => null,
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

