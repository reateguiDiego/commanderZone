<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Deck\ComboAnalysisProfileRebuilder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:combo-analysis-profile:rebuild', description: 'Rebuilds denormalized Commander Spellbook combo analysis profiles.')]
final class ComboAnalysisProfileRebuildCommand extends Command
{
    public function __construct(private readonly ComboAnalysisProfileRebuilder $rebuilder)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Rebuilding combo analysis profiles...');
        $result = $this->rebuilder->rebuild();
        $output->writeln(sprintf(
            'Combo analysis profiles rebuilt. seen=%d inserted=%d updated=%d skipped=%d',
            $result['seen'],
            $result['inserted'],
            $result['updated'],
            $result['skipped'],
        ));

        return Command::SUCCESS;
    }
}
