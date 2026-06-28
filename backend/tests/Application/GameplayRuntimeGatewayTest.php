<?php

namespace App\Tests\Application;

use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\Runtime\GameRuntimeCommandClientInterface;
use App\Application\Game\Runtime\GameRuntimeCommandResult;
use App\Application\Game\Runtime\GameRuntimeGatewayException;
use App\Application\Game\Runtime\GameplayRuntimeGateway;
use App\Application\Game\Runtime\GameplayRuntimePatchAdapter;
use App\Application\Game\Runtime\GameplayRuntimePatchContractException;
use App\Application\Game\Runtime\GameplayRuntimeRouter;
use PHPUnit\Framework\TestCase;

final class GameplayRuntimeGatewayTest extends TestCase
{
    public function testAllowlistedCommandDispatchesRuntimePrimaryAndNormalizesPatchContract(): void
    {
        $client = new GatewayRuntimeClientStub();
        $gateway = new GameplayRuntimeGateway(
            new GameplayRuntimeRouter($this->flags(runtime: true, shadow: false, allowlist: 'library.draw'), $client),
            new GameplayRuntimePatchAdapter(),
        );

        $result = $gateway->dispatchPrimary('library.draw', 'game-1', 'player-1', 1, 'action-1', $this->snapshot(), ['playerId' => 'player-1']);

        self::assertSame('library.draw', $client->types[0] ?? null);
        self::assertFalse($client->shadowCalls[0] ?? true);
        self::assertSame('zone.cards.add', $result->patches[0]['ops'][0]['op']);
        self::assertArrayNotHasKey('data', $result->patches[0]['ops'][0]);
    }

    public function testNonAllowlistedCommandDoesNotDispatchRuntimePrimary(): void
    {
        $client = new GatewayRuntimeClientStub();
        $gateway = new GameplayRuntimeGateway(
            new GameplayRuntimeRouter($this->flags(runtime: true, shadow: false, allowlist: 'mulligan.take'), $client),
            new GameplayRuntimePatchAdapter(),
        );

        $this->expectException(GameRuntimeGatewayException::class);
        $gateway->dispatchPrimary('library.draw', 'game-1', 'player-1', 1, 'action-1', $this->snapshot(), ['playerId' => 'player-1']);
    }

    public function testShadowModeDispatchesRuntimeWithoutPrimaryRoute(): void
    {
        $client = new GatewayRuntimeClientStub();
        $gateway = new GameplayRuntimeGateway(
            new GameplayRuntimeRouter($this->flags(runtime: false, shadow: true, allowlist: 'library.draw'), $client),
            new GameplayRuntimePatchAdapter(),
        );

        $gateway->dispatchShadow('library.draw', 'game-1', 'player-1', 1, 'action-1', $this->snapshot(), ['playerId' => 'player-1']);

        self::assertTrue($client->shadowCalls[0] ?? false);
    }

    public function testPatchContractErrorIsControlled(): void
    {
        $client = new GatewayRuntimeClientStub(invalidPatch: true);
        $gateway = new GameplayRuntimeGateway(
            new GameplayRuntimeRouter($this->flags(runtime: true, shadow: false, allowlist: 'library.draw'), $client),
            new GameplayRuntimePatchAdapter(),
        );

        $this->expectException(GameplayRuntimePatchContractException::class);
        $gateway->dispatchPrimary('library.draw', 'game-1', 'player-1', 1, 'action-1', $this->snapshot(), ['playerId' => 'player-1']);
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

    /**
     * @return array<string,mixed>
     */
    private function snapshot(): array
    {
        return ['version' => 1, 'gamePhase' => 'PLAYING', 'players' => [], 'turn' => []];
    }
}

final class GatewayRuntimeClientStub implements GameRuntimeCommandClientInterface
{
    /** @var list<string> */
    public array $types = [];

    /** @var list<bool> */
    public array $shadowCalls = [];

    public function __construct(private readonly bool $invalidPatch = false)
    {
    }

    public function dispatch(
        string $type,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $snapshot,
        array $payload,
        bool $shadow = false,
    ): GameRuntimeCommandResult {
        $this->types[] = $type;
        $this->shadowCalls[] = $shadow;

        return new GameRuntimeCommandResult(
            ['gameId' => $gameId, 'version' => $baseVersion + 1, 'type' => $type, 'payload' => $payload],
            [[
                'gameId' => $gameId,
                ...($this->invalidPatch ? [] : ['version' => $baseVersion + 1]),
                'visibility' => 'player:'.$actorId,
                'ops' => [['op' => 'zone.cards.add', 'data' => ['playerId' => $actorId, 'zone' => 'hand', 'cards' => []]]],
            ]],
        );
    }
}
