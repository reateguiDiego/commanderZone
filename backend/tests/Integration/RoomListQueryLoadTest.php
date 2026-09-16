<?php

namespace App\Tests\Integration;

use App\Application\Room\RoomListQuery;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/** Real PostgreSQL plans, isolated in session-local tables; no persistent fixture changes. */
final class RoomListQueryLoadTest extends KernelTestCase
{
    public function testHistoricalGrowthDoesNotIncreasePageWorkLinearly(): void
    {
        self::bootKernel();
        $db = static::getContainer()->get('doctrine')->getConnection();
        $db->executeStatement('CREATE TEMP TABLE room (LIKE public.room INCLUDING DEFAULTS)');
        $db->executeStatement('CREATE TEMP TABLE room_player (room_id varchar(36), user_id varchar(36), PRIMARY KEY (room_id, user_id))');
        $db->executeStatement('CREATE INDEX ON room_player (user_id)');
        $db->executeStatement('CREATE TEMP TABLE game (id varchar(36) PRIMARY KEY, status varchar(40))');
        $db->executeStatement('CREATE UNIQUE INDEX ON room (id)');
        $db->executeStatement('CREATE INDEX ON room (owner_id)');
        $query = new RoomListQuery($db);
        $insert = static function (int $from, int $to) use ($db): void {
            $db->executeStatement("INSERT INTO room (id, owner_id, status, visibility, name, format, max_players, starting_life,
                timer_mode, timer_duration_seconds, mulligan_rule, first_mulligan_free, created_at, updated_at, game_id)
                SELECT md5(n::text)::uuid::text, CASE WHEN n <= 1000 THEN 'viewer' ELSE 'historical-host' END,
                    CASE WHEN n <= 1000 THEN 'waiting' WHEN n % 5 = 0 THEN 'started' ELSE 'archived' END,
                    CASE WHEN n % 3 = 0 THEN 'private' ELSE 'public' END, 'Table ' || lpad(n::text, 8, '0'),
                    'commander', 4, 40, 'none', 300, 'LONDON', true, NOW(), NOW(),
                    CASE WHEN n > 1000 AND n % 5 = 0 THEN md5(('game-' || n)::text)::uuid::text ELSE NULL END
                FROM generate_series($from, $to) n");
            $db->executeStatement("INSERT INTO game SELECT md5(('game-' || n)::text)::uuid::text, 'finished' FROM generate_series($from, $to) n WHERE n > 1000 AND n % 5 = 0");
        };
        try {
            $insert(1, 101000);
            $db->executeStatement("INSERT INTO room_player SELECT md5(n::text)::uuid::text, 'player-' || p FROM generate_series(1,1000) n CROSS JOIN generate_series(1,4) p WHERE n % 2 = 0 OR p <= 2");
            $db->executeStatement('ANALYZE room');
            $db->executeStatement('ANALYZE room_player');
            $db->executeStatement('ANALYZE game');
            $explain = static function (string $status) use ($db, $query): array {
                return json_decode($db->fetchOne('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '.$query->pageSql($status), $status === 'all' ? ['viewer' => 'viewer'] : []), true, 512, JSON_THROW_ON_ERROR)[0];
            };
            $report = ['fixture' => '1000 waiting rooms, 3000 players, historical rooms 80% archived / 20% unrelated started'];
            $report['beforeIndex'] = $explain('active');
            $db->executeStatement("CREATE INDEX idx_room_list_waiting ON room (visibility, name COLLATE \"C\", id) WHERE status = 'waiting' AND game_id IS NULL");
            $db->executeStatement('ANALYZE room');
            foreach (['active', 'all'] as $status) $report['100000'][$status] = $explain($status);
            $insert(101001, 1001000);
            $db->executeStatement('ANALYZE room');
            $db->executeStatement('ANALYZE game');
            foreach (['active', 'all'] as $status) $report['1000000'][$status] = $explain($status);
            $blocks = static fn (array $plan): int => (int) ($plan['Plan']['Shared Hit Blocks'] ?? 0) + (int) ($plan['Plan']['Shared Read Blocks'] ?? 0)
                + (int) ($plan['Plan']['Local Hit Blocks'] ?? 0) + (int) ($plan['Plan']['Local Read Blocks'] ?? 0);
            if ($path = getenv('ROOM_LIST_EXPLAIN_OUTPUT')) file_put_contents($path, json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
            self::assertStringContainsString('idx_room_list_waiting', json_encode($report['100000']['active']));
            self::assertLessThan($blocks($report['beforeIndex']), $blocks($report['100000']['active']));
            foreach (['active', 'all'] as $status) {
                self::assertSame(51, $report['1000000'][$status]['Plan']['Actual Rows']);
                self::assertLessThan($blocks($report['100000'][$status]) * 3, $blocks($report['1000000'][$status]), '10x history must not produce linear buffer work: '.$status);
            }
        } finally {
            $db->executeStatement('DROP TABLE pg_temp.room_player, pg_temp.room, pg_temp.game');
        }
    }
}
