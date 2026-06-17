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

    public function testIgnoresKnownDeckExportMetadataLines(): void
    {
        $entries = (new DecklistParser())->parse(<<<'TXT'
About
Name ZZZZZombies

Commander
1 Muldrotha, the Gravetide

Deck
1 Arcane Signet
TXT);

        self::assertCount(2, $entries);
        self::assertSame('commander', $entries[0]['section']);
        self::assertSame('main', $entries[1]['section']);
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

    public function testParsesInlineCommanderMarkersFromDeckstatsAndArchidekt(): void
    {
        $entries = (new DecklistParser())->parse(<<<'TXT'
1 Sliver Gravemother # !Commander
1x Ghyrson Starn, Kelermorph (40k) 124 [Commander{top}]
1 Arcane Signet
TXT, DecklistParser::FORMAT_ARCHIDEKT);

        self::assertSame('commander', $entries[0]['section']);
        self::assertSame('Sliver Gravemother', $entries[0]['name']);
        self::assertSame('commander', $entries[1]['section']);
        self::assertSame('Ghyrson Starn, Kelermorph', $entries[1]['name']);
        self::assertSame('40k', $entries[1]['setCode']);
        self::assertSame('main', $entries[2]['section']);
    }

    public function testRemovesArchidektCategoryAndStateNoise(): void
    {
        $entries = (new DecklistParser())->parse(<<<'TXT'
1x Arcane Denial (soc) 187 [Removal] ^Getting,#2ccce4^
1x Command Tower (msc) 233 [Land]
TXT, DecklistParser::FORMAT_ARCHIDEKT);

        self::assertSame('Arcane Denial', $entries[0]['name']);
        self::assertSame('soc', $entries[0]['setCode']);
        self::assertSame('187', $entries[0]['collectorNumber']);
        self::assertSame('Command Tower', $entries[1]['name']);
    }

    public function testParsesSideboardAndMaybeboardHeaders(): void
    {
        $entries = (new DecklistParser())->parse(<<<'TXT'
Deck
1 Sol Ring

Sideboard
1 Pyroblast

Considering
1 Rhystic Study
TXT);

        self::assertSame('main', $entries[0]['section']);
        self::assertSame('sideboard', $entries[1]['section']);
        self::assertSame('maybeboard', $entries[2]['section']);
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

    public function testDetectsMoxfieldFormatWithoutSectionHeadersWhenPrintMetadataIsPresent(): void
    {
        $format = (new DecklistParser())->detectFormat(<<<'TXT'
1 Muldrotha, the Gravetide (FDN) 243
1 Arcane Signet (MKC) 223
1 Assassin's Trophy (MKM) 187
TXT);

        self::assertSame(DecklistParser::FORMAT_MOXFIELD, $format);
    }

    public function testDetectsArchidektFormatFromInlineCategoryTags(): void
    {
        $format = (new DecklistParser())->detectFormat(<<<'TXT'
1x Arcane Signet (eld) 331 [Ramp]
1x Ghyrson Starn, Kelermorph (40k) 124 [Commander{top}]
1x Command Tower (msc) 233 [Land]
TXT);

        self::assertSame(DecklistParser::FORMAT_ARCHIDEKT, $format);
    }

    public function testExplicitFormatOverridesDetection(): void
    {
        $parser = new DecklistParser();
        $decklist = "1x Sol Ring (CMM) 703";

        self::assertSame(DecklistParser::FORMAT_PLAIN, $parser->resolveFormat(DecklistParser::FORMAT_PLAIN, $decklist));
        self::assertSame(DecklistParser::FORMAT_MOXFIELD, $parser->resolveFormat(null, $decklist));
    }

    public function testParsesXPrefixedQuantities(): void
    {
        $entries = (new DecklistParser())->parse(<<<'TXT'
Deck
x2 Sol Ring
TXT);

        self::assertSame(2, $entries[0]['quantity']);
        self::assertSame('Sol Ring', $entries[0]['name']);
    }
}
