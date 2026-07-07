<?php

namespace App\Tests\Integration;

use App\Application\Card\CardOracleProfileRebuilder;
use App\Application\Deck\CardAnalysisProfileRebuilder;
use App\Application\Deck\DeckAdvancedAnalysisSnapshotService;
use App\Application\Deck\DeckAdvancedAnalyzerInterface;
use App\Application\Deck\DeckAdvancedAnalyzerService;
use App\Application\Deck\DeckAdvancedAnalyzerVersion;
use App\Application\Deck\DeckAnalysisDeckCardResolver;
use App\Application\Deck\DeckAnalysisDataVersionProvider;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;

final class DeckAdvancedAnalysisSnapshotServiceTest extends ApiTestCase
{
    public function testSnapshotMissCalculatesAndStoresResult(): void
    {
        [$deck] = $this->deckFixture('miss');
        $analyzer = new RecordingAdvancedAnalyzer();
        $service = $this->service($analyzer);

        $result = $service->analyze($deck);

        self::assertSame(1, $analyzer->calls);
        self::assertFalse($result['snapshot']['hit']);
        self::assertSame('missing', $result['snapshot']['reason']);
        self::assertSame('1', (string) $this->connection()->fetchOne('SELECT COUNT(*) FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId', ['deckId' => $deck->id()]));
    }

    public function testFreshSnapshotIsReturnedWithoutRecalculating(): void
    {
        [$deck] = $this->deckFixture('hit');
        $analyzer = new RecordingAdvancedAnalyzer();
        $service = $this->service($analyzer);
        $first = $service->analyze($deck);

        $analyzer->resultLabel = 'changed analyzer output';
        $second = $service->analyze($deck);

        self::assertSame(1, $analyzer->calls);
        self::assertFalse($first['snapshot']['hit']);
        self::assertTrue($second['snapshot']['hit']);
        self::assertSame('fresh', $second['snapshot']['reason']);
        self::assertSame('analysis #1', $second['label']);
    }

    public function testDeckChangeInvalidatesSnapshot(): void
    {
        [$deck, $firstCard, $secondCard] = $this->deckFixture('deck-change');
        $analyzer = new RecordingAdvancedAnalyzer();
        $service = $this->service($analyzer);
        $service->analyze($deck);
        $firstHash = $service->deckHash($deck);

        $deck->addOrIncrementCard($secondCard, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->flush();
        $result = $service->analyze($deck);

        self::assertSame(2, $analyzer->calls);
        self::assertSame('deck_hash_changed', $result['snapshot']['reason']);
        self::assertNotSame($firstHash, $service->deckHash($deck));
        self::assertNotNull($firstCard->oracleId());
    }

    public function testAnalyzerVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('analyzer-version');
        $service = $this->service(new DeckAdvancedAnalyzerService(new DeckAnalysisDeckCardResolver($this->connection())));
        $this->insertSnapshot($deck, ['analyzer_version' => 'old-version']);

        $result = $service->analyze($deck);

        self::assertSame('analyzer_version_changed', $result['snapshot']['reason']);
    }

    public function testSemanticDataVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('semantic-version');
        $service = $this->service(new RecordingAdvancedAnalyzer());
        $this->insertSnapshot($deck, ['semantic_data_version' => 'old-semantic']);

        $result = $service->analyze($deck);

        self::assertSame('semantic_data_changed', $result['snapshot']['reason']);
    }

    public function testComboDataVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('combo-version');
        $service = $this->service(new RecordingAdvancedAnalyzer());
        $this->insertSnapshot($deck, ['combo_data_version' => 'old-combo']);

        $result = $service->analyze($deck);

        self::assertSame('combo_data_changed', $result['snapshot']['reason']);
    }

    public function testRulesVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('rules-version');
        $service = $this->service(new RecordingAdvancedAnalyzer());
        $this->insertSnapshot($deck, ['rules_version' => 'old-rules']);

        $result = $service->analyze($deck);

        self::assertSame('rules_changed', $result['snapshot']['reason']);
    }

    public function testMonteCarloRunsChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('monte-runs');
        $analyzer = new RecordingAdvancedAnalyzer();
        $service = $this->service($analyzer);
        $service->analyze($deck, 100000);

        $result = $service->analyze($deck, 50000);

        self::assertSame(2, $analyzer->calls);
        self::assertSame('monte_carlo_version_changed', $result['snapshot']['reason']);
        self::assertSame(50000, $result['monteCarloRuns']);
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
        $service = $this->service(new RecordingAdvancedAnalyzer());

        $first = $service->deckHash($deck);
        $second = $service->deckHash($deck);
        $deck->addOrIncrementCard($unmatched, 1, DeckCard::SECTION_COMMANDER);
        $this->entityManager->flush();

        self::assertSame($first, $second);
        self::assertNotSame($first, $service->deckHash($deck));
        self::assertFalse($service->analyze($deck)['snapshot']['hit']);
    }

    public function testAdvancedEndpointReturnsSnapshotMetadata(): void
    {
        $token = $this->registerAndLogin('advanced-snapshot@example.test', 'AdvSnap');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $card = $this->seedCard('97000000-0000-0000-0000-000000000201', 'Endpoint Analysis Card', [
            'oracle_id' => '97000000-0000-0000-0000-000000000301',
        ]);
        (new CardOracleProfileRebuilder($this->connection()))->rebuild();
        (new CardAnalysisProfileRebuilder($this->connection()))->rebuild();
        $deck = new Deck($user, 'Endpoint Advanced Snapshot');
        $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertArrayHasKey('snapshot', $response);
        self::assertFalse($response['snapshot']['hit']);
        self::assertSame('missing', $response['snapshot']['reason']);
        self::assertSame(DeckAdvancedAnalyzerVersion::CURRENT, $response['snapshot']['analyzerVersion']);
        self::assertSame(DeckAdvancedAnalyzerVersion::DEFAULT_MONTE_CARLO_RUNS, $response['monteCarlo']['runs']);
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

    private function service(DeckAdvancedAnalyzerInterface $analyzer): DeckAdvancedAnalysisSnapshotService
    {
        return new DeckAdvancedAnalysisSnapshotService(
            $this->connection(),
            new DeckAnalysisDataVersionProvider($this->connection()),
            $analyzer,
        );
    }

    /**
     * @param array<string,mixed> $overrides
     */
    private function insertSnapshot(Deck $deck, array $overrides): void
    {
        $service = $this->service(new RecordingAdvancedAnalyzer());
        $deckHash = $service->deckHash($deck);
        $versions = (new DeckAnalysisDataVersionProvider($this->connection()))->currentVersions();
        $values = array_replace([
            'id' => '97000000-0000-0000-0002-'.substr(md5($deck->id()), 0, 12),
            'deck_id' => $deck->id(),
            'deck_hash' => $deckHash,
            'analyzer_version' => DeckAdvancedAnalyzerVersion::CURRENT,
            'semantic_data_version' => $versions[DeckAnalysisDataVersionProvider::KEY_SEMANTIC],
            'combo_data_version' => $versions[DeckAnalysisDataVersionProvider::KEY_COMBO],
            'rules_version' => $versions[DeckAnalysisDataVersionProvider::KEY_RULES],
            'monte_carlo_version' => DeckAdvancedAnalyzerVersion::MONTE_CARLO,
            'monte_carlo_runs' => DeckAdvancedAnalyzerVersion::DEFAULT_MONTE_CARLO_RUNS,
            'monte_carlo_seed' => hash('sha256', $deckHash.'|'.DeckAdvancedAnalyzerVersion::CURRENT.'|'.DeckAdvancedAnalyzerVersion::MONTE_CARLO),
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

    private function connection(): \Doctrine\DBAL\Connection
    {
        return $this->entityManager->getConnection();
    }
}

final class RecordingAdvancedAnalyzer implements DeckAdvancedAnalyzerInterface
{
    public int $calls = 0;
    public string $resultLabel = 'analysis';

    public function analyze(Deck $deck, string $deckHash, int $monteCarloRuns, string $monteCarloSeed): array
    {
        ++$this->calls;

        return [
            'deckId' => $deck->id(),
            'deckHash' => $deckHash,
            'label' => $this->resultLabel.' #'.$this->calls,
            'monteCarloRuns' => $monteCarloRuns,
            'monteCarloSeed' => $monteCarloSeed,
            'cards' => [
                'unmatched' => [],
            ],
        ];
    }
}
