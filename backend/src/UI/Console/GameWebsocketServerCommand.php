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
    ) {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $server = SocketHttpServer::createForDirectAccess($this->logger, enableCompression: false);
        $server->expose($this->listenAddress);
        $gameplayWebsocket = new Websocket($server, $this->logger, new Rfc6455Acceptor(), $this->clientHandler);
        $debugWebsocket = new Websocket($server, $this->logger, new Rfc6455Acceptor(), $this->debugClientHandler);
        $requestHandler = new ClosureRequestHandler(static function (Request $request) use ($gameplayWebsocket, $debugWebsocket): Response {
            $path = $request->getUri()->getPath();
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
}
