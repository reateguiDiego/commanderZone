<?php

namespace App\Tests\Application;

use App\Application\Deck\DecklistParser;
use PHPUnit\Framework\TestCase;

class DecklistParserTest extends TestCase
{
    public function testParsesCommanderSectionsAndQuantities(): void
    {
        $entries = (new DecklistParser())->parse(<<<'TXT'
Commander
1 Atraxa, Praetors' Voice

Deck
1 Sol Ring
10 Island
TXT);

        self::assertSame('commander', $entries[0]['section']);
        self::assertSame(1, $entries[0]['quantity']);
        self::assertSame("Atraxa, Praetors' Voice", $entries[0]['name']);
        self::assertSame('main', $entries[1]['section']);
        self::assertSame(10, $entries[2]['quantity']);
    }
}
