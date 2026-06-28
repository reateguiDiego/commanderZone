<?php

namespace App\Infrastructure\Scryfall;

/**
 * @param list<string> $truncatedTables
 */
final readonly class CardCatalogResetPrepareResult
{
    public function __construct(
        public int $backedUpDeckCards,
        public array $truncatedTables,
    ) {
    }
}
