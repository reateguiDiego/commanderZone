<?php

namespace App\Infrastructure\Scryfall;

use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\OutputInterface;

final readonly class CardCatalogCommandRunner
{
    public function __construct(
        private ScryfallCardMetadataBackfillCommand $metadataBackfillCommand,
        private CardPrintBackfillCommand $cardPrintBackfillCommand,
        private ScryfallSyncCommand $scryfallSyncCommand,
        private CardSearchOptionsRebuildCommand $searchOptionsRebuildCommand,
        private CardSearchEntryRebuildCommand $searchEntryRebuildCommand,
    ) {
    }

    /**
     * @param array<string,mixed> $options
     */
    public function runMetadataBackfill(array $options, OutputInterface $output): int
    {
        return $this->run($this->metadataBackfillCommand, $options, $output);
    }

    /**
     * @param array<string,mixed> $options
     */
    public function runCardPrintBackfill(array $options, OutputInterface $output): int
    {
        return $this->run($this->cardPrintBackfillCommand, $options, $output);
    }

    /**
     * @param array<string,mixed> $options
     */
    public function runScryfallSync(array $options, OutputInterface $output): int
    {
        return $this->run($this->scryfallSyncCommand, $options, $output);
    }

    public function runSearchOptionsRebuild(OutputInterface $output): int
    {
        return $this->run($this->searchOptionsRebuildCommand, [], $output);
    }

    public function runSearchEntryRebuild(OutputInterface $output): int
    {
        return $this->run($this->searchEntryRebuildCommand, [], $output);
    }

    /**
     * @param array<string,mixed> $options
     */
    private function run(Command $command, array $options, OutputInterface $output): int
    {
        $input = new ArrayInput($options);
        $input->setInteractive(false);

        return $command->run($input, $output);
    }
}
