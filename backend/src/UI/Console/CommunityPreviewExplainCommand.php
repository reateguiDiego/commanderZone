<?php

namespace App\UI\Console;

use App\Application\Card\CommanderCandidateSql;
use App\Application\Community\CommunityCardPreviewSql;
use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'app:community:explain-previews', description: 'Export actual community preview SQL plans and index metadata without changing data.')]
final class CommunityPreviewExplainCommand extends Command
{
    public function __construct(private readonly Connection $connection)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->addOption('analyze', null, InputOption::VALUE_NONE, 'Execute the two read queries with ANALYZE and BUFFERS; each has a 10-second timeout.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $this->connection->beginTransaction();
        try {
            $this->connection->executeStatement('SET TRANSACTION READ ONLY');
            $this->connection->executeStatement("SET LOCAL statement_timeout = '10s'");
            $this->connection->executeStatement("SET LOCAL lock_timeout = '1s'");
            $result = [
                'capturedAt' => gmdate('c'),
                'analyze' => (bool) $input->getOption('analyze'),
                'table' => $this->connection->fetchAssociative("SELECT s.n_live_tup, s.n_dead_tup, s.last_analyze, s.last_autoanalyze, s.last_vacuum, s.last_autovacuum, c.relpages, c.reltuples, c.relallvisible FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid WHERE s.relid = 'card'::regclass"),
                'indexes' => $this->connection->fetchAllAssociative("SELECT indexrelid::regclass::text AS name, indisvalid, pg_relation_size(indexrelid) AS bytes, pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indrelid = 'card'::regclass"),
                'plans' => [],
            ];
            foreach (['cards' => 'card.commander_legal = true', 'commanders' => CommanderCandidateSql::condition('card')] as $name => $predicate) {
                $sql = CommunityCardPreviewSql::select($predicate, 3);
                $options = $input->getOption('analyze') ? 'ANALYZE, BUFFERS, FORMAT JSON' : 'FORMAT JSON';
                $result['plans'][$name] = json_decode($this->connection->fetchOne('EXPLAIN ('.$options.') '.$sql), true, 512, JSON_THROW_ON_ERROR);
            }
            $output->writeln(json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        } finally {
            $this->connection->rollBack();
        }

        return Command::SUCCESS;
    }
}
