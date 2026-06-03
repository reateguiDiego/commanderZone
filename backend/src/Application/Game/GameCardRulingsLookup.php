<?php

namespace App\Application\Game;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

class GameCardRulingsLookup
{
    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @param list<string> $scryfallIds
     *
     * @return array<string,bool>
     */
    public function hasRulingsByScryfallIds(array $scryfallIds): array
    {
        $scryfallIds = array_values(array_unique(array_filter(array_map(
            static fn (mixed $id): string => trim((string) $id),
            $scryfallIds,
        ))));
        if ($scryfallIds === []) {
            return [];
        }

        $rows = $this->connection->fetchAllAssociative(
            'SELECT scryfall_id, has_rulings FROM card WHERE scryfall_id IN (:ids)',
            ['ids' => $scryfallIds],
            ['ids' => ArrayParameterType::STRING],
        );

        $lookup = [];
        foreach ($rows as $row) {
            $scryfallId = trim((string) ($row['scryfall_id'] ?? ''));
            if ($scryfallId === '') {
                continue;
            }

            $lookup[$scryfallId] = (bool) ($row['has_rulings'] ?? false);
        }

        return $lookup;
    }
}
