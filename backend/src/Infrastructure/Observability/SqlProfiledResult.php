<?php

namespace App\Infrastructure\Observability;

use Doctrine\DBAL\Driver\Middleware\AbstractResultMiddleware;
use Doctrine\DBAL\Driver\Result;

final class SqlProfiledResult extends AbstractResultMiddleware
{
    public function __construct(Result $result, private readonly SqlQueryProfile $profile)
    {
        parent::__construct($result);
    }

    private function measure(callable $fetch): mixed
    {
        $start = hrtime(true);
        try { return $fetch(); }
        catch (\Throwable $error) { ++$this->profile->fetchFailures; throw $error; }
        finally {
            $this->profile->fetchMs += (hrtime(true) - $start) / 1e6;
            ++$this->profile->fetchCalls;
        }
    }

    public function fetchNumeric(): array|false { return $this->measure(fn () => parent::fetchNumeric()); }
    public function fetchAssociative(): array|false { return $this->measure(fn () => parent::fetchAssociative()); }
    public function fetchOne(): mixed { return $this->measure(fn () => parent::fetchOne()); }
    public function fetchAllNumeric(): array { return $this->measure(fn () => parent::fetchAllNumeric()); }
    public function fetchAllAssociative(): array { return $this->measure(fn () => parent::fetchAllAssociative()); }
    public function fetchFirstColumn(): array { return $this->measure(fn () => parent::fetchFirstColumn()); }
}
