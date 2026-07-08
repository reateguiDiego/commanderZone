<?php

namespace App\UI\Console;

use Doctrine\DBAL\Connection;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

#[AsCommand(name: 'app:user-daily-visits:prune', description: 'Deletes old authenticated daily visit records.')]
final class UserDailyVisitsPruneCommand extends Command
{
    public function __construct(
        private readonly Connection $connection,
        private readonly ClockInterface $clock,
        #[Autowire('%user_daily_visit_retention_days%')]
        private readonly int $defaultRetentionDays,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('retention-days', null, InputOption::VALUE_REQUIRED, 'Number of UTC calendar days to keep.')
            ->addOption('dry-run', null, InputOption::VALUE_NONE, 'Count rows without deleting them.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $retentionDays = $this->retentionDays($input);
        if ($retentionDays < 1) {
            $output->writeln('<error>Retention must be at least 1 day.</error>');

            return Command::FAILURE;
        }

        $cutoffDate = $this->cutoffDate($retentionDays);
        $params = ['cutoff_date' => $cutoffDate];
        if ((bool) $input->getOption('dry-run')) {
            $count = (int) $this->connection->fetchOne(
                'SELECT COUNT(*) FROM user_daily_visit WHERE visit_date < :cutoff_date',
                $params,
            );
            $output->writeln(sprintf(
                'Dry run: %d user daily visit row(s) older than %s would be pruned.',
                $count,
                $cutoffDate,
            ));

            return Command::SUCCESS;
        }

        $deleted = $this->connection->executeStatement(
            'DELETE FROM user_daily_visit WHERE visit_date < :cutoff_date',
            $params,
        );
        $output->writeln(sprintf(
            'Pruned %d user daily visit row(s) older than %s with %d day retention.',
            $deleted,
            $cutoffDate,
            $retentionDays,
        ));

        return Command::SUCCESS;
    }

    private function retentionDays(InputInterface $input): int
    {
        $value = $input->getOption('retention-days');
        if ($value === null || $value === '') {
            return $this->defaultRetentionDays;
        }

        return filter_var($value, FILTER_VALIDATE_INT) === false ? 0 : (int) $value;
    }

    private function cutoffDate(int $retentionDays): string
    {
        $utc = new \DateTimeZone('UTC');
        $today = $this->clock->now()->setTimezone($utc)->setTime(0, 0);

        return $today->modify(sprintf('-%d days', $retentionDays))->format('Y-m-d');
    }
}
