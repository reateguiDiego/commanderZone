<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Deck\CardBoardWipeProfileRebuilder;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(
    name: 'app:deck-analysis:board-wipe-profile:rebuild',
    description: 'Rebuilds explicit board wipe read profiles for deck analysis.',
    aliases: ['app:deck-analysis:card-board-wipe-profile:rebuild'],
)]
final class CardBoardWipeProfileRebuildCommand extends Command
{
    public function __construct(private readonly CardBoardWipeProfileRebuilder $rebuilder)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Rebuilding card board wipe profiles...');
        $result = $this->rebuilder->rebuild();
        $output->writeln(sprintf(
            'Card board wipe profiles rebuilt. totalProcessed=%d inserted=%d updated=%d skipped=%d boardWipes=%d creatureWipes=%d artifactWipes=%d enchantmentWipes=%d graveyardWipes=%d modalWipes=%d asymmetricalWipes=%d overloadedMassModes=%d pseudoWipes=%d conditionalWipes=%d answersIndestructible=%d unknownNeedsReview=%d version=%s',
            $result['totalProcessed'],
            $result['inserted'],
            $result['updated'],
            $result['skipped'],
            $result['boardWipes'],
            $result['creatureWipes'],
            $result['artifactWipes'],
            $result['enchantmentWipes'],
            $result['graveyardWipes'],
            $result['modalWipes'],
            $result['asymmetricalWipes'],
            $result['overloadedMassModes'],
            $result['pseudoWipes'],
            $result['conditionalWipes'],
            $result['answersIndestructible'],
            $result['unknownNeedsReview'],
            $result['dataVersion'],
        ));

        return Command::SUCCESS;
    }
}
