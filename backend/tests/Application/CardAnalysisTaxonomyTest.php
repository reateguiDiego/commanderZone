<?php

namespace App\Tests\Application;

use App\Application\Deck\CardAnalysisTaxonomy;
use PHPUnit\Framework\TestCase;

final class CardAnalysisTaxonomyTest extends TestCase
{
    public function testAcceptsSupportedRolesAndConditions(): void
    {
        self::assertSame('ramp', CardAnalysisTaxonomy::assertRole('ramp'));
        self::assertSame('board_wipe', CardAnalysisTaxonomy::assertRole(' BOARD_WIPE '));
        self::assertSame('requires_low_curve', CardAnalysisTaxonomy::assertCondition('requires_low_curve'));
        self::assertContains('combo_piece', CardAnalysisTaxonomy::roles());
        self::assertContains('requires_combo_plan', CardAnalysisTaxonomy::conditions());
    }

    public function testRejectsUnsupportedRolesAndConditions(): void
    {
        $this->assertInvalidTaxonomyValue(
            static fn () => CardAnalysisTaxonomy::assertRole('mana_acceleration'),
            'Unsupported card analysis role',
        );
        $this->assertInvalidTaxonomyValue(
            static fn () => CardAnalysisTaxonomy::assertCondition('requires_good_cards'),
            'Unsupported card analysis condition',
        );
    }

    private function assertInvalidTaxonomyValue(callable $assertion, string $expectedMessage): void
    {
        try {
            $assertion();
            self::fail('Expected unsupported taxonomy value to be rejected.');
        } catch (\InvalidArgumentException $exception) {
            self::assertStringContainsString($expectedMessage, $exception->getMessage());
        }
    }
}
