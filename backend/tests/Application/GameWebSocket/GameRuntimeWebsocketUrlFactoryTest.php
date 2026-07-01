<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\WebSocket\GameRuntimeWebsocketConfigurationException;
use App\Application\Game\WebSocket\GameRuntimeWebsocketUrlFactory;
use PHPUnit\Framework\TestCase;

class GameRuntimeWebsocketUrlFactoryTest extends TestCase
{
    public function testBuildsTicketUrlFromConfiguredRuntimePublicUrl(): void
    {
        $factory = new GameRuntimeWebsocketUrlFactory('wss://runtime.commanderzone.test/ws', true, 'prod');

        self::assertSame(
            'wss://runtime.commanderzone.test/ws?ticket=ticket-1',
            $factory->urlWithTicket('ticket-1'),
        );
    }

    public function testPreservesConfiguredQueryStringWhenAddingTicket(): void
    {
        $factory = new GameRuntimeWebsocketUrlFactory('wss://runtime.commanderzone.test/ws?region=eu', true, 'prod');

        self::assertSame(
            'wss://runtime.commanderzone.test/ws?region=eu&ticket=ticket-1',
            $factory->urlWithTicket('ticket-1'),
        );
    }

    public function testAllowsLocalDefaultOutsideProduction(): void
    {
        $factory = new GameRuntimeWebsocketUrlFactory('ws://127.0.0.1:8091/ws', true, 'test');

        self::assertSame(
            'ws://127.0.0.1:8091/ws?ticket=ticket-1',
            $factory->urlWithTicket('ticket-1'),
        );
    }

    public function testRejectsMissingRuntimePublicUrl(): void
    {
        $factory = new GameRuntimeWebsocketUrlFactory('', true, 'prod');

        $this->expectException(GameRuntimeWebsocketConfigurationException::class);
        $this->expectExceptionMessage('GAME_RUNTIME_WEBSOCKET_PUBLIC_URL must be configured.');

        $factory->urlWithTicket('ticket-1');
    }

    public function testRejectsProductionRuntimeDefaultUrl(): void
    {
        $factory = new GameRuntimeWebsocketUrlFactory('ws://127.0.0.1:8091/ws', true, 'prod');

        $this->expectException(GameRuntimeWebsocketConfigurationException::class);
        $this->expectExceptionMessage('GAME_RUNTIME_WEBSOCKET_PUBLIC_URL must be a public runtime websocket URL in prod when GAME_RUNTIME_ENABLED=1.');

        $factory->urlWithTicket('ticket-1');
    }

    public function testRejectsProductionInsecurePublicUrl(): void
    {
        $factory = new GameRuntimeWebsocketUrlFactory('ws://runtime.commanderzone.test/ws', true, 'prod');

        $this->expectException(GameRuntimeWebsocketConfigurationException::class);
        $this->expectExceptionMessage('GAME_RUNTIME_WEBSOCKET_PUBLIC_URL must use wss:// in prod when GAME_RUNTIME_ENABLED=1.');

        $factory->urlWithTicket('ticket-1');
    }

    public function testRejectsProductionLocalhostEvenWithSecureScheme(): void
    {
        $factory = new GameRuntimeWebsocketUrlFactory('wss://localhost/ws', true, 'prod');

        $this->expectException(GameRuntimeWebsocketConfigurationException::class);
        $this->expectExceptionMessage('GAME_RUNTIME_WEBSOCKET_PUBLIC_URL must be a public runtime websocket URL in prod when GAME_RUNTIME_ENABLED=1.');

        $factory->urlWithTicket('ticket-1');
    }

    public function testDoesNotApplyProductionPublicUrlGuardWhenRuntimeIsDisabled(): void
    {
        $factory = new GameRuntimeWebsocketUrlFactory('ws://127.0.0.1:8091/ws', false, 'prod');

        self::assertSame(
            'ws://127.0.0.1:8091/ws?ticket=ticket-1',
            $factory->urlWithTicket('ticket-1'),
        );
    }
}
