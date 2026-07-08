<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Deck\SpellbookSyncService;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:spellbook:sync', description: 'Imports Commander Spellbook variants, features, and templates for deck analysis inputs.')]
final class SpellbookSyncCommand extends Command
{
    public function __construct(private readonly SpellbookSyncService $syncService)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Syncing Commander Spellbook data...');
        $result = $this->syncService->sync(static function (string $endpoint, array $progress) use ($output): void {
            $output->writeln(sprintf(
                'Spellbook progress. endpoint=%s seen=%d inserted=%d updated=%d failed=%d',
                $endpoint,
                $progress['seen'],
                $progress['inserted'],
                $progress['updated'],
                $progress['failed'],
            ));
        });

        foreach ($result['warnings'] as $warning) {
            $output->writeln('<comment>'.$warning.'</comment>');
        }

        $output->writeln(sprintf(
            'Commander Spellbook synced. runId=%s seen=%d inserted=%d updated=%d failed=%d',
            $result['runId'],
            $result['itemsSeen'],
            $result['itemsInserted'],
            $result['itemsUpdated'],
            $result['itemsFailed'],
        ));

        return Command::SUCCESS;
    }
}
