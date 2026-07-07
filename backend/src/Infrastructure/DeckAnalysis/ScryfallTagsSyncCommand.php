<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Card\ScryfallTagSyncService;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:scryfall-tags:sync', description: 'Imports controlled Scryfall Tagger functional tags for deck analysis inputs.')]
final class ScryfallTagsSyncCommand extends Command
{
    public function __construct(private readonly ScryfallTagSyncService $syncService)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Syncing controlled Scryfall functional tags...');
        $result = $this->syncService->sync();

        foreach ($result['warnings'] as $warning) {
            $output->writeln('<comment>'.$warning.'</comment>');
        }

        $output->writeln(sprintf(
            'Scryfall functional tags synced. runId=%s queries=%d seen=%d inserted=%d updated=%d failed=%d',
            $result['runId'],
            $result['queries'],
            $result['itemsSeen'],
            $result['itemsInserted'],
            $result['itemsUpdated'],
            $result['itemsFailed'],
        ));

        return Command::SUCCESS;
    }
}
