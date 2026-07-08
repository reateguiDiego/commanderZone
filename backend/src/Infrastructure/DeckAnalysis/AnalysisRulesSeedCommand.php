<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Deck\AnalysisRuleSeeder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:rules:seed', description: 'Seeds configurable deck analysis rules.')]
final class AnalysisRulesSeedCommand extends Command
{
    public function __construct(private readonly AnalysisRuleSeeder $seeder)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Seeding deck analysis rules...');
        $result = $this->seeder->seed();
        $output->writeln(sprintf(
            'Deck analysis rules seeded. seen=%d inserted=%d updated=%d',
            $result['seen'],
            $result['inserted'],
            $result['updated'],
        ));

        return Command::SUCCESS;
    }
}
