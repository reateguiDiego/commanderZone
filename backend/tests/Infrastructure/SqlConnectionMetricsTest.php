<?php

namespace App\Tests\Infrastructure;

use App\Infrastructure\Observability\RequestPerformanceContext;
use App\Infrastructure\Observability\SqlMetricsMiddleware;
use Doctrine\DBAL\Driver;
use PHPUnit\Framework\TestCase;

final class SqlConnectionMetricsTest extends TestCase
{
    public function testConnectionsAreMeasuredSeparatelyAndResetBetweenRequests(): void
    {
        $context = new RequestPerformanceContext();
        $driver = $this->createMock(Driver::class);
        $driver->expects(self::once())->method('connect')->willReturnCallback(function (): Driver\Connection {
            usleep(20_000);
            return $this->createStub(Driver\Connection::class);
        });
        (new SqlMetricsMiddleware($context))->wrap($driver)->connect(['password' => 'never-logged']);
        $metrics = $context->metrics();
        self::assertSame(1, $metrics['db_connection_count']);
        self::assertGreaterThanOrEqual(10, $metrics['db_connection_duration_ms']);
        self::assertSame(0, $metrics['query_count']);
        self::assertStringNotContainsString('never-logged', json_encode($metrics));
        $context->reset();
        self::assertSame(0, $context->metrics()['db_connection_count']);
        self::assertEquals(0, $context->metrics()['db_connection_duration_ms']);
    }

    public function testFailedConnectionIsRecordedAndExceptionPropagates(): void
    {
        $context = new RequestPerformanceContext();
        $driver = $this->createMock(Driver::class);
        $driver->expects(self::once())->method('connect')->willThrowException(new \RuntimeException('connection failed'));
        try {
            (new SqlMetricsMiddleware($context))->wrap($driver)->connect([]);
            self::fail('Expected the connection error.');
        } catch (\RuntimeException $error) {
            self::assertSame('connection failed', $error->getMessage());
        }
        self::assertSame(1, $context->metrics()['db_failed_connections']);
        self::assertSame(0, $context->metrics()['failed_queries']);
    }
}
