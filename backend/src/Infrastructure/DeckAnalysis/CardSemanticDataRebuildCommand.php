<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Deck\CardSemanticDataRebuilder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:semantic-data:rebuild', description: 'Rebuilds internal deck analysis semantic data from local card profiles and tags.')]
final class CardSemanticDataRebuildCommand extends Command
{
    public function __construct(private readonly CardSemanticDataRebuilder $rebuilder)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Rebuilding local deck analysis semantic data...');
        $result = $this->rebuilder->rebuild();
        $output->writeln(sprintf(
            'Deck analysis semantic data rebuilt. profiles=%d roles=%d qualities=%d conditions=%d archetypes=%d powerFlags=%d',
            $result['profiles'],
            $result['roles'],
            $result['qualities'],
            $result['conditions'],
            $result['archetypes'],
            $result['powerFlags'],
        ));

        return Command::SUCCESS;
    }
}
