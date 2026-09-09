<?php

namespace App\Infrastructure\Observability;

use Doctrine\DBAL\Driver;
use Doctrine\DBAL\Driver\Middleware;
use Doctrine\DBAL\Driver\Middleware\AbstractConnectionMiddleware;
use Doctrine\DBAL\Driver\Middleware\AbstractDriverMiddleware;
use Doctrine\DBAL\Driver\Middleware\AbstractStatementMiddleware;
use Doctrine\DBAL\Driver\Result;
use Doctrine\DBAL\Driver\Statement;
use SensitiveParameter;

final readonly class SqlMetricsMiddleware implements Middleware
{
    public function __construct(private RequestPerformanceContext $context)
    {
    }

    public function wrap(Driver $driver): Driver
    {
        return new SqlMetricsDriver($driver, $this->context);
    }
}

final class SqlMetricsDriver extends AbstractDriverMiddleware
{
    public function __construct(Driver $wrappedDriver, private readonly RequestPerformanceContext $context)
    {
        parent::__construct($wrappedDriver);
    }

    public function connect(#[SensitiveParameter] array $params): Driver\Connection
    {
        return new SqlMetricsConnection(parent::connect($params), $this->context);
    }
}

final class SqlMetricsConnection extends AbstractConnectionMiddleware
{
    public function __construct(Driver\Connection $wrappedConnection, private readonly RequestPerformanceContext $context)
    {
        parent::__construct($wrappedConnection);
    }

    public function prepare(string $sql): Statement
    {
        return new SqlMetricsStatement(parent::prepare($sql), $this->context);
    }

    public function query(string $sql): Result
    {
        $startedAt = hrtime(true);
        $result = parent::query($sql);
        $this->context->recordQuery((hrtime(true) - $startedAt) / 1_000_000, $result->rowCount());

        return $result;
    }

    public function exec(string $sql): int|string
    {
        $startedAt = hrtime(true);
        $rows = parent::exec($sql);
        $this->context->recordQuery((hrtime(true) - $startedAt) / 1_000_000, (int) $rows);

        return $rows;
    }
}

final class SqlMetricsStatement extends AbstractStatementMiddleware
{
    public function __construct(Statement $wrappedStatement, private readonly RequestPerformanceContext $context)
    {
        parent::__construct($wrappedStatement);
    }

    public function execute(): Result
    {
        $startedAt = hrtime(true);
        $result = parent::execute();
        $this->context->recordQuery((hrtime(true) - $startedAt) / 1_000_000, $result->rowCount());

        return $result;
    }
}
