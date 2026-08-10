<?php

namespace App\Tests\Application;

use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\Runtime\GameRuntimeCommandClientInterface;
use App\Application\Game\Runtime\GameRuntimeCommandResult;
use App\Application\Game\Runtime\GameRuntimeLifecycleCommandService;
use App\Application\Game\Runtime\GameRuntimeVersionConflictException;
use App\Application\Game\Runtime\GameplayRuntimeGateway;
use App\Application\Game\Runtime\GameplayRuntimePatchAdapter;
use App\Application\Game\Runtime\GameplayRuntimeRouter;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

final class GameRuntimeLifecycleCommandServiceTest extends TestCase
{
    public function testLeaveConcedeRetriesSameIdempotencyKeyOnlyAfterSemanticVersionConflict(): void
    {
        $client = new LifecycleRuntimeClientStub();
        $flags = new GameplayV2Flags(
            commandEnabled: true,
            patchEnabled: true,
            bootstrapEnabled: true,
            eventEnabled: true,
            visibilityEnabled: true,
            enabled: true,
            commandsAllowlist: 'game.concede',
            runtimeServiceEnabled: true,
            semanticPatchesEnabled: true,
            compactBootstrapEnabled: true,
            shadowCompareEnabled: false,
        );
        $service = new GameRuntimeLifecycleCommandService(new GameplayRuntimeGateway(
            new GameplayRuntimeRouter($flags, $client),
            new GameplayRuntimePatchAdapter(),
        ));
        $player = new User('lifecycle@example.test', 'Lifecycle');
        $game = new Game(new Room($player), [
            'version' => 3,
            'players' => [$player->id() => ['status' => 'active', 'life' => 40]],
        ]);

        $result = $service->concedeForLeave($game, $player, 'room_leave');

        self::assertSame(10, $result?->event['version']);
        self::assertSame([3, 9], array_column($client->calls, 'baseVersion'));
        self::assertSame($client->calls[0]['clientActionId'], $client->calls[1]['clientActionId']);
        self::assertStringStartsWith('lifecycle:concede:room_leave:', $client->calls[0]['clientActionId']);
    }
}

final class LifecycleRuntimeClientStub implements GameRuntimeCommandClientInterface
{
    /** @var list<array{baseVersion: int, clientActionId: string}> */
    public array $calls = [];

    public function dispatch(
        string $type,
        string $gameId,
        string $actorId,
        int $baseVersion,
        string $clientActionId,
        array $payload,
        bool $shadow = false,
    ): GameRuntimeCommandResult {
        $this->calls[] = ['baseVersion' => $baseVersion, 'clientActionId' => $clientActionId];
        if (count($this->calls) === 1) {
            throw new GameRuntimeVersionConflictException('resync required', 9);
        }

        return new GameRuntimeCommandResult(
            ['gameId' => $gameId, 'version' => 10, 'type' => $type, 'payload' => $payload],
            [[
                'gameId' => $gameId,
                'version' => 10,
                'visibility' => 'public',
                'ops' => [[
                    'op' => 'player.status.set',
                    'data' => ['playerId' => $actorId, 'status' => 'conceded'],
                ]],
            ]],
        );
    }
}
