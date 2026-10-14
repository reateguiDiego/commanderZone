<?php

namespace App\Tests\Integration;

use Doctrine\DBAL\Schema\Schema;
use DoctrineMigrations\Version20261014143000;
use Psr\Log\NullLogger;

final class LocaleMaintenanceMigrationTest extends ApiTestCase
{
    public function testThresholdsApplyAndRollbackWithoutChangingCatalogOrOtherOptions(): void
    {
        require_once dirname(__DIR__, 2).'/migrations/Version20261014143000.php';
        $connection = $this->entityManager->getConnection();
        $this->seedCard('maintenance-fixture', 'Maintenance Fixture');
        $before = $connection->fetchAllAssociative('SELECT * FROM card_print_locale ORDER BY print_scryfall_id, lang');
        $connection->beginTransaction();
        try {
            $connection->executeStatement('ALTER TABLE card_print_locale SET (fillfactor = 95)');
            foreach (['up', 'down'] as $direction) {
                $migration = new Version20261014143000($connection, new NullLogger());
                $migration->$direction(new Schema());
                foreach ($migration->getSql() as $query) {
                    $connection->executeStatement($query->getStatement(), $query->getParameters(), $query->getTypes());
                }
                $options = $connection->fetchAllKeyValue("SELECT option_name, option_value FROM pg_options_to_table((SELECT reloptions FROM pg_class WHERE oid = 'card_print_locale'::regclass))");
                self::assertSame('95', $options['fillfactor']);
                foreach (['autovacuum_vacuum_scale_factor' => 0.01, 'autovacuum_vacuum_threshold' => 500,
                    'autovacuum_analyze_scale_factor' => 0.02, 'autovacuum_analyze_threshold' => 500] as $name => $value) {
                    if ($direction === 'up') {
                        self::assertEquals($value, (float) $options[$name]);
                    } else {
                        self::assertArrayNotHasKey($name, $options);
                    }
                }
                self::assertSame($before, $connection->fetchAllAssociative('SELECT * FROM card_print_locale ORDER BY print_scryfall_id, lang'));
            }
        } finally {
            $connection->rollBack();
        }
    }
}
