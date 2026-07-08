<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Card\ScryfallGameChangerSyncService;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:scryfall-game-changers:sync', description: 'Refreshes Scryfall Commander game changer flags for local deck analysis profiles.')]
final class ScryfallGameChangersSyncCommand extends Command
{
    public function __construct(private readonly ScryfallGameChangerSyncService $syncService)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Syncing Scryfall game changer flags...');
        $result = $this->syncService->sync();

        foreach ($result['warnings'] as $warning) {
            $output->writeln('<comment>'.$warning.'</comment>');
        }

        $output->writeln(sprintf(
            'Scryfall game changers synced. runId=%s seen=%d updated=%d failed=%d',
            $result['runId'],
            $result['itemsSeen'],
            $result['itemsUpdated'],
            $result['itemsFailed'],
        ));

        return Command::SUCCESS;
    }
}
