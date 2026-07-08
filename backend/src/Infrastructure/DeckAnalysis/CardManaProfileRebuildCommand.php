<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Deck\CardManaProfileRebuilder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(
    name: 'app:deck-analysis:mana-profile:rebuild',
    description: 'Rebuilds denormalized card mana profiles for advanced deck analysis.',
    aliases: ['app:deck-analysis:card-mana-profile:rebuild'],
)]
final class CardManaProfileRebuildCommand extends Command
{
    public function __construct(private readonly CardManaProfileRebuilder $rebuilder)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Rebuilding card mana profiles...');
        $result = $this->rebuilder->rebuild();
        $output->writeln('Card mana profiles rebuilt.');
        $output->writeln(sprintf('total processed: %d', $result['totalProcessed']));
        $output->writeln(sprintf('inserted: %d', $result['inserted']));
        $output->writeln(sprintf('updated: %d', $result['updated']));
        $output->writeln(sprintf('skipped: %d', $result['skipped']));
        $output->writeln(sprintf('lands: %d', $result['lands']));
        $output->writeln(sprintf('fetchlands: %d', $result['fetchlands']));
        $output->writeln(sprintf('typed lands: %d', $result['typedLands']));
        $output->writeln(sprintf('land cycles count: %d', $result['landCyclesCount']));
        $output->writeln(sprintf('mana rocks: %d', $result['manaRocks']));
        $output->writeln(sprintf('mana dorks: %d', $result['manaDorks']));
        $output->writeln(sprintf('rituals: %d', $result['rituals']));
        $output->writeln(sprintf('land ramp: %d', $result['landRamp']));
        $output->writeln(sprintf('land tutors: %d', $result['landTutors']));
        $output->writeln(sprintf('cost reducers: %d', $result['costReducers']));
        $output->writeln(sprintf('unknown/needs_review: %d', $result['unknownNeedsReview']));
        $output->writeln(sprintf('data version: %s', $result['dataVersion']));

        return Command::SUCCESS;
    }
}
