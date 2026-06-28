<?php

namespace App\Infrastructure\Scryfall;

use App\Application\Card\CardSearchEntryRebuilder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:card-search-entry:rebuild', description: 'Rebuilds the materialized card search entry table.')]
final class CardSearchEntryRebuildCommand extends Command
{
    public function __construct(private readonly CardSearchEntryRebuilder $rebuilder)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Rebuilding materialized card search entries...');
        $this->rebuilder->rebuild();
        $output->writeln('Materialized card search entries rebuilt.');

        return Command::SUCCESS;
    }
}
