<?php

namespace App\Tests\Infrastructure;

use App\Infrastructure\Observability\RequestPerformanceContext;
use App\Infrastructure\Observability\SqlMetricsMiddleware;
use Doctrine\DBAL\Driver;
use PHPUnit\Framework\TestCase;

final class SqlQueryProfileTest extends TestCase
{
    public function testOptInBoundsAndReset(): void
    {
        $context = new RequestPerformanceContext('selected');
        foreach (['other', ''] as $slug) {
            $context->enableDeckSqlProfile($slug);
            self::assertNull($context->recordQueryProfile('SELECT secret', 0, 1, 1, false));
            self::assertArrayNotHasKey('sql_profile', $context->metrics());
        }
        $context->enableDeckSqlProfile('selected');
        $context->measure('outer', function () use ($context): void {
            $context->measure('inner', fn () => $context->recordQueryProfile('SELECT secret', 0, 1, 1, false));
            $context->recordQueryProfile('SELECT secret', 0, 1, 1, false);
        });
        self::assertSame(['inner', 'outer'], array_column($context->metrics()['sql_profile'], 'stage'));
        for ($i = 0; $i < 65; ++$i) $context->recordQueryProfile('SELECT secret', 0, 1, 1, false);
        self::assertCount(64, $context->metrics()['sql_profile']);
        self::assertSame(3, $context->metrics()['sql_profile_dropped']);
        self::assertStringNotContainsString('secret', json_encode($context->metrics()));
        $context->reset();
        self::assertArrayNotHasKey('sql_profile', $context->metrics());
    }

    public function testPreparedResultsPreserveDataAndMeasureFetchWithoutLeakingBindings(): void
    {
        $context = new RequestPerformanceContext('selected');
        $context->enableDeckSqlProfile('selected');
        $result = $this->createMock(Driver\Result::class);
        $result->method('rowCount')->willReturn(1);
        $result->expects(self::exactly(2))->method('fetchAllAssociative')->willReturnCallback(static function (): array {
            usleep(2000);
            return [['name' => 'private-value']];
        });
        $statement = $this->createMock(Driver\Statement::class);
        $statement->expects(self::once())->method('bindValue')->with(1, 'private-value', \Doctrine\DBAL\ParameterType::STRING);
        $statement->method('execute')->willReturn($result);
        $connection = $this->createStub(Driver\Connection::class);
        $connection->method('prepare')->willReturnCallback(static function () use ($statement): Driver\Statement { usleep(2000); return $statement; });
        $driver = $this->createStub(Driver::class);
        $driver->method('connect')->willReturn($connection);
        $prepared = (new SqlMetricsMiddleware($context))->wrap($driver)->connect([])->prepare('SELECT name WHERE id = ?');
        $prepared->bindValue(1, 'private-value', \Doctrine\DBAL\ParameterType::STRING);
        $first = $prepared->execute();
        self::assertSame([['name' => 'private-value']], $first->fetchAllAssociative());
        $prepared->execute();
        $profiles = $context->metrics()['sql_profile'];
        self::assertGreaterThan(0, $profiles[0]['prepare_ms']);
        self::assertEquals(0, $profiles[1]['prepare_ms']);
        self::assertGreaterThan(0, $profiles[0]['fetch_ms']);
        self::assertSame(1, $profiles[0]['fetch_calls']);
        self::assertSame(hash('sha256', 'SELECT name WHERE id = ?'), $profiles[0]['fingerprint']);
        self::assertStringNotContainsString('private-value', json_encode($context->metrics()));
        $context->reset();
        $context->enableDeckSqlProfile('selected');
        $first->fetchAllAssociative();
        self::assertSame([], $context->metrics()['sql_profile']);
    }

    public function testQueryFailureStillPropagates(): void
    {
        $context = new RequestPerformanceContext('selected');
        $context->enableDeckSqlProfile('selected');
        $connection = $this->createStub(Driver\Connection::class);
        $error = new \RuntimeException('driver failure');
        $connection->method('query')->willThrowException($error);
        $driver = $this->createStub(Driver::class);
        $driver->method('connect')->willReturn($connection);
        try {
            (new SqlMetricsMiddleware($context))->wrap($driver)->connect([])->query('SELECT 1');
            self::fail('Expected driver failure');
        } catch (\RuntimeException $caught) {
            self::assertSame($error, $caught);
        }
        self::assertSame(1, $context->metrics()['failed_queries']);
        self::assertTrue($context->metrics()['sql_profile'][0]['failed']);
    }
}
