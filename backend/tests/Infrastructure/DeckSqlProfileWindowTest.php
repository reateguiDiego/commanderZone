<?php

namespace App\Tests\Infrastructure;

use App\Infrastructure\Observability\DeckSqlProfileWindow;
use App\Infrastructure\Observability\RequestPerformanceContext;
use PHPUnit\Framework\TestCase;

final class DeckSqlProfileWindowTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir().'/cz-profile-'.bin2hex(random_bytes(8));
        mkdir($this->directory);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->directory.'/*') as $file) unlink($file);
        rmdir($this->directory);
    }

    public function testBudgetIsSharedAcrossInstancesAndRequestResets(): void
    {
        $until = (string) (time() + 600);
        for ($i = 0; $i < 40; ++$i) {
            $window = new DeckSqlProfileWindow($this->directory, 'owner', $until);
            self::assertFalse($window->claim('other'));
            $context = new RequestPerformanceContext(null, $window);
            $context->enableDeckSqlProfile('deck-'.($i % 2), 'owner');
            self::assertSame(hash('sha256', 'deck-'.($i % 2)), $context->metrics()['sql_profile_deck']);
            $context->reset();
            self::assertArrayNotHasKey('sql_profile_deck', $context->metrics());
        }
        $context = new RequestPerformanceContext('legacy-slug', new DeckSqlProfileWindow($this->directory, 'owner', $until));
        $context->enableDeckSqlProfile('legacy-slug', 'owner');
        self::assertArrayNotHasKey('sql_profile', $context->metrics());
    }

    public function testExpiredIncompleteAndInvalidWindowsFailClosed(): void
    {
        foreach ([null, '', 'not-a-timestamp', (string) (time() - 1)] as $until) {
            $context = new RequestPerformanceContext('legacy', new DeckSqlProfileWindow($this->directory, 'owner', $until));
            $context->enableDeckSqlProfile('legacy', 'owner');
            self::assertArrayNotHasKey('sql_profile', $context->metrics());
        }
        self::assertFalse((new DeckSqlProfileWindow($this->directory.'/missing', 'owner', (string) (time() + 600)))->claim('owner'));
        self::assertFalse((new DeckSqlProfileWindow($this->directory, null, (string) (time() + 600)))->claim('owner'));
    }
}
