<?php

namespace App\Tests\Application;

use App\Application\Deck\DeckAnalysisService;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class DeckAnalysisServiceTest extends TestCase
{
    public function testParsesManaCosts(): void
    {
        $service = new DeckAnalysisService();

        self::assertSame(1, $service->parseManaCost('{W}')['coloredSymbols']['W']);
        self::assertSame(1, $service->parseManaCost('{1}{W}')['genericAmount']);
        self::assertSame(2, $service->parseManaCost('{2}{G}{G}')['coloredSymbols']['G']);
        self::assertSame(1, $service->parseManaCost('{X}{R}')['xSymbols']);
        self::assertSame(['W/U'], $service->parseManaCost('{W/U}')['hybridSymbols']);
        self::assertSame(1, $service->parseManaCost('{2/W}')['coloredSymbols']['W']);
        self::assertSame(['G/P'], $service->parseManaCost('{G/P}')['phyrexianSymbols']);
        self::assertSame(1, $service->parseManaCost('{C}')['colorlessSymbols']);
        self::assertSame(10, $service->parseManaCost('{10}')['genericAmount']);
    }

    public function testAnalyzesDeckForMoxfieldStyleDto(): void
    {
        $deck = new Deck(new User('analysis@example.test', 'Analysis'), 'Azorius Tools');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000100', 'Commander', [
            'type_line' => 'Legendary Creature - Human',
            'mana_cost' => '{1}{W}{U}',
            'cmc' => 3,
            'color_identity' => ['W', 'U'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000101', 'Island', [
            'type_line' => 'Basic Land - Island',
            'mana_cost' => '',
            'produced_mana' => ['U'],
        ]), 2));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000102', 'Sol Ring', [
            'type_line' => 'Artifact',
            'mana_cost' => '{1}',
            'cmc' => 1,
            'oracle_text' => '{T}: Add {C}{C}.',
            'produced_mana' => ['C'],
            'prices' => ['eur' => '1.23'],
        ]), 1));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000103', 'Divination', [
            'type_line' => 'Sorcery',
            'mana_cost' => '{2}{U}',
            'cmc' => 3,
            'oracle_text' => 'Draw two cards.',
        ]), 1));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000104', 'Swords to Plowshares', [
            'type_line' => 'Instant',
            'mana_cost' => '{W}',
            'cmc' => 1,
            'oracle_text' => 'Exile target creature.',
        ]), 1));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000105', 'Wrath of God', [
            'type_line' => 'Sorcery',
            'mana_cost' => '{2}{W}{W}',
            'cmc' => 4,
            'oracle_text' => 'Destroy all creatures.',
        ]), 1));

        $analysis = (new DeckAnalysisService())->analyze($deck, ['manaSourcesMode' => 'landsAndRamp']);

        self::assertSame(7, $analysis['summary']['totalCards']);
        self::assertSame(6, $analysis['summary']['mainboardCards']);
        self::assertSame(1, $analysis['summary']['commanderCards']);
        self::assertSame(2, $analysis['summary']['landCount']);
        self::assertSame(5, $analysis['summary']['nonLandCount']);
        self::assertSame(['W', 'U'], $analysis['summary']['colorIdentity']);
        self::assertSame(12, $analysis['summary']['totalManaValue']);
        self::assertSame(1.71, $analysis['summary']['averageManaValueWithLands']);
        self::assertSame(2.4, $analysis['summary']['averageManaValueWithoutLands']);
        self::assertSame(2, $analysis['manaCurve']['buckets'][1]['totalCards']);
        self::assertSame(2, $analysis['manaCurve']['buckets'][0]['lands']);
        self::assertSame('artifact', $analysis['manaCurve']['buckets'][1]['cards'][0]['primaryType']);
        self::assertSame(1.23, $analysis['manaCurve']['buckets'][1]['cards'][0]['priceEur']);
        self::assertSame(2, $analysis['typeBreakdown']['sections'][2]['count']);
        self::assertSame(4, $analysis['colorRequirement']['symbolsByColor']['W']['symbolCount']);
        self::assertSame(2, $analysis['colorRequirement']['symbolsByColor']['U']['symbolCount']);
        self::assertSame(2, $analysis['manaProduction']['productionByColor']['U']['sourceCount']);
        self::assertSame(1, $analysis['manaProduction']['productionByColor']['C']['sourceCount']);
        self::assertNotEmpty($analysis['colorBalance']['colors']);
        self::assertSame(7, count($analysis['curvePlayability']['buckets']));
    }

    public function testOptionsCanExcludeCommanderAndIncludeSideboard(): void
    {
        $deck = new Deck(new User('options@example.test', 'Options'), 'Options Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000201', 'Commander', [
            'type_line' => 'Legendary Creature',
            'mana_cost' => '{3}',
            'cmc' => 3,
            'color_identity' => ['G'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000202', 'Forest', [
            'type_line' => 'Basic Land - Forest',
        ]), 1));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000203', 'Side Spell', [
            'type_line' => 'Instant',
            'mana_cost' => '{R}',
            'cmc' => 1,
        ]), 2, DeckCard::SECTION_SIDEBOARD));

        $service = new DeckAnalysisService();

        self::assertSame(1, $service->analyze($deck, ['includeCommanderInAnalysis' => false])['summary']['totalCards']);
        self::assertSame(4, $service->analyze($deck, ['includeSideboard' => true])['summary']['totalCards']);
    }

    public function testHypergeometricAtLeastReturnsPercentage(): void
    {
        $probability = (new DeckAnalysisService())->hypergeometricAtLeast(99, 37, 10, 3);

        self::assertGreaterThan(0, $probability);
        self::assertLessThan(100, $probability);
    }

    private function card(string $scryfallId, string $name, array $overrides = []): Card
    {
        $card = new Card($scryfallId);
        $card->updateFromScryfall(array_replace([
            'id' => $scryfallId,
            'name' => $name,
            'mana_cost' => '{1}',
            'type_line' => 'Artifact',
            'oracle_text' => '',
            'colors' => [],
            'color_identity' => [],
            'legalities' => ['commander' => 'legal'],
            'image_uris' => ['normal' => 'https://cards.scryfall.io/test.jpg'],
            'layout' => 'normal',
        ], $overrides));

        return $card;
    }
}
