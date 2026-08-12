<?php

namespace App\UI\Console;

use App\Application\Game\GameRematchLifecycleSweeper;
use App\Infrastructure\Realtime\GameEventPublisher;
use App\Infrastructure\Realtime\RoomEventPublisher;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Command\SignalableCommandInterface;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:game-lifecycle-sweep', description: 'Process due game lifecycle deadlines.')]
final class GameLifecycleSweepCommand extends Command implements SignalableCommandInterface
{
    private bool $running = true;

    public function __construct(
        private readonly GameRematchLifecycleSweeper $sweeper,
        private readonly GameEventPublisher $gamePublisher,
        private readonly RoomEventPublisher $roomPublisher,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('watch', null, InputOption::VALUE_NONE, 'Keep processing lifecycle deadlines.')
            ->addOption('interval', null, InputOption::VALUE_REQUIRED, 'Polling interval in seconds when --watch is set.', '5')
            ->addOption('batch-size', null, InputOption::VALUE_REQUIRED, 'Maximum due lifecycle rows claimed per pass.', '100');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $this->running = true;
        $watch = (bool) $input->getOption('watch');
        $interval = max(1, (int) $input->getOption('interval'));
        $batchSize = max(1, (int) $input->getOption('batch-size'));

        do {
            $processed = $this->sweepDueGames($batchSize);
            if (!$watch || !$this->running) {
                break;
            }
            if ($processed === $batchSize) {
                continue;
            }

            sleep($interval);
        } while ($this->running);

        return Command::SUCCESS;
    }

    public function getSubscribedSignals(): array
    {
        $signals = [];
        foreach (['SIGINT', 'SIGTERM'] as $signal) {
            if (defined($signal)) {
                $signals[] = constant($signal);
            }
        }

        return $signals;
    }

    public function handleSignal(int $signal, int|false $previousExitCode = 0): int|false
    {
        $this->running = false;

        return false;
    }

    private function sweepDueGames(int $batchSize): int
    {
        $results = $this->sweeper->sweep(new \DateTimeImmutable(), $batchSize);
        foreach ($results as $result) {
            if ($result['type'] === 'room_ready') {
                // The waiting-room topic carries the authoritative room state;
                // game topic only instructs table clients to navigate.
                $this->gamePublisher->publishRematchCreated($result['game'], $result['game']->room(), null);
                $this->roomPublisher->publish($result['game']->room(), 'room.rematch.created');
                continue;
            }
            $this->gamePublisher->publishRoomDeleted($result['game']->id(), $result['roomId']);
            $this->roomPublisher->publishDeleted($result['roomId']);
        }

        return count($results);
    }
}
