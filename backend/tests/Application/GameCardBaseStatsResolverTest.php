<?php

namespace App\Tests\Application;

use App\Application\Game\GameCardBaseStatsResolver;
use App\Domain\Card\Card;
use Doctrine\ORM\EntityRepository;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\TestCase;

class GameCardBaseStatsResolverTest extends TestCase
{
    public function testEntityResolutionUsesFaceStatsRootBeforeLegacyAndFaces(): void
    {
        $card = new Card('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        $card->updateFromScryfall([
            'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'name' => 'Resolver Walker',
            'type_line' => 'Legendary Planeswalker - Test',
            'oracle_text' => 'Test text',
            'legalities' => ['commander' => 'legal'],
            'card_faces' => [
                ['name' => 'Face', 'loyalty' => '2'],
            ],
        ]);

        $this->setPrivateProperty($card, 'loyalty', null);
        $this->setPrivateProperty($card, 'faceStats', [
            'root' => [
                'power' => null,
                'toughness' => null,
                'loyalty' => '5',
                'defense' => null,
                'handModifier' => null,
                'lifeModifier' => null,
            ],
            'faces' => [
                [
                    'name' => 'Face',
                    'power' => null,
                    'toughness' => null,
                    'loyalty' => '4',
                    'defense' => null,
                    'handModifier' => null,
                    'lifeModifier' => null,
                ],
            ],
        ]);

        $repo = $this->createMock(EntityRepository::class);
        $repo->expects(self::once())
            ->method('findOneBy')
            ->with(['scryfallId' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
            ->willReturn($card);

        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->expects(self::once())
            ->method('getRepository')
            ->with(Card::class)
            ->willReturn($repo);

        $resolver = new GameCardBaseStatsResolver($entityManager);
        $baseLoyalty = $resolver->baseLoyalty([
            'scryfallId' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ]);

        self::assertSame(5, $baseLoyalty);
    }

    public function testEntityResolutionUsesFaceStatsRootDefenseBeforeFaces(): void
    {
        $card = new Card('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
        $card->updateFromScryfall([
            'id' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'name' => 'Resolver Battle',
            'type_line' => 'Battle - Siege',
            'oracle_text' => 'Test text',
            'legalities' => ['commander' => 'legal'],
            'card_faces' => [
                ['name' => 'Face', 'defense' => '2'],
            ],
        ]);

        $this->setPrivateProperty($card, 'faceStats', [
            'root' => [
                'power' => null,
                'toughness' => null,
                'loyalty' => null,
                'defense' => '6',
                'handModifier' => null,
                'lifeModifier' => null,
            ],
            'faces' => [
                [
                    'name' => 'Face',
                    'power' => null,
                    'toughness' => null,
                    'loyalty' => null,
                    'defense' => '5',
                    'handModifier' => null,
                    'lifeModifier' => null,
                ],
            ],
        ]);

        $repo = $this->createMock(EntityRepository::class);
        $repo->expects(self::once())
            ->method('findOneBy')
            ->with(['scryfallId' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])
            ->willReturn($card);

        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->expects(self::once())
            ->method('getRepository')
            ->with(Card::class)
            ->willReturn($repo);

        $resolver = new GameCardBaseStatsResolver($entityManager);
        $baseDefense = $resolver->baseDefense([
            'scryfallId' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ]);

        self::assertSame(6, $baseDefense);
    }

    public function testEntityResolutionKeepsPrintedPowerAndToughness(): void
    {
        $card = new Card('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
        $card->updateFromScryfall([
            'id' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'name' => 'Resolver Variable Creature',
            'type_line' => 'Creature - Test',
            'oracle_text' => 'Test text',
            'legalities' => ['commander' => 'legal'],
            'power' => 'X',
            'toughness' => '*+1',
        ]);

        $repo = $this->createMock(EntityRepository::class);
        $repo->expects(self::once())
            ->method('findOneBy')
            ->with(['scryfallId' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'])
            ->willReturn($card);

        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager->expects(self::once())
            ->method('getRepository')
            ->with(Card::class)
            ->willReturn($repo);

        $resolver = new GameCardBaseStatsResolver($entityManager);
        $baseStats = $resolver->baseStats([
            'scryfallId' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ]);

        self::assertSame(['power' => 'X', 'toughness' => '*+1'], $baseStats);
    }

    public function testSnapshotCardResolutionKeepsPrintedLoyaltyAndDefense(): void
    {
        $resolver = new GameCardBaseStatsResolver();

        self::assertSame('X', $resolver->baseLoyalty([
            'loyalty' => 'X',
        ]));
        self::assertSame('X+1', $resolver->baseDefense([
            'defense' => 'X+1',
        ]));
    }

    public function testSnapshotCardResolutionKeepsPrintedPowerAndToughnessFromFaces(): void
    {
        $resolver = new GameCardBaseStatsResolver();

        $baseStats = $resolver->baseStats([
            'cardFaces' => [
                ['power' => null, 'toughness' => null],
                ['power' => '*', 'toughness' => 'X+2'],
            ],
        ]);

        self::assertSame(['power' => '*', 'toughness' => 'X+2'], $baseStats);
    }

    public function testSnapshotCardResolutionUsesFaceStatsFacesThenLegacyThenCardFaces(): void
    {
        $resolver = new GameCardBaseStatsResolver();

        $fromFaceStatsFace = $resolver->baseLoyalty([
            'faceStats' => [
                'root' => ['loyalty' => null],
                'faces' => [['loyalty' => '7']],
            ],
            'loyalty' => '3',
            'cardFaces' => [['loyalty' => '2']],
        ]);
        self::assertSame(7, $fromFaceStatsFace);

        $fromLegacy = $resolver->baseLoyalty([
            'faceStats' => [
                'root' => ['loyalty' => null],
                'faces' => [],
            ],
            'loyalty' => '3',
            'cardFaces' => [['loyalty' => '2']],
        ]);
        self::assertSame(3, $fromLegacy);

        $fromCardFaces = $resolver->baseLoyalty([
            'faceStats' => [
                'root' => ['loyalty' => null],
                'faces' => [],
            ],
            'cardFaces' => [['loyalty' => '2']],
        ]);
        self::assertSame(2, $fromCardFaces);
    }

    public function testSnapshotCardResolutionUsesFaceStatsFacesThenLegacyThenCardFacesForDefense(): void
    {
        $resolver = new GameCardBaseStatsResolver();

        $fromFaceStatsFace = $resolver->baseDefense([
            'faceStats' => [
                'root' => ['defense' => null],
                'faces' => [['defense' => '7']],
            ],
            'defense' => '3',
            'cardFaces' => [['defense' => '2']],
        ]);
        self::assertSame(7, $fromFaceStatsFace);

        $fromLegacy = $resolver->baseDefense([
            'faceStats' => [
                'root' => ['defense' => null],
                'faces' => [],
            ],
            'defense' => '3',
            'cardFaces' => [['defense' => '2']],
        ]);
        self::assertSame(3, $fromLegacy);

        $fromCardFaces = $resolver->baseDefense([
            'faceStats' => [
                'root' => ['defense' => null],
                'faces' => [],
            ],
            'cardFaces' => [['defense' => '2']],
        ]);
        self::assertSame(2, $fromCardFaces);
    }

    private function setPrivateProperty(object $object, string $property, mixed $value): void
    {
        $reflection = new \ReflectionClass($object);
        $prop = $reflection->getProperty($property);
        $prop->setAccessible(true);
        $prop->setValue($object, $value);
    }
}
