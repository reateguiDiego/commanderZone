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

        self::assertFalse($result['valid']);
        self::assertSame('commander', $result['format']);
        self::assertSame('invalid', $result['commander']['mode']);
        self::assertNotEmpty($result['errors']);
        self::assertContains('deck.size.invalid', $errorCodes);
        self::assertContains('commander.pair_unsupported', $errorCodes);
        self::assertContains('card.commander_banned', $errorCodes);
        self::assertContains('card.singleton_violation', $errorCodes);
        self::assertContains('card.color_identity_violation', $errorCodes);
        self::assertSame([], $result['warnings']);
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

    public function testSideboardAndMaybeboardDoNotBlockCommanderValidation(): void
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

        self::assertTrue($result['valid']);
        self::assertSame(100, $result['counts']['total']);
        self::assertSame(15, $result['counts']['sideboard']);
        self::assertSame(4, $result['counts']['maybeboard']);
        self::assertSame([], $result['errors']);
    }

    public function testLegendaryNonCreatureWithoutCommanderPermissionIsRejected(): void
    {
        $deck = $this->baseMonoWhiteDeck(99, [
            'type_line' => 'Legendary Artifact',
            'name' => 'Legendary Rock',
        ]);

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertContains('commander.invalid', array_column($result['errors'], 'code'));
    }

    public function testPlaneswalkerWithCommanderPermissionIsAccepted(): void
    {
        $deck = $this->baseMonoWhiteDeck(99, [
            'type_line' => 'Legendary Planeswalker - Test',
            'oracle_text' => 'This planeswalker can be your commander.',
            'name' => 'Allowed Planeswalker',
        ]);

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertTrue($result['valid']);
        self::assertSame('single', $result['commander']['mode']);
    }

    public function testLegendaryPlaneswalkerWithoutCommanderPermissionIsRejected(): void
    {
        $deck = $this->baseMonoWhiteDeck(99, [
            'type_line' => 'Legendary Planeswalker - Test',
            'oracle_text' => '+1: Draw a card.',
            'name' => 'Regular Planeswalker',
        ]);

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertContains('commander.invalid', array_column($result['errors'], 'code'));
    }

    public function testBackgroundAloneIsRejectedAsCommander(): void
    {
        $deck = $this->baseMonoWhiteDeck(99, [
            'type_line' => 'Legendary Enchantment - Background',
            'oracle_text' => 'Commander creatures you own get +1/+1.',
            'name' => 'Lonely Background',
        ]);

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertContains('commander.invalid', array_column($result['errors'], 'code'));
    }

    public function testChooseBackgroundPairRequiresBackgroundType(): void
    {
        $validDeck = new Deck(new User('background-valid@example.test', 'Background Valid'), 'Background Deck');
        $validDeck->addCard(new DeckCard($validDeck, $this->card('00000000-0000-0000-0000-000000000341', 'Background Chooser', [
            'type_line' => 'Legendary Creature - Human',
            'oracle_text' => 'Choose a Background',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $validDeck->addCard(new DeckCard($validDeck, $this->card('00000000-0000-0000-0000-000000000342', 'Real Background', [
            'type_line' => 'Legendary Enchantment - Background',
            'oracle_text' => 'Commander creatures you own get +1/+1.',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $validDeck->addCard(new DeckCard($validDeck, $this->card('00000000-0000-0000-0000-000000000343', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => ['W'],
            'mana_cost' => '',
        ]), 98));

        $validResult = (new CommanderDeckValidator())->validate($validDeck);
        self::assertTrue($validResult['valid']);
        self::assertSame('pair', $validResult['commander']['mode']);

        $invalidDeck = new Deck(new User('background-invalid@example.test', 'Background Invalid'), 'Invalid Background Deck');
        $invalidDeck->addCard(new DeckCard($invalidDeck, $this->card('00000000-0000-0000-0000-000000000344', 'Background Chooser Invalid', [
            'type_line' => 'Legendary Creature - Human',
            'oracle_text' => 'Choose a Background',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $invalidDeck->addCard(new DeckCard($invalidDeck, $this->card('00000000-0000-0000-0000-000000000345', 'Not A Background', [
            'type_line' => 'Legendary Enchantment',
            'oracle_text' => 'The word background appears here but not in the type line.',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $invalidDeck->addCard(new DeckCard($invalidDeck, $this->card('00000000-0000-0000-0000-000000000346', 'Plains Invalid Background', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => ['W'],
            'mana_cost' => '',
        ]), 98));

        $invalidResult = (new CommanderDeckValidator())->validate($invalidDeck);
        self::assertContains('commander.pair_unsupported', array_column($invalidResult['errors'], 'code'));
    }

    public function testPartnerWithRequiresReciprocalNamedPair(): void
    {
        $validDeck = new Deck(new User('partner-with-valid@example.test', 'Partner With Valid'), 'Partner With Deck');
        $validDeck->addCard(new DeckCard($validDeck, $this->card('00000000-0000-0000-0000-000000000351', 'Alpha Partner', [
            'type_line' => 'Legendary Creature - Human',
            'oracle_text' => 'Partner with Beta Partner',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $validDeck->addCard(new DeckCard($validDeck, $this->card('00000000-0000-0000-0000-000000000352', 'Beta Partner', [
            'type_line' => 'Legendary Creature - Wizard',
            'oracle_text' => 'Partner with Alpha Partner',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $validDeck->addCard(new DeckCard($validDeck, $this->card('00000000-0000-0000-0000-000000000353', 'Plains Partner', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => ['W'],
            'mana_cost' => '',
        ]), 98));

        $validResult = (new CommanderDeckValidator())->validate($validDeck);
        self::assertTrue($validResult['valid']);

        $invalidDeck = new Deck(new User('partner-with-invalid@example.test', 'Partner With Invalid'), 'Invalid Partner With Deck');
        $invalidDeck->addCard(new DeckCard($invalidDeck, $this->card('00000000-0000-0000-0000-000000000354', 'Gamma Partner', [
            'type_line' => 'Legendary Creature - Human',
            'oracle_text' => 'Partner with Missing Partner',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $invalidDeck->addCard(new DeckCard($invalidDeck, $this->card('00000000-0000-0000-0000-000000000355', 'Delta Partner', [
            'type_line' => 'Legendary Creature - Wizard',
            'oracle_text' => 'Partner with Gamma Partner',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $invalidDeck->addCard(new DeckCard($invalidDeck, $this->card('00000000-0000-0000-0000-000000000356', 'Plains Invalid Partner', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => ['W'],
            'mana_cost' => '',
        ]), 98));

        $invalidResult = (new CommanderDeckValidator())->validate($invalidDeck);
        self::assertContains('commander.pair_unsupported', array_column($invalidResult['errors'], 'code'));
    }

    public function testFriendsForeverPairIsAccepted(): void
    {
        $deck = new Deck(new User('friends@example.test', 'Friends'), 'Friends Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000361', 'Friend One', [
            'type_line' => 'Legendary Creature - Human',
            'oracle_text' => 'Friends forever',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000362', 'Friend Two', [
            'type_line' => 'Legendary Creature - Human',
            'oracle_text' => 'Friends forever',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000363', 'Plains Friends', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => ['W'],
            'mana_cost' => '',
        ]), 98));

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertTrue($result['valid']);
        self::assertSame('pair', $result['commander']['mode']);
    }

    public function testDoctorsCompanionPairIsAcceptedWithTimeLordDoctor(): void
    {
        $deck = new Deck(new User('doctor@example.test', 'Doctor'), 'Doctor Deck');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000371', 'The Test Doctor', [
            'type_line' => 'Legendary Creature - Time Lord Doctor',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000372', 'Doctor Companion', [
            'type_line' => 'Legendary Creature - Human',
            'oracle_text' => "Doctor's companion",
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000373', 'Plains Doctor', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => ['W'],
            'mana_cost' => '',
        ]), 98));

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertTrue($result['valid']);
        self::assertSame('pair', $result['commander']['mode']);
    }

    public function testAnyNumberSingletonExceptionIsAccepted(): void
    {
        $deck = $this->baseMonoWhiteDeck(97);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000381', 'Persistent Testers', [
            'oracle_text' => 'A deck can have any number of cards named Persistent Testers.',
        ]), 2));

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertNotContains('card.singleton_violation', array_column($result['errors'], 'code'));
        self::assertTrue($result['valid']);
    }

    public function testUpToCopyLimitSingletonExceptionIsEnforced(): void
    {
        $validDeck = $this->baseMonoWhiteDeck(90);
        $validDeck->addCard(new DeckCard($validDeck, $this->card('00000000-0000-0000-0000-000000000382', 'Nine Testers', [
            'oracle_text' => 'A deck can have up to nine cards named Nine Testers.',
        ]), 9));

        $validResult = (new CommanderDeckValidator())->validate($validDeck);
        self::assertNotContains('card.singleton_violation', array_column($validResult['errors'], 'code'));
        self::assertTrue($validResult['valid']);

        $invalidDeck = $this->baseMonoWhiteDeck(89);
        $invalidDeck->addCard(new DeckCard($invalidDeck, $this->card('00000000-0000-0000-0000-000000000383', 'Nine Testers Invalid', [
            'oracle_text' => 'A deck can have up to nine cards named Nine Testers Invalid.',
        ]), 10));

        $invalidResult = (new CommanderDeckValidator())->validate($invalidDeck);
        self::assertContains('card.singleton_violation', array_column($invalidResult['errors'], 'code'));
    }

    public function testCommanderBanlistOverrideRejectsConspiracyCard(): void
    {
        $deck = $this->baseMonoWhiteDeck(98);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000384', 'Legal Looking Conspiracy', [
            'type_line' => 'Conspiracy',
            'legalities' => ['commander' => 'legal'],
        ]), 1));

        $result = (new CommanderDeckValidator())->validate($deck);

        self::assertContains('card.commander_banned', array_column($result['errors'], 'code'));
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

    public function testSideboardIsIgnoredByCommanderValidity(): void
    {
        $deck = $this->baseMonoWhiteDeck(99);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000311', 'Sideboard Card'), 1, DeckCard::SECTION_SIDEBOARD));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertTrue($result['valid']);
        self::assertSame(1, $result['counts']['sideboard']);
        self::assertSame([], $result['errors']);
    }

    public function testMaybeboardIsIgnoredByCommanderValidity(): void
    {
        $deck = $this->baseMonoWhiteDeck(99);
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000321', 'Maybe Card'), 1, DeckCard::SECTION_MAYBEBOARD));

        $result = (new CommanderDeckValidator())->validate($deck);
        self::assertTrue($result['valid']);
        self::assertSame(1, $result['counts']['maybeboard']);
        self::assertSame([], $result['errors']);
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
