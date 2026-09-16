<?php

namespace App\Tests\Infrastructure;

use App\Infrastructure\Database\PersistentSessionMiddleware;
use Doctrine\DBAL\Driver;
use PDO;
use PHPUnit\Framework\TestCase;

final class PersistentSessionMiddlewareTest extends TestCase
{
    public function testLegacyPersistenceRollsBackBeforeResetAndRestoresEncoding(): void
    {
        $pdo = $this->createMock(PDO::class);
        $pdo->expects(self::once())->method('inTransaction')->willReturn(true);
        $connection = $this->createMock(Driver\Connection::class);
        $connection->expects(self::once())->method('getNativeConnection')->willReturn($pdo);
        $steps = [];
        $connection->expects(self::once())->method('rollBack')->willReturnCallback(static function () use (&$steps): void { $steps[] = 'rollback'; });
        $connection->expects(self::exactly(2))->method('exec')->willReturnCallback(static function (string $sql) use (&$steps): int { $steps[] = $sql; return 0; });
        $connection->expects(self::once())->method('quote')->with('utf8')->willReturn("'utf8'");
        $driver = $this->createMock(Driver::class);
        $driver->expects(self::once())->method('connect')->willReturn($connection);
        (new PersistentSessionMiddleware())->wrap($driver)->connect(['driver' => 'pdo_pgsql', 'persistent' => true, 'charset' => 'utf8', 'driverOptions' => [PDO::ATTR_PERSISTENT => false]]);
        self::assertSame(['rollback', 'DISCARD ALL', "SET NAMES 'utf8'"], $steps);
    }

    public function testDisabledPersistenceDoesNotChangeConnectionSetup(): void
    {
        $params = ['driver' => 'pdo_pgsql', 'charset' => 'utf8', 'driverOptions' => [PDO::ATTR_PERSISTENT => false]];
        $connection = $this->createMock(Driver\Connection::class);
        $connection->expects(self::never())->method('exec');
        $connection->expects(self::never())->method('getNativeConnection');
        $driver = $this->createMock(Driver::class);
        $driver->expects(self::once())->method('connect')->with($params)->willReturn($connection);
        self::assertSame($connection, (new PersistentSessionMiddleware())->wrap($driver)->connect($params));
    }

    public function testCleanupFailureDoesNotExposeTheDirtyConnection(): void
    {
        $pdo = $this->createMock(PDO::class);
        $pdo->expects(self::once())->method('inTransaction')->willReturn(false);
        $connection = $this->createMock(Driver\Connection::class);
        $connection->expects(self::once())->method('getNativeConnection')->willReturn($pdo);
        $connection->expects(self::once())->method('exec')->with('DISCARD ALL')->willThrowException(new \RuntimeException('reset failed'));
        $driver = $this->createMock(Driver::class);
        $driver->expects(self::once())->method('connect')->with(['driver' => 'pdo_pgsql', 'driverOptions' => [PDO::ATTR_PERSISTENT => true]])->willReturn($connection);
        $this->expectExceptionMessage('reset failed');
        (new PersistentSessionMiddleware())->wrap($driver)->connect(['driver' => 'pdo_pgsql', 'charset' => 'utf8', 'driverOptions' => [PDO::ATTR_PERSISTENT => true]]);
    }
}
