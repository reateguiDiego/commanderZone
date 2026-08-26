<?php

namespace App\UI\Console;

use App\Application\Game\Runtime\GameRuntimeStopWorker;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Command\SignalableCommandInterface;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:game-runtime-stop-worker', description: 'Drain durable runtime stop requests.')]
final class GameRuntimeStopWorkerCommand extends Command implements SignalableCommandInterface
{
    private bool $running = true;

    public function __construct(private readonly GameRuntimeStopWorker $worker)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('watch', null, InputOption::VALUE_NONE, 'Keep draining runtime stop requests.')
            ->addOption('interval', null, InputOption::VALUE_REQUIRED, 'Idle polling interval in seconds.', '1')
            ->addOption('batch-size', null, InputOption::VALUE_REQUIRED, 'Maximum jobs drained before rechecking.', '100');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $this->running = true;
        $watch = (bool) $input->getOption('watch');
        $interval = max(1, (int) $input->getOption('interval'));
        $batchSize = max(1, (int) $input->getOption('batch-size'));

        do {
            $result = $this->worker->drain($batchSize);
            if ($result['retried'] > 0) {
                $output->writeln(sprintf('<comment>Deferred %d runtime stop request(s) for retry.</comment>', $result['retried']));
            }
            if (!$watch || !$this->running) {
                break;
            }
            if ($result['processed'] === $batchSize) {
                continue;
            }

            sleep($interval);
        } while ($this->running);

        return Command::SUCCESS;
    }

    public function getSubscribedSignals(): array
    {
        return array_values(array_filter([
            defined('SIGINT') ? constant('SIGINT') : null,
            defined('SIGTERM') ? constant('SIGTERM') : null,
        ]));
    }

    public function handleSignal(int $signal, int|false $previousExitCode = 0): int|false
    {
        $this->running = false;

        return false;
    }
}
