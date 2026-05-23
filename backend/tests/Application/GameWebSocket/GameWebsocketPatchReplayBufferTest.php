<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\WebSocket\GameWebsocketCommandResult;
use App\Application\Game\WebSocket\GameWebsocketPatchReplayBuffer;
use PHPUnit\Framework\TestCase;

class GameWebsocketPatchReplayBufferTest extends TestCase
{
    public function testReplaysConsecutivePatchesForUserInOrder(): void
    {
        $buffer = new GameWebsocketPatchReplayBuffer();
        $buffer->rememberResult('game-1', GameWebsocketCommandResult::forViewers([
            'user-1' => $this->patch(2, 'user-1'),
            'user-2' => $this->patch(2, 'user-2'),
        ], ['kind' => 'resync_required']), 1000);
        $buffer->rememberResult('game-1', GameWebsocketCommandResult::forViewers([
            'user-1' => $this->patch(3, 'user-1'),
            'user-2' => $this->patch(3, 'user-2'),
        ], ['kind' => 'resync_required']), 1001);

        $replay = $buffer->replay('game-1', 'user-1', 1, 3, 1002);

        self::assertIsArray($replay);
        self::assertSame([2, 3], array_column($replay, 'version'));
        self::assertSame('user-1', $replay[0]['operations'][0]['playerId']);
    }

    public function testReturnsNullWhenAConsecutivePatchIsMissing(): void
    {
        $buffer = new GameWebsocketPatchReplayBuffer();
        $buffer->rememberResult('game-1', GameWebsocketCommandResult::forViewers([
            'user-1' => $this->patch(3, 'user-1'),
        ], ['kind' => 'resync_required']), 1000);

        self::assertNull($buffer->replay('game-1', 'user-1', 1, 3, 1001));
    }

    public function testDoesNotStoreNonPatchOrSnapshotLikeMessages(): void
    {
        $buffer = new GameWebsocketPatchReplayBuffer();
        $buffer->rememberResult('game-1', GameWebsocketCommandResult::forViewers([
            'user-1' => ['kind' => 'resync_required', 'gameId' => 'game-1', 'currentVersion' => 2, 'reason' => 'version_gap'],
            'user-2' => [
                ...$this->patch(2, 'user-2'),
                'snapshot' => ['players' => []],
            ],
        ], ['kind' => 'resync_required']), 1000);

        self::assertNull($buffer->replay('game-1', 'user-1', 1, 2, 1001));
        self::assertNull($buffer->replay('game-1', 'user-2', 1, 2, 1001));
    }

    public function testExpiredPatchesRequireResync(): void
    {
        $buffer = new GameWebsocketPatchReplayBuffer();
        $buffer->rememberResult('game-1', GameWebsocketCommandResult::forViewers([
            'user-1' => $this->patch(2, 'user-1'),
        ], ['kind' => 'resync_required']), 1000);

        self::assertNull($buffer->replay('game-1', 'user-1', 1, 2, 1121));
    }

    public function testNoReplayNeededWhenClientIsAlreadyAtCurrentVersion(): void
    {
        $buffer = new GameWebsocketPatchReplayBuffer();

        self::assertSame([], $buffer->replay('game-1', 'user-1', 4, 4, 1000));
    }

    /**
     * @return array<string,mixed>
     */
    private function patch(int $version, string $playerId): array
    {
        return [
            'kind' => 'game_patch',
            'gameId' => 'game-1',
            'baseVersion' => $version - 1,
            'version' => $version,
            'operations' => [[
                'op' => 'player.life.set',
                'playerId' => $playerId,
                'value' => 40 - $version,
            ]],
        ];
    }
}
