<?php

namespace App\Application\Deck;

final class DeckFormatCatalog
{
    public const COMMANDER = 'commander';

    /**
     * @var list<array{id:string,name:string,minCards:int,maxCards:int,hasCommander:bool}>
     */
    private const FORMATS = [
        [
            'id' => self::COMMANDER,
            'name' => 'Commander',
            'minCards' => 100,
            'maxCards' => 100,
            'hasCommander' => true,
        ],
    ];

    /**
     * @return list<array{id:string,name:string,minCards:int,maxCards:int,hasCommander:bool}>
     */
    public static function all(): array
    {
        return self::FORMATS;
    }

    public static function defaultId(): string
    {
        return self::COMMANDER;
    }

    public static function normalize(mixed $format): ?string
    {
        $normalized = strtolower(trim((string) $format));

        return self::exists($normalized) ? $normalized : null;
    }

    public static function exists(string $format): bool
    {
        foreach (self::FORMATS as $definition) {
            if ($definition['id'] === $format) {
                return true;
            }
        }

        return false;
    }
}
