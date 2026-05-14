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

    private function setPrivateProperty(object $object, string $property, mixed $value): void
    {
        $reflection = new \ReflectionClass($object);
        $prop = $reflection->getProperty($property);
        $prop->setAccessible(true);
        $prop->setValue($object, $value);
    }
}
