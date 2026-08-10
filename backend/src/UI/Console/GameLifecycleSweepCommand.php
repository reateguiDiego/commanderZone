<?php

namespace App\UI\Console;

use App\Application\Game\GameRematchLifecycleSweeper;
use App\Infrastructure\Realtime\GameEventPublisher;
use App\Infrastructure\Realtime\RoomEventPublisher;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:game-lifecycle-sweep', description: 'Process due game lifecycle deadlines.')]
final class GameLifecycleSweepCommand extends Command
{
    public function __construct(
        private readonly GameRematchLifecycleSweeper $sweeper,
        private readonly GameEventPublisher $gamePublisher,
        private readonly RoomEventPublisher $roomPublisher,
    ) {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        foreach ($this->sweeper->sweep(new \DateTimeImmutable()) as $result) {
            if ($result['type'] === 'room_ready') {
                // The waiting-room topic carries the authoritative room state;
                // game topic only instructs table clients to navigate.
                $this->gamePublisher->publishRematchCreated($result['game'], $result['game']->room(), null);
                $this->roomPublisher->publish($result['game']->room(), 'room.rematch.created');
                continue;
            }
            $this->roomPublisher->publishDeleted($result['roomId']);
        }

        return Command::SUCCESS;
    }
}
