<?php

namespace App\Tests\Integration;

use App\Infrastructure\Observability\RequestPerformanceContext;
use PHPUnit\Framework\Attributes\DataProvider;

final class DeckSqlProfileTest extends ApiTestCase
{
    public static function modes(): iterable
    {
        yield 'single slug' => [false];
        yield 'user window' => [true];
    }

    #[DataProvider('modes')]
    public function testOptInPreservesPayloadAndOwnership(bool $userWindow): void
    {
        $token = $this->registerAndLogin();
        $otherToken = $this->registerAndLogin('other-profile@example.test', 'Other');
        $this->jsonRequest('POST', '/decks', ['name' => 'Profile'], $token);
        self::assertResponseStatusCodeSame(201);
        $deck = $this->jsonResponse()['deck'];
        $owner = $this->entityManager->getConnection()->fetchOne('SELECT owner_id FROM deck WHERE id = ?', [$deck['id']]);
        $url = '/decks/by-slug/'.$deck['slug'];
        $this->jsonRequest('GET', $url, token: $token);
        self::assertResponseIsSuccessful();
        $expected = $this->jsonResponse();
        self::assertArrayNotHasKey('sql_profile', static::getContainer()->get(RequestPerformanceContext::class)->metrics());
        $oldEnv = $_ENV['DECK_DETAIL_SQL_PROFILE_SLUG'] ?? null;
        $oldServer = $_SERVER['DECK_DETAIL_SQL_PROFILE_SLUG'] ?? null;
        $previousWindow = [];
        foreach (['DECK_DETAIL_SQL_PROFILE_USER_ID', 'DECK_DETAIL_SQL_PROFILE_UNTIL'] as $key) {
            $previousWindow[$key] = [$_ENV[$key] ?? null, $_SERVER[$key] ?? null];
        }
        try {
            self::ensureKernelShutdown();
            $_ENV['DECK_DETAIL_SQL_PROFILE_SLUG'] = $_SERVER['DECK_DETAIL_SQL_PROFILE_SLUG'] = $deck['slug'];
            $_ENV['DECK_DETAIL_SQL_PROFILE_USER_ID'] = $_SERVER['DECK_DETAIL_SQL_PROFILE_USER_ID'] = $userWindow ? $owner : '';
            $_ENV['DECK_DETAIL_SQL_PROFILE_UNTIL'] = $_SERVER['DECK_DETAIL_SQL_PROFILE_UNTIL'] = $userWindow ? (string) (time() + 600) : '';
            $this->client = static::createClient();
            $this->jsonRequest('GET', $url, token: $token);
            self::assertResponseIsSuccessful();
            self::assertSame($expected, $this->jsonResponse());
            $metrics = static::getContainer()->get(RequestPerformanceContext::class)->metrics();
            self::assertNotEmpty($metrics['sql_profile']);
            self::assertSame('deck.load', $metrics['sql_profile'][0]['stage']);
            foreach (['load', 'preload', 'serialize', 'localize'] as $stage) {
                self::assertSame(1, $metrics['stages']['deck.'.$stage]['calls']);
            }
            $this->jsonRequest('GET', $url, token: $otherToken);
            self::assertResponseStatusCodeSame(404);
            if ($userWindow) {
                self::assertArrayNotHasKey('sql_profile', static::getContainer()->get(RequestPerformanceContext::class)->metrics());
                $this->jsonRequest('POST', '/decks', ['name' => 'Second profile deck'], $token);
                self::assertResponseStatusCodeSame(201);
                $second = $this->jsonResponse()['deck'];
                $this->jsonRequest('GET', '/decks/by-slug/'.$second['slug'], token: $token);
                self::assertResponseIsSuccessful();
                self::assertSame(hash('sha256', $second['slug']), static::getContainer()->get(RequestPerformanceContext::class)->metrics()['sql_profile_deck']);
            }
            $this->jsonRequest('GET', '/decks/'.$deck['id'], token: $token);
            self::assertResponseIsSuccessful();
            self::assertArrayNotHasKey('sql_profile', static::getContainer()->get(RequestPerformanceContext::class)->metrics());
        } finally {
            self::ensureKernelShutdown();
            if ($oldEnv === null) unset($_ENV['DECK_DETAIL_SQL_PROFILE_SLUG']);
            else $_ENV['DECK_DETAIL_SQL_PROFILE_SLUG'] = $oldEnv;
            if ($oldServer === null) unset($_SERVER['DECK_DETAIL_SQL_PROFILE_SLUG']);
            else $_SERVER['DECK_DETAIL_SQL_PROFILE_SLUG'] = $oldServer;
            foreach ($previousWindow as $key => [$env, $server]) {
                if ($env === null) unset($_ENV[$key]);
                else $_ENV[$key] = $env;
                if ($server === null) unset($_SERVER[$key]);
                else $_SERVER[$key] = $server;
            }
        }
    }
}
