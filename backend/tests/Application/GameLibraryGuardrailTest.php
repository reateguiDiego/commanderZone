<?php

namespace App\Tests\Application;

use PHPUnit\Framework\TestCase;

class GameLibraryGuardrailTest extends TestCase
{
    public function testLibraryHotPathDoesNotUseArrayShiftOrArrayUnshiftOutsideLibraryOps(): void
    {
        $files = [
            __DIR__.'/../../src/Application/Game/GameCommandHandler.php',
            __DIR__.'/../../src/Application/Game/GameProjectionService.php',
            __DIR__.'/../../src/Application/Game/GameSnapshotFactory.php',
            __DIR__.'/../../src/Application/Game/WebSocket/GameWebsocketMulliganService.php',
        ];

        foreach ($files as $file) {
            $contents = file_get_contents($file);
            self::assertIsString($contents);
            self::assertSame(0, preg_match('/array_shift\s*\(/', $contents), sprintf('Forbidden array_shift() found in %s', $file));
            self::assertSame(0, preg_match('/array_unshift\s*\(/', $contents), sprintf('Forbidden array_unshift() found in %s', $file));
        }
    }
}
