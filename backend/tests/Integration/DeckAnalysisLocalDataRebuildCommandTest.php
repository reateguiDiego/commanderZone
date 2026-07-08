<?php

namespace App\Tests\Integration;

use App\Application\Card\CardOracleProfileRebuilder;
use App\Application\Deck\AnalysisRuleSeeder;
use App\Application\Deck\CardAnalysisProfileRebuilder;
use App\Application\Deck\CardSemanticDataRebuilder;
use App\Application\Deck\ComboAnalysisProfileRebuilder;
use App\Infrastructure\DeckAnalysis\DeckAnalysisLocalDataRebuildCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

final class DeckAnalysisLocalDataRebuildCommandTest extends ApiTestCase
{
    public function testRebuildsLocalDataInDependencyOrder(): void
    {
        $oracleId = '88000000-0000-0000-0000-000000000001';
        $this->seedCard('88000000-0000-0000-0000-000000000101', 'Local Ramp Card', [
            'oracle_id' => $oracleId,
            'type_line' => 'Artifact',
            'oracle_text' => '{T}: Add one mana of any color.',
            'produced_mana' => ['W', 'U'],
        ]);
        $this->insertExternalTag($oracleId, 'ramp');
        $tester = new CommandTester($this->command());

        $status = $tester->execute([]);

        self::assertSame(Command::SUCCESS, $status);
        self::assertStringContainsString('oracle profiles rebuilt', $tester->getDisplay());
        self::assertStringContainsString('semantic rows inserted=', $tester->getDisplay());
        self::assertStringContainsString('card analysis profiles inserted=', $tester->getDisplay());
        self::assertStringContainsString('rules seeded:', $tester->getDisplay());
        self::assertStringContainsString('skippedBecause=spellbook_not_populated', $tester->getDisplay());

        $roles = json_decode((string) $this->entityManager->getConnection()->fetchOne(
            'SELECT roles FROM card_analysis_profile WHERE oracle_id = :oracleId',
            ['oracleId' => $oracleId],
        ), true, flags: JSON_THROW_ON_ERROR);
        self::assertContains('ramp', $roles);
    }

    public function testSkipFlagsAreRespected(): void
    {
        $oracleId = '88000000-0000-0000-0000-000000000002';
        $this->seedCard('88000000-0000-0000-0000-000000000102', 'Skipped Ramp Card', [
            'oracle_id' => $oracleId,
        ]);
        $this->insertExternalTag($oracleId, 'ramp');
        $tester = new CommandTester($this->command());

        $status = $tester->execute([
            '--skip-semantic' => true,
            '--skip-card-analysis-profile' => true,
            '--skip-rules' => true,
            '--skip-combo-analysis-profile' => true,
        ]);

        self::assertSame(Command::SUCCESS, $status);
        self::assertSame('0', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_role'));
        self::assertSame('0', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_analysis_profile'));
        self::assertSame('0', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM analysis_rule'));
        self::assertStringContainsString('semantic rows inserted=0 updated=0 skipped=0 skippedByFlag=true', $tester->getDisplay());
    }

    public function testDoesNotCreateExternalSyncRuns(): void
    {
        $tester = new CommandTester($this->command());

        $status = $tester->execute([
            '--skip-oracle-profile' => true,
            '--skip-semantic' => true,
            '--skip-card-analysis-profile' => true,
            '--skip-rules' => true,
            '--skip-combo-analysis-profile' => true,
        ]);

        self::assertSame(Command::SUCCESS, $status);
        self::assertSame('0', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM external_sync_run'));
        self::assertStringNotContainsString('spellbook:sync', $tester->getDisplay());
        self::assertStringNotContainsString('scryfall-tags:sync', $tester->getDisplay());
    }

    private function command(): DeckAnalysisLocalDataRebuildCommand
    {
        $connection = $this->entityManager->getConnection();

        return new DeckAnalysisLocalDataRebuildCommand(
            new CardOracleProfileRebuilder($connection),
            new CardSemanticDataRebuilder($connection),
            new CardAnalysisProfileRebuilder($connection),
            new AnalysisRuleSeeder($connection),
            new ComboAnalysisProfileRebuilder($connection),
            $connection,
        );
    }

    private function insertExternalTag(string $oracleId, string $tagSlug): void
    {
        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO external_card_tag (
    id,
    oracle_id,
    source,
    tag_type,
    tag_slug,
    import_query,
    confidence,
    active,
    imported_at
) VALUES (
    :id,
    :oracle_id,
    'scryfall_tagger',
    'oracle_tag',
    :tag_slug,
    :import_query,
    1.0,
    true,
    NOW()
)
SQL,
            [
                'id' => str_replace('88000000', '88000001', $oracleId),
                'oracle_id' => $oracleId,
                'tag_slug' => $tagSlug,
                'import_query' => 'otag:'.$tagSlug,
            ],
        );
    }
}
