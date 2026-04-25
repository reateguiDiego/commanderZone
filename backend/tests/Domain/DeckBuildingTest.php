<?php

namespace App\Tests\Domain;

use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\Deck\DeckFolder;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class DeckBuildingTest extends TestCase
{
    public function testDeckCanBeAssignedAndRemovedFromFolder(): void
    {
        $user = new User('player@example.test', 'Player');
        $folder = new DeckFolder($user, 'Commander');
        $deck = new Deck($user, 'Atraxa');

        $deck->moveToFolder($folder);
        self::assertSame($folder->id(), $deck->toArray()['folderId']);

        $deck->moveToFolder(null);
        self::assertNull($deck->toArray()['folderId']);
    }

    public function testAddingExistingCardInSameSectionIncrementsQuantity(): void
    {
        $deck = new Deck(new User('player@example.test', 'Player'), 'Atraxa');
        $card = $this->card('00000000-0000-0000-0000-000000000001', 'Sol Ring');

        $first = $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
        $second = $deck->addOrIncrementCard($card, 2, DeckCard::SECTION_MAIN);

        self::assertSame($first, $second);
        self::assertSame(3, $first->quantity());
        self::assertCount(1, $deck->cards());
    }

    public function testCardCanMoveBetweenSections(): void
    {
        $deck = new Deck(new User('player@example.test', 'Player'), 'Atraxa');
        $deckCard = new DeckCard($deck, $this->card('00000000-0000-0000-0000-000000000002', 'Atraxa'), 1);

        $deckCard->moveToSection(DeckCard::SECTION_COMMANDER);

        self::assertSame(DeckCard::SECTION_COMMANDER, $deckCard->section());
    }

    public function testInvalidSectionIsRejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        new DeckCard(
            new Deck(new User('player@example.test', 'Player'), 'Atraxa'),
            $this->card('00000000-0000-0000-0000-000000000003', 'Island'),
            1,
            'sideboard'
        );
    }

    private function card(string $scryfallId, string $name): Card
    {
        $card = new Card($scryfallId);
        $card->updateFromScryfall([
            'name' => $name,
            'type_line' => 'Artifact',
            'legalities' => ['commander' => 'legal'],
        ]);

        return $card;
    }
}
