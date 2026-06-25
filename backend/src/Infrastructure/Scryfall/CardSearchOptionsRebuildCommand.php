<?php

namespace App\Infrastructure\Scryfall;

use App\Application\Card\CardSearchOptionsRebuilder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:card-search-options:rebuild', description: 'Rebuilds localized card search option catalogs.')]
final class CardSearchOptionsRebuildCommand extends Command
{
    public function __construct(private readonly CardSearchOptionsRebuilder $rebuilder)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Rebuilding localized card search options...');
        $this->rebuilder->rebuild();
        $output->writeln('Localized card search options rebuilt.');

        return Command::SUCCESS;
    }
}
