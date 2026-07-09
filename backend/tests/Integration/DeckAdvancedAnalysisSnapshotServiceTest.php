<?php

namespace App\Tests\Integration;

use App\Application\Deck\DeckAdvancedAnalysisCalculatorInterface;
use App\Application\Deck\DeckAdvancedAnalysisContext;
use App\Application\Deck\DeckAdvancedAnalysisResultCompactor;
use App\Application\Deck\DeckAdvancedAnalysisSnapshotService;
use App\Application\Deck\DeckAdvancedAnalyzerVersion;
use App\Application\Deck\DeckAnalysisDataVersionProvider;
use App\Application\Deck\DeckAnalysisDeckHasher;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;

final class DeckAdvancedAnalysisSnapshotServiceTest extends ApiTestCase
{
    public function testSnapshotMissCalculatesAndStoresResult(): void
    {
        [$deck] = $this->deckFixture('miss');
        $calculator = new RecordingAdvancedCalculator();
        $service = $this->service();

        $result = $service->analyze($deck, $calculator);

        self::assertSame(1, $calculator->calls);
        self::assertFalse($result['snapshot']['hit']);
        self::assertSame('missing', $result['snapshot']['reason']);
        self::assertSame(DeckAdvancedAnalyzerVersion::CURRENT, $result['snapshot']['analyzerVersion']);
        self::assertArrayHasKey('manaDataVersion', $result['snapshot']);
        self::assertSame(DeckAdvancedAnalyzerVersion::DEFAULT_MONTE_CARLO_RUNS, $result['snapshot']['monteCarloRuns']);
        self::assertSame('1', (string) $this->connection()->fetchOne('SELECT COUNT(*) FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId', ['deckId' => $deck->id()]));
    }

    public function testFreshSnapshotIsReturnedWithoutRecalculating(): void
    {
        [$deck] = $this->deckFixture('hit');
        $calculator = new RecordingAdvancedCalculator();
        $service = $this->service();
        $first = $service->analyze($deck, $calculator);

        $calculator->resultLabel = 'changed calculator output';
        $second = $service->analyze($deck, $calculator);

        self::assertSame(1, $calculator->calls);
        self::assertFalse($first['snapshot']['hit']);
        self::assertTrue($second['snapshot']['hit']);
        self::assertSame('fresh', $second['snapshot']['reason']);
        self::assertSame('analysis #1', $second['label']);
    }

    public function testDeckChangeInvalidatesSnapshot(): void
    {
        [$deck, $firstCard, $secondCard] = $this->deckFixture('deck-change');
        $calculator = new RecordingAdvancedCalculator();
        $service = $this->service();
        $service->analyze($deck, $calculator);
        $firstHash = $service->deckHash($deck);

        $deck->addOrIncrementCard($secondCard, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->flush();
        $result = $service->analyze($deck, $calculator);

        self::assertSame(2, $calculator->calls);
        self::assertSame('deck_hash_changed', $result['snapshot']['reason']);
        self::assertNotSame($firstHash, $service->deckHash($deck));
        self::assertNotNull($firstCard->oracleId());
    }

    public function testAnalyzerVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('analyzer-version');
        $calculator = new RecordingAdvancedCalculator();
        $this->insertSnapshot($deck, ['analyzer_version' => 'old-version']);

        $result = $this->service()->analyze($deck, $calculator);

        self::assertSame(1, $calculator->calls);
        self::assertSame('analyzer_version_changed', $result['snapshot']['reason']);
    }

    public function testSemanticDataVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('semantic-version');
        $calculator = new RecordingAdvancedCalculator();
        $this->insertSnapshot($deck, ['semantic_data_version' => 'old-semantic']);

        $result = $this->service()->analyze($deck, $calculator);

        self::assertSame(1, $calculator->calls);
        self::assertSame('semantic_data_changed', $result['snapshot']['reason']);
    }

    public function testBoardWipeDataVersionChangeInvalidatesSnapshotThroughSemanticVersion(): void
    {
        [$deck] = $this->deckFixture('board-wipe-version');
        $calculator = new RecordingAdvancedCalculator();
        $this->insertSnapshot($deck);
        (new DeckAnalysisDataVersionProvider($this->connection()))->setBoardWipeVersion('sha256:changed-board-wipe-profiles');

        $result = $this->service()->analyze($deck, $calculator);

        self::assertSame(1, $calculator->calls);
        self::assertSame('semantic_data_changed', $result['snapshot']['reason']);
    }

    public function testManaDataVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('mana-version');
        $calculator = new RecordingAdvancedCalculator();
        $this->insertSnapshot($deck, ['mana_data_version' => 'old-mana']);

        $result = $this->service()->analyze($deck, $calculator);

        self::assertSame(1, $calculator->calls);
        self::assertSame('mana_data_changed', $result['snapshot']['reason']);
    }

    public function testExistingSnapshotPayloadWithoutManaDataVersionDoesNotCrash(): void
    {
        [$deck] = $this->deckFixture('old-payload-no-mana-version');
        $calculator = new RecordingAdvancedCalculator();
        $this->insertSnapshot($deck, [
            'result_json' => json_encode([
                'label' => 'old snapshot',
                'snapshot' => [
                    'hit' => false,
                    'reason' => 'missing',
                ],
            ], JSON_THROW_ON_ERROR),
        ]);

        $result = $this->service()->analyze($deck, $calculator);

        self::assertSame(0, $calculator->calls);
        self::assertTrue($result['snapshot']['hit']);
        self::assertSame('fresh', $result['snapshot']['reason']);
        self::assertArrayHasKey('manaDataVersion', $result['snapshot']);
        self::assertSame('old snapshot', $result['label']);
    }


    public function testComboDataVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('combo-version');
        $calculator = new RecordingAdvancedCalculator();
        $this->insertSnapshot($deck, ['combo_data_version' => 'old-combo']);

        $result = $this->service()->analyze($deck, $calculator);

        self::assertSame(1, $calculator->calls);
        self::assertSame('combo_data_changed', $result['snapshot']['reason']);
    }

    public function testRulesVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('rules-version');
        $calculator = new RecordingAdvancedCalculator();
        $this->insertSnapshot($deck, ['rules_version' => 'old-rules']);

        $result = $this->service()->analyze($deck, $calculator);

        self::assertSame(1, $calculator->calls);
        self::assertSame('rules_changed', $result['snapshot']['reason']);
    }

    public function testMonteCarloVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('monte-version');
        $calculator = new RecordingAdvancedCalculator();
        $this->insertSnapshot($deck, ['monte_carlo_version' => 'old-monte-carlo']);

        $result = $this->service()->analyze($deck, $calculator);

        self::assertSame(1, $calculator->calls);
        self::assertSame('monte_carlo_version_changed', $result['snapshot']['reason']);
    }

    public function testMonteCarloRunsChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('monte-runs');
        $calculator = new RecordingAdvancedCalculator();
        $service = $this->service();
        $service->analyze($deck, $calculator, 100000);

        $result = $service->analyze($deck, $calculator, 50000);

        self::assertSame(2, $calculator->calls);
        self::assertSame('monte_carlo_runs_changed', $result['snapshot']['reason']);
        self::assertSame(50000, $result['monteCarloRuns']);
        self::assertSame(50000, $result['snapshot']['monteCarloRuns']);
    }

    public function testUnmatchedCardParticipatesInStableDeckHash(): void
    {
        $unmatched = $this->seedCard('97000000-0000-0000-0000-000000000991', 'No Oracle Card', [
            'oracle_id' => null,
        ]);
        $user = $this->user('unmatched');
        $deck = new Deck($user, 'Unmatched Snapshot Deck');
        $deck->addOrIncrementCard($unmatched, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($user);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();
        $service = $this->service();

        $first = $service->deckHash($deck);
        $second = $service->deckHash($deck);
        $deck->addOrIncrementCard($unmatched, 1, DeckCard::SECTION_COMMANDER);
        $this->entityManager->flush();

        self::assertSame($first, $second);
        self::assertNotSame($first, $service->deckHash($deck));
        self::assertFalse($service->analyze($deck, new RecordingAdvancedCalculator())['snapshot']['hit']);
    }

    /**
     * @return array{0:Deck,1:\App\Domain\Card\Card,2:\App\Domain\Card\Card}
     */
    private function deckFixture(string $suffix): array
    {
        $first = $this->seedCard('97000000-0000-0000-0000-'.substr(md5($suffix.'a'), 0, 12), 'Snapshot Card '.$suffix, [
            'oracle_id' => '97000000-0000-0000-0001-'.substr(md5($suffix.'a'), 0, 12),
        ]);
        $second = $this->seedCard('97000000-0000-0000-0000-'.substr(md5($suffix.'b'), 0, 12), 'Snapshot Second '.$suffix, [
            'oracle_id' => '97000000-0000-0000-0001-'.substr(md5($suffix.'b'), 0, 12),
        ]);
        $user = $this->user($suffix);
        $deck = new Deck($user, 'Snapshot Deck '.$suffix);
        $deck->addOrIncrementCard($first, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($user);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        return [$deck, $first, $second];
    }

    private function user(string $suffix): User
    {
        $user = new User('advanced-'.$suffix.'@example.test', substr('Adv'.$suffix, 0, 20));
        $user->setPassword('hash');

        return $user;
    }

    private function service(): DeckAdvancedAnalysisSnapshotService
    {
        return new DeckAdvancedAnalysisSnapshotService(
            $this->connection(),
            new DeckAnalysisDataVersionProvider($this->connection()),
            new DeckAnalysisDeckHasher($this->connection()),
            new DeckAdvancedAnalysisResultCompactor(),
        );
    }

    /**
     * @param array<string,mixed> $overrides
     */
    private function insertSnapshot(Deck $deck, array $overrides = []): void
    {
        $deckHash = $this->service()->deckHash($deck);
        $versions = (new DeckAnalysisDataVersionProvider($this->connection()))->currentVersions();
        $monteCarloRuns = DeckAdvancedAnalyzerVersion::DEFAULT_MONTE_CARLO_RUNS;
        $values = array_replace([
            'id' => '97000000-0000-0000-0002-'.substr(md5($deck->id()), 0, 12),
            'deck_id' => $deck->id(),
            'deck_hash' => $deckHash,
            'analyzer_version' => DeckAdvancedAnalyzerVersion::CURRENT,
            'semantic_data_version' => $versions[DeckAnalysisDataVersionProvider::KEY_SEMANTIC],
            'mana_data_version' => $versions[DeckAnalysisDataVersionProvider::KEY_MANA],
            'combo_data_version' => $versions[DeckAnalysisDataVersionProvider::KEY_COMBO],
            'rules_version' => $versions[DeckAnalysisDataVersionProvider::KEY_RULES],
            'monte_carlo_version' => DeckAdvancedAnalyzerVersion::MONTE_CARLO,
            'monte_carlo_runs' => $monteCarloRuns,
            'monte_carlo_seed' => $this->monteCarloSeed($deckHash, $monteCarloRuns),
            'result_json' => json_encode(['label' => 'old snapshot'], JSON_THROW_ON_ERROR),
        ], $overrides);

        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO deck_advanced_analysis_snapshot (
    id,
    deck_id,
    deck_hash,
    analyzer_version,
    semantic_data_version,
    mana_data_version,
    combo_data_version,
    rules_version,
    monte_carlo_version,
    monte_carlo_runs,
    monte_carlo_seed,
    result_json,
    calculated_at,
    created_at,
    updated_at
) VALUES (
    :id,
    :deck_id,
    :deck_hash,
    :analyzer_version,
    :semantic_data_version,
    :mana_data_version,
    :combo_data_version,
    :rules_version,
    :monte_carlo_version,
    :monte_carlo_runs,
    :monte_carlo_seed,
    :result_json::jsonb,
    NOW(),
    NOW(),
    NOW()
)
SQL,
            $values,
        );
    }

    private function monteCarloSeed(string $deckHash, int $monteCarloRuns): string
    {
        unset($monteCarloRuns);

        return hash('sha256', implode('|', [
            $deckHash,
            DeckAdvancedAnalyzerVersion::CURRENT,
            DeckAdvancedAnalyzerVersion::MONTE_CARLO,
        ]));
    }

    private function connection(): \Doctrine\DBAL\Connection
    {
        return $this->entityManager->getConnection();
    }
}

final class RecordingAdvancedCalculator implements DeckAdvancedAnalysisCalculatorInterface
{
    public int $calls = 0;
    public string $resultLabel = 'analysis';

    public function calculate(DeckAdvancedAnalysisContext $context): array
    {
        ++$this->calls;

        return [
            'deckId' => $context->deck->id(),
            'deckHash' => $context->deckHash,
            'label' => $this->resultLabel.' #'.$this->calls,
            'monteCarloRuns' => $context->monteCarloRuns,
            'monteCarloSeed' => $context->monteCarloSeed,
            'cards' => [
                'unmatched' => [],
            ],
        ];
    }
}
