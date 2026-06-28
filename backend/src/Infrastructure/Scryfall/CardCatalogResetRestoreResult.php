<?php

namespace App\Infrastructure\Scryfall;

/**
 * @param list<array{deck_id:mixed,scryfall_id:mixed,quantity:mixed,section:mixed}> $missingCards
 */
final readonly class CardCatalogResetRestoreResult
{
    public function __construct(
        public int $restoredDeckCards,
        public array $missingCards,
        public bool $backupCleared,
    ) {
    }
}
