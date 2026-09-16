<?php

namespace App\Tests\Integration;

use App\Application\Deck\DeckAnalysisExecution;
use Doctrine\DBAL\DriverManager;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;

final class DeckAnalysisExecutionTest extends ApiTestCase
{
    public function testIndependentConnectionCannotComputeSameDeckAndFailureReleasesLock(): void
    {
        $connection = $this->entityManager->getConnection();
        $other = DriverManager::getConnection($connection->getParams());
        $first = new DeckAnalysisExecution($connection);
        $second = new DeckAnalysisExecution($other);
        try {
            $first->run('fixture', 'basic', function () use ($second): array {
                self::assertSame(['ok'], $second->run('other-deck', 'basic', fn () => ['ok']));
                try {
                    $second->run('fixture', 'basic', fn () => self::fail('A second calculator entered the lock.'));
                    self::fail('Expected bounded waiting to fail.');
                } catch (ServiceUnavailableHttpException $error) {
                    self::assertSame(503, $error->getStatusCode());
                    self::assertSame('1', (string) $error->getHeaders()['Retry-After']);
                }
                throw new \RuntimeException('calculator failed');
            });
        } catch (\RuntimeException $error) {
            self::assertSame('calculator failed', $error->getMessage());
        }
        try {
            self::assertSame(['released'], $second->run('fixture', 'basic', fn () => ['released']));
        } finally {
            $other->close();
        }
    }
}
