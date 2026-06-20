<?php

namespace App\Tests\Application;

use App\Application\Game\GameMulliganRules;
use App\Domain\Room\Room;
use PHPUnit\Framework\TestCase;

class GameMulliganRulesTest extends TestCase
{
    public function testLondonRules(): void
    {
        $this->assertState(Room::MULLIGAN_LONDON, true, 0, 7, 0, 7, false);
        $this->assertState(Room::MULLIGAN_LONDON, true, 1, 7, 0, 7, false);
        $this->assertState(Room::MULLIGAN_LONDON, true, 2, 7, 1, 6, false);
        $this->assertState(Room::MULLIGAN_LONDON, false, 1, 7, 1, 6, false);
    }

    public function testVancouverRules(): void
    {
        $this->assertState(Room::MULLIGAN_VANCOUVER, true, 0, 7, 0, 7, false);
        $this->assertState(Room::MULLIGAN_VANCOUVER, true, 1, 7, 0, 7, false);
        $this->assertState(Room::MULLIGAN_VANCOUVER, true, 2, 6, 0, 6, true);
        $this->assertState(Room::MULLIGAN_VANCOUVER, true, 3, 5, 0, 5, true);

        foreach (range(0, 7) as $mulligansTaken) {
            $state = GameMulliganRules::calculateMulliganState(Room::MULLIGAN_VANCOUVER, true, $mulligansTaken);

            self::assertSame(0, $state['bottomSelectionCount']);
            self::assertFalse($state['needsBottomSelection']);
            self::assertSame(GameMulliganRules::BOTTOM_ORDER_NONE, $state['bottomOrderMode']);
        }
    }

    public function testParisRules(): void
    {
        $this->assertState(Room::MULLIGAN_PARIS, true, 0, 7, 0, 7, false);
        $this->assertState(Room::MULLIGAN_PARIS, true, 1, 7, 0, 7, false);
        $this->assertState(Room::MULLIGAN_PARIS, true, 2, 6, 0, 6, false);

        foreach (range(0, 7) as $mulligansTaken) {
            $state = GameMulliganRules::calculateMulliganState(Room::MULLIGAN_PARIS, true, $mulligansTaken);

            self::assertSame(0, $state['bottomSelectionCount']);
            self::assertFalse($state['needsBottomSelection']);
            self::assertSame(GameMulliganRules::BOTTOM_ORDER_NONE, $state['bottomOrderMode']);
            self::assertFalse($state['needsScryAfterKeep']);
        }
    }

    public function testGenerousRules(): void
    {
        $this->assertState(Room::MULLIGAN_GENEROUS, true, 0, 10, 3, 7, false);
        $this->assertState(Room::MULLIGAN_GENEROUS, true, 1, 10, 3, 7, false);
        $this->assertState(Room::MULLIGAN_GENEROUS, true, 2, 9, 2, 7, false);
        $this->assertState(Room::MULLIGAN_GENEROUS, true, 3, 8, 1, 7, false);
        $this->assertState(Room::MULLIGAN_GENEROUS, true, 4, 7, 0, 7, false);
        $this->assertState(Room::MULLIGAN_GENEROUS, true, 5, 6, 0, 6, false);

        $this->assertState(Room::MULLIGAN_GENEROUS, false, 0, 10, 3, 7, false);
        $this->assertState(Room::MULLIGAN_GENEROUS, false, 1, 9, 2, 7, false);
        $this->assertState(Room::MULLIGAN_GENEROUS, false, 2, 8, 1, 7, false);

        foreach ([0, 1, 2, 3] as $mulligansTaken) {
            $state = GameMulliganRules::calculateMulliganState(Room::MULLIGAN_GENEROUS, true, $mulligansTaken);

            self::assertGreaterThan(0, $state['bottomSelectionCount']);
            self::assertSame(GameMulliganRules::BOTTOM_ORDER_RANDOM_SERVER_SIDE, $state['bottomOrderMode']);
            self::assertFalse($state['needsScryAfterKeep']);
        }
    }

    private function assertState(
        string $rule,
        bool $firstMulliganFree,
        int $mulligansTaken,
        int $drawCount,
        int $bottomSelectionCount,
        int $finalHandSize,
        bool $needsScryAfterKeep,
    ): void {
        $state = GameMulliganRules::calculateMulliganState($rule, $firstMulliganFree, $mulligansTaken);
        $effectiveMulligans = max(0, $mulligansTaken - ($firstMulliganFree ? 1 : 0));

        self::assertSame($rule, $state['rule']);
        self::assertSame($mulligansTaken, $state['mulligansTaken']);
        self::assertSame($effectiveMulligans, $state['effectiveMulligans']);
        self::assertSame($drawCount, $state['drawCount']);
        self::assertSame($bottomSelectionCount, $state['bottomSelectionCount']);
        self::assertSame($finalHandSize, $state['finalHandSize']);
        self::assertSame($bottomSelectionCount > 0, $state['needsBottomSelection']);
        self::assertSame($needsScryAfterKeep, $state['needsScryAfterKeep']);
    }
}
