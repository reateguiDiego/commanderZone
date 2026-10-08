<?php

namespace App\Tests\Integration;

use App\Application\Card\CardsLanguageService;
use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Clock\MockClock;

final class CardLocaleRevisionTest extends KernelTestCase
{
    public function testCatalogWritesInvalidateCoverageAndRollbackRestoresRevision(): void
    {
        self::bootKernel();
        $db = static::getContainer()->get(Connection::class);
        $db->beginTransaction();
        try {
            $db->executeStatement('TRUNCATE card_print_locale');
            $revision = (int) $db->fetchOne('SELECT revision FROM card_locale_revision WHERE id = 1');
            $clock = new MockClock();
            $service = new CardsLanguageService($db, new ArrayAdapter(clock: $clock), 'prod');
            self::assertSame([], $service->languageCoverage());
            $db->executeStatement("INSERT INTO card_print (scryfall_id, normalized_name, default_name, default_image_uris, default_card_faces, layout, commander_legal, updated_at) VALUES ('revision-test', 'revision test', 'Revision test', '{}', '[]', 'normal', true, NOW())");
            $db->executeStatement("INSERT INTO card_print_locale (print_scryfall_id, lang, name, image_uris, card_faces, updated_at) VALUES ('revision-test', 'en', 'Revision test', '{}', '[]', NOW())");
            self::assertSame($revision + 1, (int) $db->fetchOne('SELECT revision FROM card_locale_revision WHERE id = 1'));
            self::assertSame([], $service->languageCoverage());
            $clock->sleep(61);
            self::assertSame(1, $service->languageCoverage()[0]['distinctCardNames']);

            $db->executeStatement("UPDATE card_print_locale SET lang = 'es' WHERE print_scryfall_id = 'revision-test'");
            $clock->sleep(61);
            self::assertSame('es', $service->languageCoverage()[0]['code']);
            $db->createSavepoint('catalog_write');
            $db->executeStatement('DELETE FROM card_print_locale');
            self::assertSame($revision + 3, (int) $db->fetchOne('SELECT revision FROM card_locale_revision WHERE id = 1'));
            $db->rollbackSavepoint('catalog_write');
            self::assertSame($revision + 2, (int) $db->fetchOne('SELECT revision FROM card_locale_revision WHERE id = 1'));
            $db->executeStatement('TRUNCATE card_print_locale');
            $clock->sleep(61);
            self::assertSame([], $service->languageCoverage());
            self::assertSame($revision + 3, (int) $db->fetchOne('SELECT revision FROM card_locale_revision WHERE id = 1'));
        } finally {
            $db->rollBack();
        }
    }
}
