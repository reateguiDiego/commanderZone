<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Deck\CardAnalysisProfileRebuilder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:card-analysis-profile:rebuild', description: 'Rebuilds denormalized card analysis profiles for analyzer reads.')]
final class CardAnalysisProfileRebuildCommand extends Command
{
    public function __construct(private readonly CardAnalysisProfileRebuilder $rebuilder)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Rebuilding denormalized card analysis profiles...');
        $result = $this->rebuilder->rebuild();
        $output->writeln(sprintf(
            'Card analysis profiles rebuilt. seen=%d inserted=%d updated=%d skipped=%d',
            $result['seen'],
            $result['inserted'],
            $result['updated'],
            $result['skipped'],
        ));

        return Command::SUCCESS;
    }
}
