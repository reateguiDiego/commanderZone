<?php

namespace App\Application\Card;

use Doctrine\DBAL\Connection;

/** Keeps the search planner setting out of subsequent work on persistent connections. */
final readonly class CardSearchSelection
{
    public function __construct(private Connection $connection)
    {
    }

    /**
     * @template T
     * @param callable(): T $select
     * @return T
     */
    public function run(callable $select): mixed
    {
        $nested = $this->connection->isTransactionActive();

        return $this->connection->transactional(static function (Connection $connection) use ($select, $nested): mixed {
            // DBAL uses a savepoint when the caller already owns a transaction.
            $previous = $nested ? $connection->fetchOne('SHOW jit') : null;
            $connection->executeStatement('SET LOCAL jit = off');
            $result = $select();

            // Releasing a savepoint retains SET LOCAL, unlike ending a transaction.
            // Restore explicitly on success; rollback restores it on exceptions,
            // including SQL errors that leave the transaction in an aborted state.
            if ($nested) {
                $connection->fetchOne("SELECT set_config('jit', ?, true)", [$previous]);
            }

            return $result;
        });
    }
}
