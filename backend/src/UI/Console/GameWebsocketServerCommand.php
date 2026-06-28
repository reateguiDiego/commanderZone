<?php

namespace App\UI\Console;

use Amp\Http\HttpStatus;
use Amp\Http\Server\DefaultErrorHandler;
use Amp\Http\Server\Request;
use Amp\Http\Server\RequestHandler\ClosureRequestHandler;
use Amp\Http\Server\Response;
use Amp\Http\Server\SocketHttpServer;
use Amp\Websocket\Server\Rfc6455Acceptor;
use Amp\Websocket\Server\Websocket;
use App\Infrastructure\WebSocket\GameDebugWebsocketClientHandler;
use App\Infrastructure\WebSocket\GameWebsocketClientHandler;
use Psr\Log\LoggerInterface;
use Revolt\EventLoop;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

#[AsCommand(name: 'app:game-websocket-server', description: 'Runs the gameplay WebSocket server.')]
final class GameWebsocketServerCommand extends Command
{
    public function __construct(
        private readonly GameWebsocketClientHandler $clientHandler,
        private readonly GameDebugWebsocketClientHandler $debugClientHandler,
        private readonly LoggerInterface $logger,
        #[Autowire('%game_websocket_listen%')]
        private readonly string $listenAddress,
        #[Autowire('%runtime_service_enabled%')]
        private readonly bool $runtimeServiceEnabled = false,
        #[Autowire('%game_runtime_internal_url%')]
        private readonly string $runtimeInternalUrl = 'http://game-runtime:8091',
    ) {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        if ($this->runtimeServiceEnabled && !$this->runtimeReady()) {
            $output->writeln(sprintf('<error>Gameplay runtime is enabled but %s/readyz is not reachable.</error>', rtrim($this->runtimeInternalUrl, '/')));

            return Command::FAILURE;
        }

        $connectionLimit = $this->positiveIntEnv('GAME_WEBSOCKET_CONNECTION_LIMIT', 1000);
        $connectionLimitPerIp = $this->positiveIntEnv('GAME_WEBSOCKET_CONNECTION_LIMIT_PER_IP', 100);
        $server = SocketHttpServer::createForDirectAccess(
            $this->logger,
            enableCompression: false,
            connectionLimit: $connectionLimit,
            connectionLimitPerIp: $connectionLimitPerIp,
        );
        $server->expose($this->listenAddress);
        $gameplayWebsocket = new Websocket($server, $this->logger, new Rfc6455Acceptor(), $this->clientHandler);
        $debugWebsocket = new Websocket($server, $this->logger, new Rfc6455Acceptor(), $this->debugClientHandler);
        $requestHandler = new ClosureRequestHandler(static function (Request $request) use ($gameplayWebsocket, $debugWebsocket): Response {
            $path = $request->getUri()->getPath();
            if ($path === '/healthz' || $path === '/readyz') {
                return new Response(
                    status: HttpStatus::OK,
                    headers: ['content-type' => 'text/plain'],
                    body: 'ok',
                );
            }
            if (preg_match('#^/games/[^/]+/debug$#', $path) === 1) {
                return $debugWebsocket->handleRequest($request);
            }
            if (preg_match('#^/games/[^/]+$#', $path) !== 1) {
                return new Response(
                    status: HttpStatus::NOT_FOUND,
                    headers: ['content-type' => 'application/json'],
                    body: json_encode(['error' => 'WebSocket route not found.'], JSON_THROW_ON_ERROR),
                );
            }

            return $gameplayWebsocket->handleRequest($request);
        });

        $server->start($requestHandler, new DefaultErrorHandler());
        $output->writeln(sprintf('Gameplay WebSocket server listening on %s', $this->listenAddress));

        if (defined('SIGINT')) {
            EventLoop::onSignal(SIGINT, static fn (): null => $server->stop());
        }
        if (defined('SIGTERM')) {
            EventLoop::onSignal(SIGTERM, static fn (): null => $server->stop());
        }

        EventLoop::run();

        return Command::SUCCESS;
    }

    private function positiveIntEnv(string $name, int $default): int
    {
        $value = $_SERVER[$name] ?? $_ENV[$name] ?? null;
        if (!is_string($value) && !is_int($value)) {
            return $default;
        }

        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return is_int($parsed) ? $parsed : $default;
    }

    private function runtimeReady(): bool
    {
        $url = rtrim($this->runtimeInternalUrl, '/').'/readyz';
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 2,
                'ignore_errors' => true,
            ],
        ]);
        $body = @file_get_contents($url, false, $context);
        if ($body === false) {
            $this->logger->error('Gameplay runtime preflight failed.', ['url' => $url]);

            return false;
        }

        $statusLine = is_array($http_response_header ?? null) ? ($http_response_header[0] ?? '') : '';
        $ready = str_contains($statusLine, ' 200 ');
        if (!$ready) {
            $this->logger->error('Gameplay runtime preflight returned non-OK status.', [
                'url' => $url,
                'status' => $statusLine,
            ]);
        }

        return $ready;
    }
}
