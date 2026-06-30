<?php

namespace App\Tests\Application;

use App\Application\Game\Runtime\GameRuntimeMulliganClient;
use App\Application\Game\Runtime\GameRuntimeCommandClient;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

final class GameRuntimeMulliganClientTest extends TestCase
{
    public function testDispatchPostsMulliganCommandToRuntimeCommandsEndpoint(): void
    {
        $captured = [];
        $httpClient = new MockHttpClient(function (string $method, string $url, array $options) use (&$captured): MockResponse {
            $captured = [
                'method' => $method,
                'url' => $url,
                'body' => json_decode((string) ($options['body'] ?? ''), true, 512, JSON_THROW_ON_ERROR),
            ];

            return new MockResponse(json_encode([
                'event' => [
                    'gameId' => 'game-1',
                    'version' => 2,
                    'type' => 'mulligan.player_took',
                    'payload' => ['metrics' => ['mulligan.take_ms' => 0.2]],
                    'createdBy' => 'player-1',
                    'clientActionId' => 'action-1',
                    'createdAt' => '2026-01-01T00:00:00+00:00',
                ],
                'patches' => [[
                    'gameId' => 'game-1',
                    'version' => 2,
                    'visibility' => 'public',
                    'ackClientActionId' => 'action-1',
                    'ops' => [['op' => 'mulligan.status.set', 'data' => ['playerId' => 'player-1', 'status' => 'DECIDING']]],
                ]],
                'metrics' => ['mulligan.take_ms' => 0.2],
            ], JSON_THROW_ON_ERROR), ['http_code' => 200]);
        });
        $commandClient = new GameRuntimeCommandClient($httpClient, 'http://runtime.internal:8091');
        $client = new GameRuntimeMulliganClient($commandClient);

        $result = $client->dispatch(
            'mulligan.take',
            'game-1',
            'player-1',
            1,
            'action-1',
            [],
        );

        self::assertSame('POST', $captured['method']);
        self::assertSame('http://runtime.internal:8091/commands', $captured['url']);
        self::assertSame('player-1', $captured['body']['actorId']);
        self::assertSame('game-1', $captured['body']['command']['gameId']);
        self::assertSame('mulligan.take', $captured['body']['command']['type']);
        self::assertSame('player-1', $captured['body']['command']['payload']['playerId']);
        self::assertArrayNotHasKey('initialState', $captured['body']);
        self::assertSame('mulligan.player_took', $result->event['type']);
        self::assertSame(0.2, $result->metrics['mulligan.take_ms']);
    }
}
