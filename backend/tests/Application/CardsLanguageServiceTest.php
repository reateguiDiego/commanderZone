<?php

namespace App\Tests\Application;

use App\Application\Card\CardsLanguageService;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Result;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Clock\MockClock;

final class CardsLanguageServiceTest extends TestCase
{
    public function testWarmRequestsAcrossServiceInstancesDoNotQueryTheCatalog(): void
    {
        $connection = $this->connectionReturning([
            $this->signature(1),
            $this->coverage(50),
        ]);
        $cache = new ArrayAdapter();

        $first = (new CardsLanguageService($connection, $cache, 'prod'))->languageCoverage();
        for ($request = 0; $request < 10; ++$request) {
            self::assertSame($first, (new CardsLanguageService($connection, $cache, 'prod'))->languageCoverage());
        }
        self::assertSame(['code' => 'es', 'label' => 'Espanol', 'distinctCardNames' => 50, 'percentageOfEnglish' => 50.0], $first[1]);
    }

    public function testUnchangedCatalogReusesCoverageAfterSignatureExpires(): void
    {
        $connection = $this->connectionReturning([
            $this->signature(1),
            $this->coverage(50),
            $this->signature(1),
        ]);
        $clock = new MockClock();
        $service = new CardsLanguageService($connection, new ArrayAdapter(clock: $clock), 'prod');

        $first = $service->languageCoverage();
        $clock->sleep(61);
        self::assertSame($first, $service->languageCoverage());
    }

    #[DataProvider('catalogChanges')]
    public function testCatalogChangesRefreshCoverageAfterOneMinute(int $revision): void
    {
        $connection = $this->connectionReturning([
            $this->signature(1),
            $this->coverage(50),
            $this->signature($revision),
            $this->coverage(60),
        ]);
        $clock = new MockClock();
        $service = new CardsLanguageService($connection, new ArrayAdapter(clock: $clock), 'prod');

        self::assertSame(50, $service->languageCoverage()[1]['distinctCardNames']);
        $clock->sleep(59);
        self::assertSame(50, $service->languageCoverage()[1]['distinctCardNames']);
        $clock->sleep(2);
        self::assertSame(60, $service->languageCoverage()[1]['distinctCardNames']);
    }

    public static function catalogChanges(): iterable
    {
        yield 'insert' => [2];
        yield 'delete' => [3];
        yield 'update without row count change' => [4];
    }

    /** @param list<Result> $results */
    private function connectionReturning(array $results): Connection
    {
        $connection = $this->createMock(Connection::class);
        $connection->expects(self::exactly(count($results)))
            ->method('executeQuery')->willReturnOnConsecutiveCalls(...$results);

        return $connection;
    }

    private function signature(int $revision): Result
    {
        $result = $this->createMock(Result::class);
        $result->expects(self::once())->method('fetchAssociative')
            ->willReturn(['revision' => $revision]);

        return $result;
    }

    private function coverage(int $spanishCount): Result
    {
        $result = $this->createMock(Result::class);
        $result->expects(self::once())->method('fetchAllAssociative')->willReturn([
            ['lang' => 'en', 'distinct_card_names' => 100],
            ['lang' => 'es', 'distinct_card_names' => $spanishCount],
        ]);

        return $result;
    }
}
