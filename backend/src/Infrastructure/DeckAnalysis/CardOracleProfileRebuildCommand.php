<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Card\CardOracleProfileRebuilder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:oracle-profile:rebuild', description: 'Rebuilds canonical card oracle profiles from local card data.')]
final class CardOracleProfileRebuildCommand extends Command
{
    public function __construct(private readonly CardOracleProfileRebuilder $rebuilder)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Rebuilding card oracle profiles from local card data...');
        $result = $this->rebuilder->rebuild();
        $output->writeln(sprintf(
            'Card oracle profiles rebuilt. profiles=%d changed=%d staleDeleted=%d',
            $result['profiles'],
            $result['changed'],
            $result['staleDeleted'],
        ));

        return Command::SUCCESS;
    }
}
