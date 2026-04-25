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

    public function testKeepsDoubleFacedCardNames(): void
    {
        $entries = (new DecklistParser())->parse(<<<'TXT'
Deck
1 Fable of the Mirror-Breaker / Reflection of Kiki-Jiki (NEO) 141
// Comment line
1 Hallowed Fountain (PECL) 265p
1 Teferi, Time Raveler (WAR) 221★
TXT);

        self::assertSame('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', $entries[0]['name']);
        self::assertSame('Hallowed Fountain', $entries[1]['name']);
        self::assertSame('Teferi, Time Raveler', $entries[2]['name']);
    }
}
