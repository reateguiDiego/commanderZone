<?php

namespace App\Tests\Integration;

use App\Application\Card\CommanderCandidateSql;
use App\Application\Community\CommunityCardPreviewSql;

final class CommunityCardPreviewQueryTest extends ApiTestCase
{
    public function testRandomPageHydratesDistinctEligibleCardsAndPreservesFilters(): void
    {
        $eligible = [];
        for ($i = 1; $i <= 8; ++$i) {
            $card = $this->seedCard(sprintf('57000000-0000-0000-0000-%012d', $i), 'Preview '.$i, [
                'type_line' => $i % 2 === 0 ? 'Legendary Creature - Wizard' : 'Planeswalker',
                'oracle_text' => $i % 2 === 0 ? '' : 'This card can be your commander.',
                'image_uris' => ['normal' => 'https://example.test/'.$i.'.jpg'],
            ]);
            $eligible[$card->id()] = $card->name();
        }
        $this->seedCard('57000000-0000-0000-0000-000000000009', 'Banned Commander', [
            'type_line' => 'Legendary Creature - Wizard',
            'legalities' => ['commander' => 'banned'],
        ]);
        $this->seedCard('57000000-0000-0000-0000-000000000010', 'Ordinary Artifact', ['type_line' => 'Artifact']);
        $connection = $this->entityManager->getConnection();
        $predicate = CommanderCandidateSql::condition('card');
        $rows = $connection->fetchAllAssociative(CommunityCardPreviewSql::select($predicate, 3));
        self::assertCount(3, $rows);
        self::assertCount(3, array_unique(array_column($rows, 'id')));
        foreach ($rows as $row) {
            self::assertSame($eligible[$row['id']], $row['name']);
            self::assertStringStartsWith('https://example.test/', json_decode($row['image_uris'], true, 512, JSON_THROW_ON_ERROR)['normal']);
        }
        self::assertCount(8, $connection->fetchAllAssociative(CommunityCardPreviewSql::select($predicate, 100)));
        $filtered = CommunityCardPreviewSql::select($predicate.' AND card.name = :name', 3);
        self::assertSame(['Preview 1'], array_column($connection->fetchAllAssociative($filtered, ['name' => 'Preview 1']), 'name'));
        self::assertSame([], $connection->fetchAllAssociative($filtered, ['name' => "' OR true --"]));
    }
}
