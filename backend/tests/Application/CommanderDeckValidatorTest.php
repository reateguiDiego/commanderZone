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
    public function testReturnsStructuredContractAndCommanderErrors(): void
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
        $errorCodes = array_column($result['errors'], 'code');
        $warningCodes = array_column($result['warnings'], 'code');

        self::assertFalse($result['valid']);
        self::assertSame('commander', $result['format']);
        self::assertSame('invalid', $result['commander']['mode']);
        self::assertNotEmpty($result['errors']);
        self::assertContains('deck.size.invalid', $errorCodes);
        self::assertContains('commander.pair_unsupported', $errorCodes);
        self::assertContains('card.commander_banned', $errorCodes);
        self::assertContains('card.singleton_violation', $errorCodes);
        self::assertContains('card.color_identity_violation', $errorCodes);
        self::assertContains('card.layout_review', $warningCodes);
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
        self::assertSame('pair', $result['commander']['mode']);
        self::assertSame([], $result['errors']);
        self::assertSame([], $result['warnings']);
        self::assertSame(100, $result['counts']['total']);
    }

    public function testSideboardAndMaybeboardNowBlockCommanderValidation(): void
    {
        $deck = new Deck(new User('sections@example.test', 'Sections'), 'Sections Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000221', 'Mono White Commander', [
            'type_line' => 'Legendary Creature - Human',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000222', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'mana_cost' => '',
        ]), 99));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000223', 'Sideboard Red Spell', [
            'color_identity' => ['R'],
        ]), 15, DeckCard::SECTION_SIDEBOARD));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000224', 'Maybe Banned Spell', [
            'legalities' => ['commander' => 'banned'],
        ]), 4, DeckCard::SECTION_MAYBEBOARD));

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertFalse($result['valid']);
        self::assertContains('deck.sideboard_not_allowed', array_column($result['errors'], 'code'));
        self::assertContains('deck.maybeboard_not_allowed', array_column($result['errors'], 'code'));
    }

    public function testFlagsDataInsufficientAsError(): void
    {
        $deck = new Deck(new User('data@example.test', 'Data'), 'Data Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000231', 'Data Commander', [
            'type_line' => 'Legendary Creature - Human',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000232', 'Unknown Legality Card', [
            'legalities' => [],
        ]), 99));

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertFalse($result['valid']);
        self::assertContains('card.data_insufficient', array_column($result['errors'], 'code'));
    }

    public function testDeckSizeInvalidWhenNinetyNineCards(): void
    {
        $deck = $this->baseMonoWhiteDeck(98);
        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertFalse($result['valid']);
        self::assertContains('deck.size.invalid', array_column($result['errors'], 'code'));
    }

    public function testDeckSizeInvalidWhenOneHundredAndOneCards(): void
    {
        $deck = $this->baseMonoWhiteDeck(100);
        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertFalse($result['valid']);
        self::assertContains('deck.size.invalid', array_column($result['errors'], 'code'));
    }

    public function testMissingCommanderIsRejected(): void
    {
        $deck = new Deck(new User('missing@example.test', 'Missing Commander'), 'Missing Commander Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000241', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => ['W'],
            'mana_cost' => '',
        ]), 100));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('commander.missing', array_column($result['errors'], 'code'));
    }

    public function testNonLegendaryCommanderIsRejected(): void
    {
        $deck = $this->baseMonoWhiteDeck(99, [
            'type_line' => 'Artifact',
            'name' => 'Not Legendary Commander',
        ]);

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('commander.invalid', array_column($result['errors'], 'code'));
    }

    public function testUnsupportedCommanderPairIsRejected(): void
    {
        $deck = new Deck(new User('pair@example.test', 'Unsupported Pair'), 'Unsupported Pair Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000251', 'Commander Alpha', [
            'type_line' => 'Legendary Creature - Human',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000252', 'Commander Beta', [
            'type_line' => 'Legendary Creature - Wizard',
            'color_identity' => ['U'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000253', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => ['U'],
            'mana_cost' => '',
        ]), 98));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('commander.pair_unsupported', array_column($result['errors'], 'code'));
    }

    public function testMoreThanTwoCommandersIsRejected(): void
    {
        $deck = new Deck(new User('many@example.test', 'Too Many Commanders'), 'Too Many Commanders Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000261', 'Commander One', [
            'type_line' => 'Legendary Creature - Human',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000262', 'Commander Two', [
            'type_line' => 'Legendary Creature - Human',
            'color_identity' => ['U'],
            'oracle_text' => 'Partner',
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000263', 'Commander Three', [
            'type_line' => 'Legendary Creature - Human',
            'color_identity' => ['B'],
            'oracle_text' => 'Partner',
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000264', 'Swamp', [
            'type_line' => 'Basic Land - Swamp',
            'color_identity' => ['B'],
            'mana_cost' => '',
        ]), 97));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('commander.too_many', array_column($result['errors'], 'code'));
    }

    public function testBannedCardIsRejected(): void
    {
        $deck = $this->baseMonoWhiteDeck(98);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000271', 'Banned Card', [
            'legalities' => ['commander' => 'banned'],
        ]), 1));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('card.commander_banned', array_column($result['errors'], 'code'));
    }

    public function testNotLegalCardIsRejected(): void
    {
        $deck = $this->baseMonoWhiteDeck(98);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000281', 'Not Legal Card', [
            'legalities' => ['commander' => 'not_legal'],
        ]), 1));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('card.commander_not_legal', array_column($result['errors'], 'code'));
    }

    public function testSingletonViolationForNonBasicCards(): void
    {
        $deck = $this->baseMonoWhiteDeck(97);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000291', 'Sol Ring', [
            'type_line' => 'Artifact',
        ]), 2));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('card.singleton_violation', array_column($result['errors'], 'code'));
    }

    public function testColorIdentityViolationIsRejected(): void
    {
        $deck = $this->baseMonoWhiteDeck(98);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000301', 'Red Spell', [
            'color_identity' => ['R'],
        ]), 1));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('card.color_identity_violation', array_column($result['errors'], 'code'));
    }

    public function testSideboardNotAllowedIsRejected(): void
    {
        $deck = $this->baseMonoWhiteDeck(99);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000311', 'Sideboard Card'), 1, DeckCard::SECTION_SIDEBOARD));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('deck.sideboard_not_allowed', array_column($result['errors'], 'code'));
    }

    public function testMaybeboardNotAllowedIsRejected(): void
    {
        $deck = $this->baseMonoWhiteDeck(99);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000321', 'Maybe Card'), 1, DeckCard::SECTION_MAYBEBOARD));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertContains('deck.maybeboard_not_allowed', array_column($result['errors'], 'code'));
    }

    private function baseMonoWhiteDeck(int $mainCount, array $commanderOverrides = []): Deck
    {
        $deck = new Deck(new User('base@example.test', 'Base'), 'Base Mono White Deck');
        $deck->addCard(new DeckCard($deck, $this->card(
            '00000000-0000-0000-0000-000000000331',
            (string) ($commanderOverrides['name'] ?? 'Mono White Commander'),
            array_replace([
                'type_line' => 'Legendary Creature - Human',
                'color_identity' => ['W'],
            ], $commanderOverrides),
        ), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000332', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => ['W'],
            'mana_cost' => '',
        ]), $mainCount));

        return $deck;
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
