<?php

namespace App\Application\Game;

use Random\Engine\Secure;
use Random\Randomizer;

class GameRandomizer
{
    private Randomizer $randomizer;

    public function __construct(?Randomizer $randomizer = null)
    {
        $this->randomizer = $randomizer ?? new Randomizer(new Secure());
    }

    public function intBetween(int $min, int $max): int
    {
        if ($max < $min) {
            throw new \InvalidArgumentException('Random range is invalid.');
        }

        return $this->randomizer->getInt($min, $max);
    }

    public function pickIndex(int $count): int
    {
        if ($count <= 0) {
            throw new \InvalidArgumentException('Cannot pick from an empty list.');
        }

        return $this->intBetween(0, $count - 1);
    }

    /**
     * @template T
     *
     * @param list<T> $items
     *
     * @return T
     */
    public function pickOne(array $items): mixed
    {
        if ($items === []) {
            throw new \InvalidArgumentException('Cannot pick from an empty list.');
        }

        return $items[$this->pickIndex(count($items))];
    }

    /**
     * @template T
     *
     * @param list<T> $items
     *
     * @return list<T>
     */
    public function shuffle(array $items): array
    {
        $shuffled = array_values($items);
        for ($index = count($shuffled) - 1; $index > 0; --$index) {
            $swapIndex = $this->pickIndex($index + 1);
            [$shuffled[$index], $shuffled[$swapIndex]] = [$shuffled[$swapIndex], $shuffled[$index]];
        }

        return $shuffled;
    }

    public function roll(string $kind): string|int
    {
        return match ($kind) {
            'coin' => $this->intBetween(0, 1) === 0 ? 'Cara' : 'Cruz',
            'd4' => $this->intBetween(1, 4),
            'd6' => $this->intBetween(1, 6),
            'd10' => $this->intBetween(1, 10),
            'd20' => $this->intBetween(1, 20),
            default => throw new \InvalidArgumentException('Unsupported random roll kind.'),
        };
    }
}
