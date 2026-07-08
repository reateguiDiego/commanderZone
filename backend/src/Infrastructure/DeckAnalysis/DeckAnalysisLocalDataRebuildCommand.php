<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Card\CardOracleProfileRebuilder;
use App\Application\Deck\AnalysisRuleSeeder;
use App\Application\Deck\CardAnalysisProfileRebuilder;
use App\Application\Deck\CardManaProfileRebuilder;
use App\Application\Deck\CardSemanticDataRebuilder;
use App\Application\Deck\ComboAnalysisProfileRebuilder;
use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:data:rebuild-local', description: 'Rebuilds local derived deck analysis data without external imports.')]
final class DeckAnalysisLocalDataRebuildCommand extends Command
{
    public function __construct(
        private readonly CardOracleProfileRebuilder $oracleProfileRebuilder,
        private readonly CardSemanticDataRebuilder $semanticDataRebuilder,
        private readonly CardAnalysisProfileRebuilder $cardAnalysisProfileRebuilder,
        private readonly CardManaProfileRebuilder $cardManaProfileRebuilder,
        private readonly AnalysisRuleSeeder $analysisRuleSeeder,
        private readonly ComboAnalysisProfileRebuilder $comboAnalysisProfileRebuilder,
        private readonly Connection $connection,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('skip-oracle-profile', null, InputOption::VALUE_NONE, 'Skip rebuilding card_oracle_profile.')
            ->addOption('skip-semantic', null, InputOption::VALUE_NONE, 'Skip rebuilding internal semantic card tables.')
            ->addOption('skip-card-analysis-profile', null, InputOption::VALUE_NONE, 'Skip rebuilding card_analysis_profile.')
            ->addOption('skip-card-mana-profile', null, InputOption::VALUE_NONE, 'Skip rebuilding card_mana_profile.')
            ->addOption('skip-rules', null, InputOption::VALUE_NONE, 'Skip seeding analysis_rule.')
            ->addOption('skip-combo-analysis-profile', null, InputOption::VALUE_NONE, 'Skip rebuilding combo_analysis_profile.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $output->writeln('Rebuilding local deck analysis data without external imports...');
        $summary = [];

        if (!$input->getOption('skip-oracle-profile')) {
            $this->requireTables('oracle profile rebuild', ['card', 'card_oracle_profile']);
            $result = $this->oracleProfileRebuilder->rebuild();
            $summary['oracle'] = sprintf(
                'oracle profiles rebuilt: profiles=%d changed=%d staleDeleted=%d',
                $result['profiles'],
                $result['changed'],
                $result['staleDeleted'],
            );
            $output->writeln($summary['oracle']);
        } else {
            $summary['oracle'] = 'oracle profiles rebuilt: skipped';
            $output->writeln('<comment>'.$summary['oracle'].'</comment>');
        }

        if (!$input->getOption('skip-semantic')) {
            $this->requireTables('semantic data rebuild', [
                'card_oracle_profile',
                'external_card_tag',
                'card_role',
                'card_role_quality',
                'card_condition',
                'card_archetype_signal',
                'card_power_flag',
            ]);
            $result = $this->semanticDataRebuilder->rebuild();
            $inserted = $result['roles'] + $result['qualities'] + $result['conditions'] + $result['archetypes'] + $result['powerFlags'];
            $summary['semantic'] = sprintf(
                'semantic rows inserted=%d updated=0 skipped=0 profiles=%d',
                $inserted,
                $result['profiles'],
            );
            $output->writeln($summary['semantic']);
        } else {
            $summary['semantic'] = 'semantic rows inserted=0 updated=0 skipped=0 skippedByFlag=true';
            $output->writeln('<comment>'.$summary['semantic'].'</comment>');
        }

        if (!$input->getOption('skip-card-analysis-profile')) {
            $this->requireTables('card analysis profile rebuild', [
                'card_oracle_profile',
                'card_role',
                'card_role_quality',
                'card_condition',
                'card_archetype_signal',
                'card_power_flag',
                'card_analysis_profile',
            ]);
            $result = $this->cardAnalysisProfileRebuilder->rebuild();
            $summary['cardAnalysis'] = sprintf(
                'card analysis profiles inserted=%d updated=%d skipped=%d seen=%d',
                $result['inserted'],
                $result['updated'],
                $result['skipped'],
                $result['seen'],
            );
            $output->writeln($summary['cardAnalysis']);
        } else {
            $summary['cardAnalysis'] = 'card analysis profiles inserted=0 updated=0 skipped=0 skippedByFlag=true';
            $output->writeln('<comment>'.$summary['cardAnalysis'].'</comment>');
        }

        if (!$input->getOption('skip-card-mana-profile')) {
            $this->requireTables('card mana profile rebuild', [
                'card_oracle_profile',
                'card_mana_profile',
                'deck_analysis_data_version',
            ]);
            $result = $this->cardManaProfileRebuilder->rebuild();
            $summary['cardMana'] = sprintf(
                'card mana profiles processed=%d inserted=%d updated=%d skipped=%d unknown=%d version=%s',
                $result['totalProcessed'],
                $result['inserted'],
                $result['updated'],
                $result['skipped'],
                $result['unknownNeedsReview'],
                $result['dataVersion'],
            );
            $output->writeln($summary['cardMana']);
        } else {
            $summary['cardMana'] = 'card mana profiles rebuilt=0 skippedByFlag=true';
            $output->writeln('<comment>'.$summary['cardMana'].'</comment>');
        }

        if (!$input->getOption('skip-rules')) {
            $this->requireTables('analysis rules seed', ['analysis_rule']);
            $result = $this->analysisRuleSeeder->seed();
            $summary['rules'] = sprintf(
                'rules seeded: inserted=%d updated=%d seen=%d',
                $result['inserted'],
                $result['updated'],
                $result['seen'],
            );
            $output->writeln($summary['rules']);
        } else {
            $summary['rules'] = 'rules seeded: skipped';
            $output->writeln('<comment>'.$summary['rules'].'</comment>');
        }

        if (!$input->getOption('skip-combo-analysis-profile')) {
            $summary['combo'] = $this->rebuildComboProfilesIfAvailable($output);
        } else {
            $summary['combo'] = 'combo profiles inserted=0 updated=0 skipped=0 skippedByFlag=true';
            $output->writeln('<comment>'.$summary['combo'].'</comment>');
        }

        $output->writeln('');
        $output->writeln('Local deck analysis rebuild summary:');
        foreach ($summary as $line) {
            $output->writeln('- '.$line);
        }

        return Command::SUCCESS;
    }

    private function rebuildComboProfilesIfAvailable(OutputInterface $output): string
    {
        $spellbookTables = [
            'spellbook_combo_variant',
            'spellbook_combo_card',
            'spellbook_combo_feature',
            'spellbook_feature',
            'spellbook_combo_requirement',
        ];

        if (!$this->tablesExist($spellbookTables)) {
            $message = 'combo profiles inserted=0 updated=0 skipped=0 skippedBecause=spellbook_tables_missing';
            $output->writeln('<comment>'.$message.'</comment>');

            return $message;
        }

        $variantCount = (int) $this->connection->fetchOne('SELECT COUNT(*) FROM spellbook_combo_variant');
        if ($variantCount === 0) {
            $message = 'combo profiles inserted=0 updated=0 skipped=0 skippedBecause=spellbook_not_populated';
            $output->writeln('<comment>'.$message.'</comment>');

            return $message;
        }

        $this->requireTables('combo analysis profile rebuild', [...$spellbookTables, 'combo_analysis_profile']);
        $result = $this->comboAnalysisProfileRebuilder->rebuild();
        $message = sprintf(
            'combo profiles inserted=%d updated=%d skipped=%d seen=%d',
            $result['inserted'],
            $result['updated'],
            $result['skipped'],
            $result['seen'],
        );
        $output->writeln($message);

        return $message;
    }

    /**
     * @param list<string> $tables
     */
    private function requireTables(string $step, array $tables): void
    {
        $missing = array_values(array_filter(
            $tables,
            fn (string $table): bool => !$this->tablesExist([$table]),
        ));
        if ($missing === []) {
            return;
        }

        throw new \RuntimeException(sprintf(
            'Cannot run %s. Missing required table(s): %s. Run migrations first.',
            $step,
            implode(', ', $missing),
        ));
    }

    /**
     * @param list<string> $tables
     */
    private function tablesExist(array $tables): bool
    {
        $schemaManager = $this->connection->createSchemaManager();

        return $schemaManager->tablesExist($tables);
    }
}
