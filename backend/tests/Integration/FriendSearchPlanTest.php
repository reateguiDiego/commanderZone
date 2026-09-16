<?php

namespace App\Tests\Integration;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

final class FriendSearchPlanTest extends KernelTestCase
{
    public function testLeadingWildcardCanUseTrigramIndex(): void
    {
        self::bootKernel();
        $db = static::getContainer()->get('doctrine')->getConnection();
        $db->executeStatement('CREATE TEMP TABLE friend_search_plan (id text, display_name text)');
        try {
            $db->executeStatement("INSERT INTO friend_search_plan SELECT n::text, 'Player ' || md5(n::text) FROM generate_series(1, 100000) n");
            $db->executeStatement('CREATE INDEX idx_friend_search_plan_trgm ON friend_search_plan USING GIN (LOWER(display_name) gin_trgm_ops)');
            $db->executeStatement('ANALYZE friend_search_plan');
            $plans = [];
            foreach (['%ab%', '%player%', '%abc123%', '%zznomatchzz%'] as $term) {
                $plans[$term] = json_decode($db->fetchOne('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, display_name FROM friend_search_plan WHERE LOWER(display_name) LIKE ? ORDER BY display_name LIMIT 8', [$term]), true, flags: JSON_THROW_ON_ERROR);
            }
            self::assertStringContainsString('idx_friend_search_plan_trgm', json_encode($plans['%abc123%']));
            self::assertStringContainsString('idx_friend_search_plan_trgm', json_encode($plans['%zznomatchzz%']));
            if ($path = getenv('FRIEND_SEARCH_EXPLAIN_OUTPUT')) file_put_contents($path, json_encode($plans, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        } finally {
            $db->executeStatement('DROP TABLE pg_temp.friend_search_plan');
        }
    }
}
