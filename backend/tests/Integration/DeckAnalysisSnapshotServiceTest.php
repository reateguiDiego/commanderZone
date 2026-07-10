<?php

namespace App\Tests\Integration;

use App\Application\Deck\DeckAnalysisDataVersionProvider;
use App\Application\Deck\DeckAnalysisDeckHasher;
use App\Application\Deck\DeckAnalysisService;
use App\Application\Deck\DeckAnalysisSnapshotService;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;

final class DeckAnalysisSnapshotServiceTest extends ApiTestCase
{
    public function testSnapshotMissCalculatesAndStoresResult(): void
    {
        [$deck] = $this->deckFixture('miss');
        $analysis = new RecordingBasicAnalysisService();
        $service = $this->service();

        $result = $service->analyze($deck, $analysis);

        self::assertSame(1, $analysis->calls);
        self::assertFalse($result['snapshot']['hit']);
        self::assertSame('missing', $result['snapshot']['reason']);
        self::assertSame($service->deckHash($deck), $result['snapshot']['deckHash']);
        self::assertArrayHasKey('optionsHash', $result['snapshot']);
        self::assertArrayHasKey('manaDataVersion', $result['snapshot']);
        self::assertSame('1', (string) $this->connection()->fetchOne('SELECT COUNT(*) FROM deck_analysis_snapshot WHERE deck_id = :deckId', ['deckId' => $deck->id()]));
    }

    public function testFreshSnapshotIsReturnedWithoutRecalculating(): void
    {
        [$deck] = $this->deckFixture('hit');
        $analysis = new RecordingBasicAnalysisService();
        $service = $this->service();
        $first = $service->analyze($deck, $analysis);

        $analysis->resultLabel = 'changed output';
        $second = $service->analyze($deck, $analysis);

        self::assertSame(1, $analysis->calls);
        self::assertFalse($first['snapshot']['hit']);
        self::assertTrue($second['snapshot']['hit']);
        self::assertSame('fresh', $second['snapshot']['reason']);
        self::assertSame('basic analysis #1', $second['label']);
    }

    public function testDeckChangeInvalidatesSnapshotUsingSharedDeckHash(): void
    {
        [$deck, $firstCard, $secondCard] = $this->deckFixture('deck-change');
        $analysis = new RecordingBasicAnalysisService();
        $service = $this->service();
        $service->analyze($deck, $analysis);
        $firstHash = $service->deckHash($deck);

        $deck->addOrIncrementCard($secondCard, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->flush();
        $result = $service->analyze($deck, $analysis);

        self::assertSame(2, $analysis->calls);
        self::assertSame('deck_hash_changed', $result['snapshot']['reason']);
        self::assertNotSame($firstHash, $service->deckHash($deck));
        self::assertNotNull($firstCard->oracleId());
    }

    public function testDifferentOptionsUseDifferentSnapshots(): void
    {
        [$deck] = $this->deckFixture('options');
        $analysis = new RecordingBasicAnalysisService();
        $service = $this->service();

        $default = $service->analyze($deck, $analysis);
        $draw = $service->analyze($deck, $analysis, ['curvePlayabilityMode' => 'draw']);

        self::assertSame(2, $analysis->calls);
        self::assertNotSame($default['snapshot']['optionsHash'], $draw['snapshot']['optionsHash']);
        self::assertSame('2', (string) $this->connection()->fetchOne('SELECT COUNT(*) FROM deck_analysis_snapshot WHERE deck_id = :deckId', ['deckId' => $deck->id()]));
    }

    public function testSemanticDataVersionChangeInvalidatesSnapshot(): void
    {
        [$deck] = $this->deckFixture('semantic-version');
        $analysis = new RecordingBasicAnalysisService();
        $service = $this->service();
        $service->analyze($deck, $analysis);
        (new DeckAnalysisDataVersionProvider($this->connection()))->setBoardWipeVersion('sha256:changed-basic-semantic');

        $result = $service->analyze($deck, $analysis);

        self::assertSame(2, $analysis->calls);
        self::assertSame('semantic_data_changed', $result['snapshot']['reason']);
    }

    /**
     * @return array{0:Deck,1:\App\Domain\Card\Card,2:\App\Domain\Card\Card}
     */
    private function deckFixture(string $suffix): array
    {
        $first = $this->seedCard('98000000-0000-0000-0000-'.substr(md5($suffix.'a'), 0, 12), 'Basic Snapshot Card '.$suffix, [
            'oracle_id' => '98000000-0000-0000-0001-'.substr(md5($suffix.'a'), 0, 12),
        ]);
        $second = $this->seedCard('98000000-0000-0000-0000-'.substr(md5($suffix.'b'), 0, 12), 'Basic Snapshot Second '.$suffix, [
            'oracle_id' => '98000000-0000-0000-0001-'.substr(md5($suffix.'b'), 0, 12),
        ]);
        $user = $this->user($suffix);
        $deck = new Deck($user, 'Basic Snapshot Deck '.$suffix);
        $deck->addOrIncrementCard($first, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($user);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        return [$deck, $first, $second];
    }

    private function user(string $suffix): User
    {
        $user = new User('basic-'.$suffix.'@example.test', substr('Basic'.$suffix, 0, 20));
        $user->setPassword('hash');

        return $user;
    }

    private function service(): DeckAnalysisSnapshotService
    {
        return new DeckAnalysisSnapshotService(
            $this->connection(),
            new DeckAnalysisDataVersionProvider($this->connection()),
            new DeckAnalysisDeckHasher($this->connection()),
        );
    }

    private function connection(): \Doctrine\DBAL\Connection
    {
        return $this->entityManager->getConnection();
    }
}

final class RecordingBasicAnalysisService extends DeckAnalysisService
{
    public int $calls = 0;
    public string $resultLabel = 'basic analysis';

    public function analyze(Deck $deck, array $options = []): array
    {
        ++$this->calls;

        return [
            'deckId' => $deck->id(),
            'label' => $this->resultLabel.' #'.$this->calls,
            'options' => $this->normalizeOptions($options),
            'summary' => [],
        ];
    }
}
