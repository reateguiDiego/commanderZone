<?php

namespace App\Tests\Application;

use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\Runtime\GameRuntimeCommandClientInterface;
use App\Application\Game\Runtime\GameRuntimeCommandResult;
use App\Application\Game\Runtime\GameplayCommandCatalog;
use App\Application\Game\Runtime\GameplayRuntimeRoute;
use App\Application\Game\Runtime\GameplayRuntimeRouter;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class GameplayRuntimeRouterTest extends TestCase
{
    public function testAllowlistedCommandRoutesToRuntimePrimaryWhenRuntimeEnabled(): void
    {
        $router = new GameplayRuntimeRouter($this->flags(runtime: true, shadow: false, allowlist: 'library.draw'), new RuntimeCommandClientStub());

        self::assertSame(GameplayRuntimeRoute::RuntimePrimary, $router->routeFor('library.draw'));
    }

    public function testNonAllowlistedCommandStaysLegacyOnly(): void
    {
        $router = new GameplayRuntimeRouter($this->flags(runtime: true, shadow: false, allowlist: 'mulligan.take'), new RuntimeCommandClientStub());

        self::assertSame(GameplayRuntimeRoute::LegacyOnly, $router->routeFor('library.draw'));
    }

    #[DataProvider('legacyAliases')]
    public function testLegacyAliasesRouteThroughCanonicalAllowlist(string $alias, string $canonical): void
    {
        $router = new GameplayRuntimeRouter($this->flags(runtime: true, shadow: false, allowlist: $canonical), new RuntimeCommandClientStub());

        self::assertSame(GameplayRuntimeRoute::RuntimePrimary, $router->routeFor($alias));
    }

    public function testAliasInAllowlistDoesNotSilentlyEnableRuntimeRoute(): void
    {
        $router = new GameplayRuntimeRouter($this->flags(runtime: true, shadow: false, allowlist: 'zone.changed'), new RuntimeCommandClientStub());

        self::assertSame(GameplayRuntimeRoute::LegacyOnly, $router->routeFor('zone.changed'));
    }

    public function testEmptyAllowlistStaysLegacyOnlyEvenWhenRuntimeEnabled(): void
    {
        $router = new GameplayRuntimeRouter($this->flags(runtime: true, shadow: false, allowlist: ''), new RuntimeCommandClientStub());

        self::assertSame(GameplayRuntimeRoute::LegacyOnly, $router->routeFor('library.draw'));
    }

    public function testShadowModeRoutesToShadowWithoutRuntimePrimary(): void
    {
        $router = new GameplayRuntimeRouter($this->flags(runtime: false, shadow: true, allowlist: 'library.draw'), new RuntimeCommandClientStub());

        self::assertSame(GameplayRuntimeRoute::Shadow, $router->routeFor('library.draw'));
    }

    public function testMissingRuntimeClientKeepsLegacyOnly(): void
    {
        $router = new GameplayRuntimeRouter($this->flags(runtime: true, shadow: false, allowlist: 'library.draw'), null);

        self::assertSame(GameplayRuntimeRoute::LegacyOnly, $router->routeFor('library.draw'));
    }

    #[DataProvider('runtimeSensitiveCommands')]
    public function testMigratedSensitiveCommandsRouteToRuntimeWhenAllowlisted(string $commandType): void
    {
        $router = new GameplayRuntimeRouter($this->flags(runtime: true, shadow: true, allowlist: $commandType), new RuntimeCommandClientStub());

        self::assertSame(GameplayRuntimeRoute::RuntimePrimary, $router->routeFor($commandType));
    }

    /**
     * @return iterable<string,array{string}>
     */
    public static function runtimeSensitiveCommands(): iterable
    {
        yield 'face down' => ['card.face_down.changed'];
        yield 'face changed' => ['card.face.changed'];
        yield 'revealed' => ['card.revealed'];
        yield 'controller changed' => ['card.controller.changed'];
        yield 'library reveal' => ['library.reveal'];
        yield 'play top revealed' => ['library.play_top_revealed'];
    }

    /**
     * @return iterable<string,array{string,string}>
     */
    public static function legacyAliases(): iterable
    {
        foreach (GameplayCommandCatalog::aliases() as $alias => $canonical) {
            yield $alias => [$alias, $canonical];
        }
    }

    private function flags(bool $runtime, bool $shadow, string $allowlist): GameplayV2Flags
    {
        return new GameplayV2Flags(
            commandEnabled: false,
            patchEnabled: false,
            bootstrapEnabled: false,
            eventEnabled: false,
            visibilityEnabled: false,
            enabled: true,
            commandsAllowlist: $allowlist,
            runtimeServiceEnabled: $runtime,
            semanticPatchesEnabled: true,
            compactBootstrapEnabled: true,
            shadowCompareEnabled: $shadow,
        );
    }
}

final class RuntimeCommandClientStub implements GameRuntimeCommandClientInterface
{
    public function dispatch(
        string $type,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $payload,
        bool $shadow = false,
    ): GameRuntimeCommandResult {
        return new GameRuntimeCommandResult([], []);
    }
}
