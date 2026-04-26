<?php

namespace App\Tests\Application;

use App\Application\Deck\CommanderDeckValidator;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class CommanderDeckValidatorTest extends TestCase
{
    public function testReturnsStructuredIssuesAndCompatibilityErrors(): void
    {
        $deck = new Deck(new User('validator@example.test', 'Validator'), 'Problem Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000201', 'Commander One', [
            'type_line' => 'Legendary Creature - Human',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000202', 'Commander Two', [
            'type_line' => 'Legendary Creature - Wizard',
            'color_identity' => ['U'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000203', 'Banned Spell', [
            'legalities' => ['commander' => 'banned'],
        ]), 1));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000204', 'Sol Ring'), 2));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000205', 'Lightning Bolt', [
            'color_identity' => ['R'],
        ]), 1));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000206', 'Bala Ged Recovery // Bala Ged Sanctuary', [
            'layout' => 'modal_dfc',
        ]), 1));

        $result = (new CommanderDeckValidator())->validate($deck);
        $titles = array_column($result['issues'], 'title');

        self::assertFalse($result['valid']);
        self::assertNotEmpty($result['errors']);
        self::assertContains('Invalid deck size', $titles);
        self::assertContains('Commander pair needs review', $titles);
        self::assertContains('Commander legality issue', $titles);
        self::assertContains('Singleton violation', $titles);
        self::assertContains('Color identity issue', $titles);
        self::assertContains('MDFC/layout review', $titles);
    }

    public function testAcceptsObviousPartnerCommanderPair(): void
    {
        $deck = new Deck(new User('partner@example.test', 'Partner'), 'Partner Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000211', 'Partner One', [
            'type_line' => 'Legendary Creature - Human',
            'oracle_text' => 'Partner',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000212', 'Partner Two', [
            'type_line' => 'Legendary Creature - Wizard',
            'oracle_text' => 'Partner',
            'color_identity' => ['U'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000213', 'Island', [
            'type_line' => 'Basic Land - Island',
            'mana_cost' => '',
        ]), 98));

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertTrue($result['valid']);
        self::assertSame([], $result['errors']);
        self::assertSame([], $result['issues']);
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
