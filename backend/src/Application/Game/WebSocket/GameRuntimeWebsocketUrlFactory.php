<?php

namespace App\Application\Game\WebSocket;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

final readonly class GameRuntimeWebsocketUrlFactory
{
    private const LOCAL_DEV_DEFAULT_URL = 'ws://127.0.0.1:8091/ws';

    public function __construct(
        #[Autowire('%game_runtime_websocket_public_url%')]
        private string $publicUrl,
        #[Autowire('%runtime_service_enabled%')]
        private bool $runtimeEnabled,
        #[Autowire('%kernel.environment%')]
        private string $environment,
    ) {
    }

    public function urlWithTicket(string $ticket): string
    {
        $baseUrl = $this->validatedPublicUrl();
        $separator = str_contains($baseUrl, '?') ? '&' : '?';

        return $baseUrl.$separator.'ticket='.rawurlencode($ticket);
    }

    private function validatedPublicUrl(): string
    {
        $url = rtrim(trim($this->publicUrl), '/');
        if ($url === '') {
            throw new GameRuntimeWebsocketConfigurationException('GAME_RUNTIME_WEBSOCKET_PUBLIC_URL must be configured.');
        }

        $parts = parse_url($url);
        if (!is_array($parts)) {
            throw new GameRuntimeWebsocketConfigurationException('GAME_RUNTIME_WEBSOCKET_PUBLIC_URL must be a valid absolute websocket URL.');
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (!in_array($scheme, ['ws', 'wss'], true) || $host === '') {
            throw new GameRuntimeWebsocketConfigurationException('GAME_RUNTIME_WEBSOCKET_PUBLIC_URL must be a valid absolute ws:// or wss:// URL.');
        }

        if ($this->runtimeEnabled && $this->isProduction()) {
            $this->assertProductionPublicUrl($url, $scheme, $host);
        }

        return $url;
    }

    private function assertProductionPublicUrl(string $url, string $scheme, string $host): void
    {
        if ($this->isLocalDevelopmentUrl($url, $host)) {
            throw new GameRuntimeWebsocketConfigurationException('GAME_RUNTIME_WEBSOCKET_PUBLIC_URL must be a public runtime websocket URL in prod when GAME_RUNTIME_ENABLED=1.');
        }

        if ($scheme !== 'wss') {
            throw new GameRuntimeWebsocketConfigurationException('GAME_RUNTIME_WEBSOCKET_PUBLIC_URL must use wss:// in prod when GAME_RUNTIME_ENABLED=1.');
        }
    }

    private function isProduction(): bool
    {
        return strtolower($this->environment) === 'prod';
    }

    private function isLocalDevelopmentUrl(string $url, string $host): bool
    {
        if ($this->sameUrl($url, self::LOCAL_DEV_DEFAULT_URL)) {
            return true;
        }

        return str_starts_with($host, '127.')
            || in_array($host, ['localhost', '0.0.0.0', '::1', '[::1]'], true);
    }

    private function sameUrl(string $left, string $right): bool
    {
        return rtrim(strtolower(trim($left)), '/') === rtrim(strtolower(trim($right)), '/');
    }
}
