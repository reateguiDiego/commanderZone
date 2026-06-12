<?php

namespace App\Tests\Application;

use App\Application\Deck\CommanderDeckValidator;
use App\Application\Deck\DeckValidator;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class DeckValidatorTest extends TestCase
{
    public function testValidatesCommanderDeckUsingDeckFormat(): void
    {
        $deck = new Deck(new User('format-validator@example.test', 'Format Validator'), 'Commander Deck');
        $deck->setFormat('commander');
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000401', 'Mono White Commander', [
            'type_line' => 'Legendary Creature - Human',
            'color_identity' => ['W'],
        ]), 1, DeckCard::SECTION_COMMANDER));
        $deck->addCard(new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000402', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => ['W'],
            'mana_cost' => '',
        ]), 99));

        $result = (new DeckValidator(new CommanderDeckValidator()))->validate($deck);

        self::assertTrue($result['valid']);
        self::assertSame('commander', $result['format']);
        self::assertSame('single', $result['commander']['mode']);
    }

    public function testUnsupportedDeckFormatReturnsInvalidResult(): void
    {
        $deck = new class extends Deck {
            public function __construct()
            {
                parent::__construct(new User('unsupported-format@example.test', 'Unsupported Format'), 'Unsupported Deck');
            }

            public function format(): string
            {
                return 'modern';
            }
        };

        $result = (new DeckValidator(new CommanderDeckValidator()))->validate($deck);

        self::assertFalse($result['valid']);
        self::assertSame('modern', $result['format']);
        self::assertSame(['deck.format.unsupported'], array_column($result['errors'], 'code'));
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
