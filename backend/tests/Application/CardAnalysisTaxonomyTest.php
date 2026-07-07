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

    public function testRejectsUnsupportedRole(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Unsupported card analysis role');

        CardAnalysisTaxonomy::assertRole('mana_acceleration');
    }

    public function testRejectsUnsupportedCondition(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Unsupported card analysis condition');

        CardAnalysisTaxonomy::assertCondition('requires_good_cards');
    }
}
