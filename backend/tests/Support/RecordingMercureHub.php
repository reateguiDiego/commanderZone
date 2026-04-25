<?php

namespace App\Tests\Support;

use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Jwt\TokenFactoryInterface;
use Symfony\Component\Mercure\Update;

class RecordingMercureHub implements HubInterface
{
    /**
     * @var list<array{topics:array<int,string>,data:string}>
     */
    private static array $updates = [];

    public static function reset(): void
    {
        self::$updates = [];
    }

    /**
     * @return list<array{topics:array<int,string>,data:string}>
     */
    public static function updates(): array
    {
        return self::$updates;
    }

    public function getPublicUrl(): string
    {
        return 'https://mercure.test/.well-known/mercure';
    }

    public function getFactory(): ?TokenFactoryInterface
    {
        return null;
    }

    public function publish(Update $update): string
    {
        self::$updates[] = [
            'topics' => $update->getTopics(),
            'data' => $update->getData(),
        ];

        return 'recorded';
    }
}
