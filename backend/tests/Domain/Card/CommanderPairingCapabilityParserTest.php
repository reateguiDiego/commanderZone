<?php

namespace App\Tests\Domain\Card;

use App\Domain\Card\CommanderPairingAbility;
use App\Domain\Card\CommanderPairingCapabilityParser;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class CommanderPairingCapabilityParserTest extends TestCase
{
    #[DataProvider('genericPartnerTexts')]
    public function testRecognizesGenericPartnerVariants(string $oracleText): void
    {
        $capability = (new CommanderPairingCapabilityParser())->parse($oracleText);

        self::assertSame(CommanderPairingAbility::GenericPartner, $capability->ability);
        self::assertNull($capability->partnerName);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function genericPartnerTexts(): iterable
    {
        yield 'plain partner' => ['Partner'];
        yield 'partner reminder text' => ['Partner (You can have two commanders if both have partner.)'];
        yield 'character select em dash' => ['Partner—Character select (You can have two commanders if both have this ability.)'];
        yield 'future en dash variant' => ['Partner – Future variant (You can have two commanders if both have this ability.)'];
    }

    public function testKeepsPartnerWithBoundToItsNamedCommander(): void
    {
        $capability = (new CommanderPairingCapabilityParser())->parse(
            'Partner with Beta Partner (When this creature enters the battlefield, target player may put Beta Partner into their hand from their library, then shuffle.)',
        );

        self::assertSame(CommanderPairingAbility::NamedPartner, $capability->ability);
        self::assertSame('beta partner', $capability->partnerName);
    }

    #[DataProvider('nonAbilityPartnerTexts')]
    public function testDoesNotTreatReferencesToPartnerAsACommanderPairingAbility(string $oracleText): void
    {
        $capability = (new CommanderPairingCapabilityParser())->parse($oracleText);

        self::assertSame(CommanderPairingAbility::None, $capability->ability);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function nonAbilityPartnerTexts(): iterable
    {
        yield 'rules reference' => ['Creatures you control with partner get +1/+1.'];
        yield 'embedded text' => ['Whenever you cast a spell, choose target partner creature.'];
        yield 'incomplete named partner' => ['Partner with'];
    }
}
