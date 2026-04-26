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
        self::assertSame('neo', $entries[0]['setCode']);
        self::assertSame('141', $entries[0]['collectorNumber']);
        self::assertSame('Hallowed Fountain', $entries[1]['name']);
        self::assertSame('pecl', $entries[1]['setCode']);
        self::assertSame('265p', $entries[1]['collectorNumber']);
        self::assertSame('Teferi, Time Raveler', $entries[2]['name']);
        self::assertSame('war', $entries[2]['setCode']);
        self::assertSame('221', $entries[2]['collectorNumber']);
    }

    public function testParsesMoxfieldStyleSections(): void
    {
        $entries = (new DecklistParser())->parse(<<<'TXT'
Commander
1x Atraxa, Praetors' Voice (2X2) 190

Deck
1x Sol Ring (CMM) 703
TXT, DecklistParser::FORMAT_MOXFIELD);

        self::assertSame('commander', $entries[0]['section']);
        self::assertSame("Atraxa, Praetors' Voice", $entries[0]['name']);
        self::assertSame('2x2', $entries[0]['setCode']);
        self::assertSame('190', $entries[0]['collectorNumber']);
        self::assertSame('main', $entries[1]['section']);
        self::assertSame('cmm', $entries[1]['setCode']);
    }

    public function testParsesArchidektStyleCategoryHeadersAsMainDeck(): void
    {
        $entries = (new DecklistParser())->parse(<<<'TXT'
Commanders (1)
1 Esika, God of the Tree / The Prismatic Bridge (KHM) 168

Creatures (2)
1 Birds of Paradise (RVR) 133
1 Llanowar Elves

Lands (1)
1 Forest
TXT, DecklistParser::FORMAT_ARCHIDEKT);

        self::assertSame('commander', $entries[0]['section']);
        self::assertSame('Esika, God of the Tree // The Prismatic Bridge', $entries[0]['name']);
        self::assertSame('khm', $entries[0]['setCode']);
        self::assertSame('main', $entries[1]['section']);
        self::assertSame('main', $entries[3]['section']);
    }

    public function testDetectsMoxfieldFormat(): void
    {
        $format = (new DecklistParser())->detectFormat(<<<'TXT'
Commander
1x Atraxa, Praetors' Voice (2X2) 190

Deck
1x Sol Ring (CMM) 703
TXT);

        self::assertSame(DecklistParser::FORMAT_MOXFIELD, $format);
    }

    public function testDetectsArchidektFormat(): void
    {
        $format = (new DecklistParser())->detectFormat(<<<'TXT'
Commanders (1)
1 Esika, God of the Tree (KHM) 168

Creatures (12)
1 Birds of Paradise
TXT);

        self::assertSame(DecklistParser::FORMAT_ARCHIDEKT, $format);
    }

    public function testDetectsPlainFormatAsFallback(): void
    {
        $format = (new DecklistParser())->detectFormat(<<<'TXT'
Commander
1 Atraxa, Praetors' Voice

Deck
1 Sol Ring
TXT);

        self::assertSame(DecklistParser::FORMAT_PLAIN, $format);
    }

    public function testExplicitFormatOverridesDetection(): void
    {
        $parser = new DecklistParser();
        $decklist = "1x Sol Ring (CMM) 703";

        self::assertSame(DecklistParser::FORMAT_PLAIN, $parser->resolveFormat(DecklistParser::FORMAT_PLAIN, $decklist));
        self::assertSame(DecklistParser::FORMAT_MOXFIELD, $parser->resolveFormat(null, $decklist));
    }
}
