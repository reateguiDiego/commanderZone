<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;

/** Session locks coordinate PHP processes without holding a transaction during calculation. */
final class DeckAnalysisExecution
{
    public function __construct(private readonly Connection $connection)
    {
    }

    public function run(string $deckId, string $family, callable $operation): array
    {
        $key = 'deck-analysis:'.$family.':'.$deckId;
        $deadline = hrtime(true) + 2_000_000_000;
        do {
            $acquired = $this->connection->fetchOne('SELECT pg_try_advisory_lock(hashtextextended(:key, 0))', ['key' => $key]);
            if ($acquired === true || $acquired === 1 || $acquired === 't' || $acquired === '1') {
                try {
                    return $operation();
                } finally {
                    $this->connection->executeQuery('SELECT pg_advisory_unlock(hashtextextended(:key, 0))', ['key' => $key])->free();
                }
            }
            usleep(25_000);
        } while (hrtime(true) < $deadline);

        throw new ServiceUnavailableHttpException(1, 'Analysis is already being calculated. Please retry.');
    }
}
