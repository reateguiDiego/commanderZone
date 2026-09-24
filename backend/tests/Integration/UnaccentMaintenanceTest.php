<?php

declare(strict_types=1);

namespace App\Tests\Integration;

use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

final class UnaccentMaintenanceTest extends KernelTestCase
{
    public function testNormalizationAndExpressionIndexMaintenanceWithRestrictedSearchPath(): void
    {
        self::bootKernel();
        $connection = static::getContainer()->get(Connection::class);
        $connection->beginTransaction();

        try {
            $connection->executeStatement('SET LOCAL search_path = pg_catalog');
            foreach (['Crème brûlée' => 'Creme brulee', 'Æther' => 'AEther', 'canción' => 'cancion', 'ASCII' => 'ASCII', '' => ''] as $input => $expected) {
                self::assertSame($expected, $connection->fetchOne('SELECT public.immutable_unaccent(?)', [$input]));
            }
            self::assertNull($connection->fetchOne('SELECT public.immutable_unaccent(NULL::text)'));

            $connection->executeStatement('CREATE TEMP TABLE cz_unaccent_test (name text) ON COMMIT DROP');
            $connection->executeStatement("INSERT INTO pg_temp.cz_unaccent_test VALUES ('canción'), ('Æther'), (NULL)");
            $connection->executeStatement('CREATE INDEX cz_unaccent_test_idx ON pg_temp.cz_unaccent_test (public.immutable_unaccent(name))');
            $connection->executeStatement('ANALYZE pg_temp.cz_unaccent_test');
            self::assertSame(1, (int) $connection->fetchOne("SELECT count(*) FROM pg_temp.cz_unaccent_test WHERE public.immutable_unaccent(name) = 'cancion'"));
        } finally {
            $connection->rollBack();
            self::ensureKernelShutdown();
        }
    }
}
