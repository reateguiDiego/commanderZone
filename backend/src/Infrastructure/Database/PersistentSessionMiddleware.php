<?php

namespace App\Infrastructure\Database;

use Doctrine\DBAL\Driver;
use Doctrine\DBAL\Driver\Middleware;
use Doctrine\DBAL\Driver\Middleware\AbstractDriverMiddleware;
use PDO;
use SensitiveParameter;

/** Reset a pooled PostgreSQL session before exposing it to application code. */
final class PersistentSessionMiddleware implements Middleware
{
    public function wrap(Driver $driver): Driver
    {
        return new class($driver) extends AbstractDriverMiddleware {
            public function connect(#[SensitiveParameter] array $params): Driver\Connection
            {
                $persistent = !empty($params['persistent']) || !empty($params['driverOptions'][PDO::ATTR_PERSISTENT]);
                if (!$persistent || ($params['driver'] ?? '') !== 'pdo_pgsql') {
                    return parent::connect($params);
                }

                // DBAL normally sends SET NAMES during connect. Defer it until
                // after rollback: an abandoned transaction may already be aborted.
                $charset = $params['charset'] ?? null;
                unset($params['charset']);
                $connection = parent::connect($params);
                $pdo = $connection->getNativeConnection();
                if (!$pdo instanceof PDO) {
                    throw new \LogicException('Persistent PostgreSQL sessions require PDO.');
                }
                if ($pdo->inTransaction()) {
                    $connection->rollBack();
                }
                // Includes session settings, advisory locks, prepared statements,
                // LISTEN subscriptions and temporary objects from previous requests.
                $connection->exec('DISCARD ALL');
                if ($charset !== null) {
                    $connection->exec('SET NAMES '.$connection->quote($charset));
                }

                return $connection;
            }
        };
    }
}
