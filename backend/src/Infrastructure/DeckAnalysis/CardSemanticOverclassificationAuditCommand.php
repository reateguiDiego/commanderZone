<?php

namespace App\Infrastructure\DeckAnalysis;

use App\Application\Deck\CardSemanticOverclassificationAuditor;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:deck-analysis:semantic-overclassification:audit', description: 'Audits false-positive risk in deck analysis semantic data without changing data.')]
final class CardSemanticOverclassificationAuditCommand extends Command
{
    public function __construct(private readonly CardSemanticOverclassificationAuditor $auditor)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->addOption('top', null, InputOption::VALUE_REQUIRED, 'Number of suspicious rows to print.', '30');
        $this->addOption('json', null, InputOption::VALUE_NONE, 'Print machine-readable JSON.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $top = max(0, (int) $input->getOption('top'));
        $result = $this->auditor->audit($top);

        if ((bool) $input->getOption('json')) {
            $output->writeln(json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));

            return Command::SUCCESS;
        }

        $output->writeln(sprintf('Semantic overclassification audit. scope=%d', $result['scope']));
        foreach ($result['metrics'] as $metric => $count) {
            $output->writeln(sprintf('- %s: %d', $metric, $count));
        }

        if ($result['top'] !== []) {
            $output->writeln('');
            $output->writeln(sprintf('Top %d suspicious rows:', count($result['top'])));
            foreach ($result['top'] as $row) {
                $output->writeln(sprintf(
                    '- [%s/%s] %s (%s): roles=%s subroles=%s conditions=%s fix=%s',
                    $row['severity'],
                    $row['metric'],
                    $row['name'],
                    $row['oracle_id'],
                    implode(',', $row['roles']),
                    implode(',', $row['subroles']),
                    implode(',', $row['condition_keys']),
                    $row['suggested_fix'],
                ));
            }
        }

        return Command::SUCCESS;
    }
}
