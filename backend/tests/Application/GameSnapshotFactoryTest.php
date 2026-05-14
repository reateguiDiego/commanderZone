<?php

namespace App\Tests\Application;

use App\Application\Game\GameSnapshotFactory;
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

    private function setPrivateProperty(object $object, string $property, mixed $value): void
    {
        $reflection = new \ReflectionClass($object);
        $prop = $reflection->getProperty($property);
        $prop->setAccessible(true);
        $prop->setValue($object, $value);
    }
}

