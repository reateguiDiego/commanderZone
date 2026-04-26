<?php

namespace App\Tests\Application;

use App\Application\Deck\DecklistExporter;
use App\Application\Deck\DecklistParser;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class DecklistExporterTest extends TestCase
{
    public function testExportsPlainMoxfieldAndArchidektText(): void
    {
        $deck = new Deck(new User('export@example.test', 'Export'), 'Atraxa Tools');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000301', "Atraxa, Praetors' Voice", [
            'set' => '2x2',
            'collector_number' => '190',
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000302', 'Sol Ring', [
            'set' => 'cmm',
            'collector_number' => '703',
        ]), 1));

        $exporter = new DecklistExporter();

        self::assertSame(<<<'TXT'
Commander
1 Atraxa, Praetors' Voice

Deck
1 Sol Ring
TXT, str_replace("\r\n", "\n", $exporter->export($deck, DecklistParser::FORMAT_PLAIN)['content']));

        self::assertStringContainsString("1x Atraxa, Praetors' Voice (2X2) 190", $exporter->export($deck, DecklistParser::FORMAT_MOXFIELD)['content']);
        self::assertStringContainsString('Commanders', $exporter->export($deck, DecklistParser::FORMAT_ARCHIDEKT)['content']);
        self::assertStringContainsString('Mainboard', $exporter->export($deck, DecklistParser::FORMAT_ARCHIDEKT)['content']);
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
