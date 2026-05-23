<?php

namespace App\Application\Game\WebSocket;

use App\Domain\Game\Game;
use App\Domain\User\User;
use Doctrine\Persistence\ManagerRegistry;
use Doctrine\Persistence\ObjectManager;

final readonly class GameWebsocketConnectionAuthorizer
{
    public function __construct(
        private GameWebsocketTicketManager $tickets,
        private GameWebsocketAccessService $access,
        private ManagerRegistry $managerRegistry,
    ) {
    }

    public function authorize(string $gameId, string $ticket): GameWebsocketConnectionContext
    {
        $validatedTicket = $this->tickets->validate($ticket, $gameId);
        $manager = $this->manager();

        try {
            $game = $manager->getRepository(Game::class)->find($gameId);
            $user = $manager->getRepository(User::class)->find($validatedTicket->userId);
            if (!$game instanceof Game || !$user instanceof User || !$this->access->canConnect($game, $user)) {
                throw new \InvalidArgumentException('Game access denied.');
            }

            return new GameWebsocketConnectionContext(
                gameId: $game->id(),
                userId: $user->id(),
                displayName: $user->displayName(),
                currentVersion: max(1, (int) ($game->snapshot()['version'] ?? 1)),
            );
        } finally {
            $manager->clear();
        }
    }

    private function manager(): ObjectManager
    {
        return $this->managerRegistry->getManagerForClass(Game::class)
            ?? $this->managerRegistry->getManager();
    }
}
