<?php

namespace App\Tests\Integration;

use App\Infrastructure\Database\PersistentSessionMiddleware;
use Doctrine\DBAL\Configuration;
use Doctrine\DBAL\DriverManager;
use PDO;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

final class PersistentSessionTest extends KernelTestCase
{
    public function testReusedSessionDiscardsStateAndRollsBackFailedWork(): void
    {
        self::bootKernel();
        $params = self::getContainer()->get('doctrine')->getConnection()->getParams();
        // Isolate this test's native persistent pool from other tests.
        $params['driverOptions'][PDO::ATTR_PERSISTENT] = 'cz-session-test-'.bin2hex(random_bytes(6));
        $config = new Configuration();
        $config->setMiddlewares([new PersistentSessionMiddleware()]);
        $first = DriverManager::getConnection($params, $config);
        $observerParams = $params;
        $observerParams['driverOptions'][PDO::ATTR_PERSISTENT] = false;
        $observer = DriverManager::getConnection($observerParams);
        $table = 'cz_persistent_probe_'.bin2hex(random_bytes(5));
        $observer->executeStatement('CREATE TABLE '.$table.' (id integer)');
        try {
            $pid = $first->fetchOne('SELECT pg_backend_pid()');
            $originalPath = $first->fetchOne('SHOW search_path');
            $originalName = $first->fetchOne('SHOW application_name');
            $first->executeStatement("SET application_name = 'previous-request'");
            $first->executeStatement('SET search_path = pg_catalog, public');
            $first->executeStatement('CREATE TEMP TABLE cz_previous_request (id integer)');
            $first->executeStatement('SELECT pg_advisory_lock(871234, 123487)');
            $first->beginTransaction();
            $first->executeStatement('INSERT INTO '.$table.' VALUES (1)');
            try {
                $first->executeQuery('SELECT 1 / 0');
                self::fail('Expected PostgreSQL to abort this transaction.');
            } catch (\Doctrine\DBAL\Exception\DriverException) {
            }
            $first->close();
            unset($first);

            $second = DriverManager::getConnection($params, $config);
            self::assertSame($pid, $second->fetchOne('SELECT pg_backend_pid()'));
            self::assertFalse($second->getNativeConnection()->inTransaction());
            self::assertSame(0, (int) $second->fetchOne('SELECT COUNT(*) FROM '.$table));
            self::assertSame($originalName, $second->fetchOne('SHOW application_name'));
            self::assertSame($originalPath, $second->fetchOne('SHOW search_path'));
            self::assertNull($second->fetchOne("SELECT to_regclass('pg_temp.cz_previous_request')"));
            self::assertTrue((bool) $observer->fetchOne('SELECT pg_try_advisory_lock(871234, 123487)'));
            $observer->executeQuery('SELECT pg_advisory_unlock(871234, 123487)')->free();
            self::assertSame('UTF8', $second->fetchOne('SHOW client_encoding'));
            $second->close();
        } finally {
            if (isset($first)) $first->close();
            if (isset($second)) $second->close();
            $observer->executeStatement('DROP TABLE IF EXISTS '.$table);
            $observer->close();
        }
    }
}
