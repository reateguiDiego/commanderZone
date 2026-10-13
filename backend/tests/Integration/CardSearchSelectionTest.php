<?php

namespace App\Tests\Integration;

use App\Application\Card\CardSearchSelection;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception\DriverException;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

final class CardSearchSelectionTest extends KernelTestCase
{
    public function testCachedSearchSkipsSelectionSqlAndPreservesJit(): void
    {
        self::bootKernel();
        $container = static::getContainer();
        $connection = $container->get(Connection::class);
        $original = $connection->fetchOne('SHOW jit');
        $cache = new \Symfony\Component\Cache\Adapter\ArrayAdapter();
        $performance = $container->get(\App\Infrastructure\Observability\RequestPerformanceContext::class);
        $controller = $container->get(\App\UI\Http\CardsController::class);
        $request = \Symfony\Component\HttpFoundation\Request::create('/cards/search', 'GET', ['q' => 'jit-scope-no-matching-card-'.bin2hex(random_bytes(12))]);
        $search = fn () => $controller->search(
            $request,
            $container->get(\Doctrine\ORM\EntityManagerInterface::class),
            $container->get(\App\Application\Card\CardLocalizationService::class),
            $container->get(\App\Application\Card\CardSearchFilterBuilder::class),
            $cache,
            $performance,
            $container->get(CardSearchSelection::class),
            'prod',
        );

        try {
            $connection->executeStatement('SET jit = on');
            $performance->reset();
            $cold = $search();
            self::assertSame(200, $cold->getStatusCode());
            self::assertSame([], json_decode($cold->getContent(), true, 512, JSON_THROW_ON_ERROR)['data']);
            self::assertGreaterThan(0, $performance->metrics()['query_count']);
            self::assertSame('on', $connection->fetchOne('SHOW jit'));
            self::assertFalse($connection->isTransactionActive());

            $performance->reset();
            self::assertSame($cold->getContent(), $search()->getContent());
            self::assertSame(0, $performance->metrics()['query_count']);
            self::assertSame('on', $connection->fetchOne('SHOW jit'));
            self::assertFalse($connection->isTransactionActive());
        } finally {
            $connection->fetchOne("SELECT set_config('jit', ?, false)", [$original]);
        }
    }

    public static function scopes(): iterable
    {
        foreach (['on', 'off'] as $initial) {
            foreach ([false, true] as $nested) {
                foreach (['success', 'php', 'sql'] as $outcome) {
                    yield $initial.'-'.($nested ? 'nested' : 'standalone').'-'.$outcome => [$initial, $nested, $outcome];
                }
            }
        }
    }

    #[DataProvider('scopes')]
    public function testRestoresSettingsOnTheSameConnection(string $initial, bool $nested, string $outcome): void
    {
        self::bootKernel();
        $connection = static::getContainer()->get(Connection::class);
        $original = $connection->fetchOne('SHOW jit');
        $pid = $connection->fetchOne('SELECT pg_backend_pid()');
        $service = new CardSearchSelection($connection);
        $expectedError = new \RuntimeException('Selection failed');

        try {
            $connection->executeStatement('SET jit = on');
            if ($nested) {
                $connection->beginTransaction();
                $connection->executeStatement('CREATE TEMP TABLE jit_scope_probe (value integer) ON COMMIT DROP');
                $connection->executeStatement('INSERT INTO jit_scope_probe VALUES (7)');
            }
            $connection->fetchOne("SELECT set_config('jit', ?, ?)", [$initial, $nested ? 'true' : 'false']);

            try {
                $result = $service->run(static function () use ($connection, $outcome, $expectedError): array {
                    self::assertSame('off', $connection->fetchOne('SHOW jit'));
                    if ($outcome === 'php') {
                        throw $expectedError;
                    }
                    if ($outcome === 'sql') {
                        $connection->fetchOne('SELECT 1 / 0');
                    }

                    return ['ids' => ['card-a'], 'total' => 1];
                });
                self::assertSame('success', $outcome);
                self::assertSame(['ids' => ['card-a'], 'total' => 1], $result);
            } catch (DriverException $error) {
                self::assertSame('sql', $outcome);
                self::assertSame('22012', $error->getSQLState());
            } catch (\RuntimeException $error) {
                self::assertSame('php', $outcome);
                self::assertSame($expectedError, $error);
            }

            self::assertSame($nested ? 1 : 0, $connection->getTransactionNestingLevel());
            self::assertSame($initial, $connection->fetchOne('SHOW jit'));
            self::assertSame($pid, $connection->fetchOne('SELECT pg_backend_pid()'));
            if ($nested) {
                self::assertSame(7, (int) $connection->fetchOne('SELECT value FROM jit_scope_probe'));
            }
            // A later operation can reuse the very same connection after any outcome.
            self::assertSame('off', $service->run(fn () => $connection->fetchOne('SHOW jit')));
            self::assertSame($initial, $connection->fetchOne('SHOW jit'));
        } finally {
            while ($connection->isTransactionActive()) {
                $connection->rollBack();
            }
            $connection->fetchOne("SELECT set_config('jit', ?, false)", [$original]);
        }
    }
}
