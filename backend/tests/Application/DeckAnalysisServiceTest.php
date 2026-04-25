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
    public function testAnalyzesCommanderDeckComposition(): void
    {
        $deck = new Deck(new User('analysis@example.test', 'Analysis'), 'Azorius Tools');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000101', 'Island', [
            'type_line' => 'Basic Land - Island',
            'mana_cost' => '',
        ]), 2));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000102', 'Sol Ring', [
            'type_line' => 'Artifact',
            'mana_cost' => '{1}',
            'oracle_text' => '{T}: Add {C}{C}.',
        ]), 1));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000103', 'Divination', [
            'type_line' => 'Sorcery',
            'mana_cost' => '{2}{U}',
            'oracle_text' => 'Draw two cards.',
        ]), 1));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000104', 'Swords to Plowshares', [
            'type_line' => 'Instant',
            'mana_cost' => '{W}',
            'oracle_text' => 'Exile target creature.',
        ]), 1));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000105', 'Wrath of God', [
            'type_line' => 'Sorcery',
            'mana_cost' => '{2}{W}{W}',
            'oracle_text' => 'Destroy all creatures.',
        ]), 1));

        $analysis = (new DeckAnalysisService())->analyze($deck);

        self::assertSame(6, $analysis['totalCards']);
        self::assertSame(2, $analysis['landCount']);
        self::assertSame(4, $analysis['nonlandCount']);
        self::assertSame(['W' => 3, 'U' => 1, 'B' => 0, 'R' => 0, 'G' => 0], $analysis['colorPips']);
        self::assertSame(2, $analysis['landTypes'][1]['count']);
        self::assertSame(2, $analysis['manaCurve'][1]['count']);
        self::assertSame(1, $analysis['manaCurve'][3]['count']);
        self::assertSame(1, $analysis['manaCurve'][4]['count']);
        self::assertSame(1, $analysis['artifacts']['count']);
        self::assertSame(1, $analysis['instants']['count']);
        self::assertSame(2, $analysis['sorceries']['count']);
        self::assertSame(['Sol Ring'], $analysis['ramp']['cards']);
        self::assertSame(['Divination'], $analysis['draw']['cards']);
        self::assertSame(['Swords to Plowshares'], $analysis['removal']['cards']);
        self::assertSame(['Wrath of God'], $analysis['wipes']['cards']);
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
            'image_uris' => [],
            'layout' => 'normal',
        ], $overrides));

        return $card;
    }
}
