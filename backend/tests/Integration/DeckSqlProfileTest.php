<?php

namespace App\Tests\Integration;

use App\Infrastructure\Observability\RequestPerformanceContext;

final class DeckSqlProfileTest extends ApiTestCase
{
    public function testOptInPreservesPayloadAndOwnership(): void
    {
        $token = $this->registerAndLogin();
        $otherToken = $this->registerAndLogin('other-profile@example.test', 'Other');
        $this->jsonRequest('POST', '/decks', ['name' => 'Profile'], $token);
        self::assertResponseStatusCodeSame(201);
        $deck = $this->jsonResponse()['deck'];
        $url = '/decks/by-slug/'.$deck['slug'];
        $this->jsonRequest('GET', $url, token: $token);
        self::assertResponseIsSuccessful();
        $expected = $this->jsonResponse();
        self::assertArrayNotHasKey('sql_profile', static::getContainer()->get(RequestPerformanceContext::class)->metrics());
        $oldEnv = $_ENV['DECK_DETAIL_SQL_PROFILE_SLUG'] ?? null;
        $oldServer = $_SERVER['DECK_DETAIL_SQL_PROFILE_SLUG'] ?? null;
        try {
            self::ensureKernelShutdown();
            $_ENV['DECK_DETAIL_SQL_PROFILE_SLUG'] = $_SERVER['DECK_DETAIL_SQL_PROFILE_SLUG'] = $deck['slug'];
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
            $this->jsonRequest('GET', '/decks/'.$deck['id'], token: $token);
            self::assertResponseIsSuccessful();
            self::assertArrayNotHasKey('sql_profile', static::getContainer()->get(RequestPerformanceContext::class)->metrics());
        } finally {
            self::ensureKernelShutdown();
            if ($oldEnv === null) unset($_ENV['DECK_DETAIL_SQL_PROFILE_SLUG']);
            else $_ENV['DECK_DETAIL_SQL_PROFILE_SLUG'] = $oldEnv;
            if ($oldServer === null) unset($_SERVER['DECK_DETAIL_SQL_PROFILE_SLUG']);
            else $_SERVER['DECK_DETAIL_SQL_PROFILE_SLUG'] = $oldServer;
        }
    }
}
