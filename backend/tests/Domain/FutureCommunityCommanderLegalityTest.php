<?php

namespace App\Tests\Domain;

use App\Domain\Card\Card;
use App\Domain\Card\FutureCommunityCommanderLegality;
use PHPUnit\Framework\TestCase;

class FutureCommunityCommanderLegalityTest extends TestCase
{
    public function testItMarksFutureCardsWithOnlyCommunityLegalitiesAsCommanderLegal(): void
    {
        $legalities = FutureCommunityCommanderLegality::normalize([
            'commander' => 'not_legal',
            'future' => 'legal',
            'tlr' => 'legal',
            'modern' => 'not_legal',
        ]);

        self::assertSame('legal', $legalities['commander']);
    }

    public function testItDoesNotOverrideCardsLegalInAnOfficialFormat(): void
    {
        $legalities = FutureCommunityCommanderLegality::normalize([
            'commander' => 'not_legal',
            'future' => 'legal',
            'tlr' => 'legal',
            'standard' => 'legal',
        ]);

        self::assertSame('not_legal', $legalities['commander']);
    }

    public function testCardDerivesTheCommanderLegalityWithoutChangingScryfallData(): void
    {
        $card = new Card('00000000-0000-0000-0000-000000000001');
        $card->updateFromScryfall([
            'name' => 'Ajani, Resolute',
            'legalities' => [
                'commander' => 'not_legal',
                'future' => 'legal',
                'tlr' => 'legal',
            ],
        ]);

        self::assertTrue($card->isCommanderLegal());
        self::assertSame('not_legal', $card->legalities()['commander']);
        self::assertSame('legal', $card->legalityInFormat('commander'));
        self::assertSame('legal', $card->toArray()['legalities']['commander']);
    }
}
