<?php

namespace App\Infrastructure\Scryfall;

final class ScryfallBulkDataTypeNotFound extends \RuntimeException
{
    public function __construct(string $bulkType)
    {
        parent::__construct(sprintf('Scryfall %s bulk download URI was not found.', $bulkType));
    }
}
