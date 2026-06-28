<?php

namespace App\Infrastructure\Scryfall;

use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:card-catalog:reset', description: 'Prepares or restores a local card catalog reset while preserving deck cards by Scryfall id.')]
final class CardCatalogResetCommand extends Command
{
    public function __construct(private readonly CardCatalogResetService $resetService)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('stage', null, InputOption::VALUE_REQUIRED, 'Stage to run: prepare or restore.', 'prepare')
            ->addOption('confirm', null, InputOption::VALUE_NONE, 'Required because prepare truncates local card catalog tables.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $stage = is_string($input->getOption('stage')) ? trim($input->getOption('stage')) : 'prepare';
        if (!in_array($stage, ['prepare', 'restore'], true)) {
            $output->writeln('<error>Invalid --stage. Use prepare or restore.</error>');

            return Command::FAILURE;
        }

        if ($stage === 'prepare' && !$input->getOption('confirm')) {
            $output->writeln('<error>Refusing to truncate catalog tables without --confirm.</error>');

            return Command::FAILURE;
        }

        return $stage === 'prepare'
            ? $this->prepare($output)
            : $this->restore($output);
    }

    private function prepare(OutputInterface $output): int
    {
        $result = $this->resetService->prepare();
        $output->writeln(sprintf(
            'Backed up %d deck card rows and truncated card catalog tables: %s.',
            $result->backedUpDeckCards,
            $result->truncatedTables === [] ? '(none)' : implode(', ', $result->truncatedTables),
        ));

        $output->writeln('Run app:scryfall:sync next, then app:card-catalog:reset --stage=restore.');

        return Command::SUCCESS;
    }

    private function restore(OutputInterface $output): int
    {
        try {
            $result = $this->resetService->restore();
        } catch (\RuntimeException $exception) {
            $output->writeln('<error>No reset backup table exists. Run --stage=prepare first.</error>');

            return Command::FAILURE;
        }

        $output->writeln(sprintf('Restored %d deck card rows from catalog reset backup.', $result->restoredDeckCards));
        if ($result->missingCards !== []) {
            $output->writeln('<comment>Some deck cards were not restored because their Scryfall ids were not imported again. Backup table was kept.</comment>');
            foreach ($result->missingCards as $row) {
                $output->writeln(sprintf(
                    '- deck=%s scryfallId=%s quantity=%s section=%s',
                    (string) $row['deck_id'],
                    (string) $row['scryfall_id'],
                    (string) $row['quantity'],
                    (string) $row['section'],
                ));
            }

            return Command::SUCCESS;
        }

        $output->writeln('All deck cards were restored. Reset backup table was cleared.');

        return Command::SUCCESS;
    }
}
