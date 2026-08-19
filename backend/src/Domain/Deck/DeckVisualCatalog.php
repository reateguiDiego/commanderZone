<?php

namespace App\Domain\Deck;

final class DeckVisualCatalog
{
    private const COMBINATION_NAMES = [
        'abzan', 'azorius', 'bant', 'boros', 'dimir', 'dune', 'esper', 'glint', 'golgari', 'grixis',
        'gruul', 'ink', 'izzet', 'jeskai', 'jund', 'mardu', 'naya', 'orzhov', 'rakdos', 'selesnya',
        'simic', 'sultai', 'temur', 'witch',
    ];

    public static function isSupportedBackgroundName(string $name): bool
    {
        return $name === Deck::DEFAULT_BACKGROUND_NAME
            || self::matchesPlaymatName($name);
    }

    public static function isSupportedSleevesName(string $name): bool
    {
        return $name === Deck::DEFAULT_SLEEVES_NAME
            || self::matchesSleeveName($name);
    }

    private static function matchesPlaymatName(string $name): bool
    {
        return preg_match('/^free_[0-5]$/', $name) === 1
            || preg_match('/^free_[wubrgn]_[1-3]$/', $name) === 1
            || preg_match('/^[wubrg]_(?:[1-9]|10)$/', $name) === 1
            || preg_match('/^[no]_(?:[1-9]|1[01])$/', $name) === 1
            || self::matchesCombinationName($name);
    }

    private static function matchesSleeveName(string $name): bool
    {
        return preg_match('/^[wubrg]_(?:[0-9]|1[01])$/', $name) === 1
            || preg_match('/^n_(?:[0-9]|1[0-2])$/', $name) === 1
            || preg_match('/^o_(?:[0-9]|1[01])$/', $name) === 1
            || self::matchesCombinationName($name);
    }

    private static function matchesCombinationName(string $name): bool
    {
        if (preg_match('/^(.+)_([1-2])$/', $name, $matches) !== 1) {
            return false;
        }

        $combinationName = $matches[1];
        $index = (int) $matches[2];

        return ($index === 1 && in_array($combinationName, self::COMBINATION_NAMES, true))
            || ($index <= 2 && in_array($combinationName, ['penta', 'yore'], true));
    }
}
