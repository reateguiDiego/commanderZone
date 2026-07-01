<?php

namespace App\Tests\Application;

use App\Application\Game\Runtime\GameRuntimeCommandClient;
use App\Application\Game\Runtime\GameRuntimeCommandClientInterface;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

final class GameRuntimeCommandClientTest extends TestCase
{
    public function testDispatchPostsGenericCommandEnvelopeToRuntimeCommandsEndpoint(): void
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
                    'type' => 'library.draw',
                    'payload' => ['playerId' => 'player-1'],
                    'createdBy' => 'player-1',
                    'clientActionId' => 'action-1',
                    'createdAt' => '2026-01-01T00:00:00+00:00',
                ],
                'patches' => [[
                    'gameId' => 'game-1',
                    'version' => 2,
                    'visibility' => 'player:player-1',
                    'ackClientActionId' => 'action-1',
                    'ops' => [['op' => 'zone.cards.add', 'data' => ['playerId' => 'player-1', 'zone' => 'hand', 'cards' => []]]],
                ]],
                'metrics' => ['command.apply_ms' => 0.4],
            ], JSON_THROW_ON_ERROR), ['http_code' => 200]);
        });

        $client = new GameRuntimeCommandClient($httpClient, 'http://runtime.internal:8091');
        $result = $client->dispatch(
            'library.draw',
            'game-1',
            'player-1',
            1,
            'action-1',
            ['playerId' => 'player-1', 'count' => 1],
        );

        self::assertSame('POST', $captured['method']);
        self::assertSame('http://runtime.internal:8091/commands', $captured['url']);
        self::assertSame('player-1', $captured['body']['actorId']);
        self::assertSame('library.draw', $captured['body']['command']['type']);
        self::assertSame(['playerId' => 'player-1', 'count' => 1], $captured['body']['command']['payload']);
        self::assertArrayNotHasKey('initialState', $captured['body']);
        self::assertSame('library.draw', $result->event['type']);
        self::assertSame(0.4, $result->metrics['command.apply_ms']);
    }

    public function testShadowDispatchUsesIsolatedGameIdAndClientActionId(): void
    {
        $captured = [];
        $httpClient = new MockHttpClient(function (string $method, string $url, array $options) use (&$captured): MockResponse {
            $captured = json_decode((string) ($options['body'] ?? ''), true, 512, JSON_THROW_ON_ERROR);

            return new MockResponse(json_encode([
                'event' => ['gameId' => 'game-1-shadow', 'version' => 2, 'type' => 'library.draw', 'payload' => [], 'createdBy' => 'player-1', 'clientActionId' => 'action-1-shadow', 'createdAt' => ''],
                'patches' => [['gameId' => 'game-1-shadow', 'version' => 2, 'visibility' => 'public', 'ops' => [['op' => 'zone.count.set', 'data' => ['playerId' => 'player-1', 'zone' => 'library', 'count' => 99]]]]],
                'metrics' => [],
            ], JSON_THROW_ON_ERROR), ['http_code' => 200]);
        });

        $client = new GameRuntimeCommandClient($httpClient, 'http://runtime.internal:8091');
        $client->dispatch('library.draw', 'game-1', 'player-1', 1, 'action-1', ['playerId' => 'player-1'], true);

        self::assertSame('game-1-shadow', $captured['command']['gameId']);
        self::assertSame('action-1-shadow', $captured['command']['clientActionId']);
        self::assertArrayNotHasKey('initialState', $captured);
    }

    public function testDispatchDoesNotSerializeInitialStateForNormalCommand(): void
    {
        $rawBody = '';
        $httpClient = new MockHttpClient(function (string $method, string $url, array $options) use (&$rawBody): MockResponse {
            $rawBody = (string) ($options['body'] ?? '');

            return new MockResponse(json_encode([
                'event' => ['gameId' => 'game-empty', 'version' => 2, 'type' => 'life.changed', 'payload' => [], 'createdBy' => 'player-1', 'clientActionId' => 'action-empty', 'createdAt' => ''],
                'patches' => [['gameId' => 'game-empty', 'version' => 2, 'visibility' => 'public', 'ops' => [['op' => 'player.life.set', 'data' => ['playerId' => 'player-1', 'life' => 39]]]]],
                'metrics' => [],
            ], JSON_THROW_ON_ERROR), ['http_code' => 200]);
        });

        $client = new GameRuntimeCommandClient($httpClient, 'http://runtime.internal:8091');
        $client->dispatch('life.changed', 'game-empty', 'player-1', 1, 'action-empty', ['playerId' => 'player-1', 'life' => 39]);

        self::assertStringNotContainsString('initialState', $rawBody);
    }

    public function testRuntimeCommandClientContractDoesNotAcceptLegacySnapshot(): void
    {
        $parameters = array_map(
            static fn (\ReflectionParameter $parameter): string => $parameter->getName(),
            (new \ReflectionMethod(GameRuntimeCommandClientInterface::class, 'dispatch'))->getParameters(),
        );

        self::assertNotContains('snapshot', $parameters);
    }

    public function testRuntimeCommandFailureIsRejectedWithoutLegacyFallback(): void
    {
        $httpClient = new MockHttpClient(new MockResponse(json_encode([
            'code' => 'command_failed',
            'error' => 'invalid payload field: player already conceded',
        ], JSON_THROW_ON_ERROR), ['http_code' => 409]));

        $client = new GameRuntimeCommandClient($httpClient, 'http://runtime.internal:8091');

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('player already conceded');

        $client->dispatch('game.concede', 'game-1', 'player-1', 2, 'action-2', ['playerId' => 'player-1']);
    }
}
