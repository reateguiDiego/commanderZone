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
        $started = hrtime(true);
        try {
            $connection = parent::connect($params);
        } catch (\Throwable $error) {
            $this->context->recordConnection((hrtime(true) - $started) / 1_000_000, true);
            throw $error;
        }
        $this->context->recordConnection((hrtime(true) - $started) / 1_000_000);

        return new SqlMetricsConnection($connection, $this->context);
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
        $start = hrtime(true);
        $statement = parent::prepare($sql);
        return new SqlMetricsStatement($statement, $this->context, $sql, (hrtime(true) - $start) / 1e6);
    }

    public function query(string $sql): Result
    {
        $startedAt = hrtime(true);
        try {
            $result = parent::query($sql);
        } catch (\Throwable $error) {
            $duration = (hrtime(true) - $startedAt) / 1e6;
            $this->context->recordQuery($duration, 0, true);
            $this->context->recordQueryProfile($sql, 0, $duration, 0, true);
            throw $error;
        }
        $duration = (hrtime(true) - $startedAt) / 1e6;
        $rows = (int) $result->rowCount();
        $this->context->recordQuery($duration, $rows);
        $profile = $this->context->recordQueryProfile($sql, 0, $duration, $rows, false);

        return $profile === null ? $result : new SqlProfiledResult($result, $profile);
    }

    public function exec(string $sql): int|string
    {
        $startedAt = hrtime(true);
        try {
            $rows = parent::exec($sql);
        } catch (\Throwable $error) {
            $duration = (hrtime(true) - $startedAt) / 1e6;
            $this->context->recordQuery($duration, 0, true);
            $this->context->recordQueryProfile($sql, 0, $duration, 0, true);
            throw $error;
        }
        $duration = (hrtime(true) - $startedAt) / 1e6;
        $this->context->recordQuery($duration, (int) $rows);
        $this->context->recordQueryProfile($sql, 0, $duration, (int) $rows, false);

        return $rows;
    }
}

final class SqlMetricsStatement extends AbstractStatementMiddleware
{
    public function __construct(Statement $wrappedStatement, private readonly RequestPerformanceContext $context, private readonly string $sql, private float $prepareMs)
    {
        parent::__construct($wrappedStatement);
    }

    public function execute(): Result
    {
        $startedAt = hrtime(true);
        try {
            $result = parent::execute();
        } catch (\Throwable $error) {
            $duration = (hrtime(true) - $startedAt) / 1e6;
            $this->context->recordQuery($duration, 0, true);
            $this->context->recordQueryProfile($this->sql, $this->prepareMs, $duration, 0, true);
            $this->prepareMs = 0;
            throw $error;
        }
        $duration = (hrtime(true) - $startedAt) / 1e6;
        $rows = (int) $result->rowCount();
        $this->context->recordQuery($duration, $rows);
        $profile = $this->context->recordQueryProfile($this->sql, $this->prepareMs, $duration, $rows, false);
        $this->prepareMs = 0;

        return $profile === null ? $result : new SqlProfiledResult($result, $profile);
    }
}
