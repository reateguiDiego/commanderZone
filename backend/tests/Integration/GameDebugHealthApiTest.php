<?php

namespace App\Tests\Integration;

class GameDebugHealthApiTest extends ApiTestCase
{
    public function testDebugHealthRequiresAuthentication(): void
    {
        $fixture = $this->startedGameFixture('debug-health-auth');

        $this->jsonRequest('GET', '/games/'.$fixture['gameId'].'/debug/health');

        self::assertResponseStatusCodeSame(401);
    }

    public function testDebugHealthReturnsEmptyReportWhenNoDebugWebsocketIsConnected(): void
    {
        $fixture = $this->startedGameFixture('debug-health-empty');

        $this->jsonRequest('GET', '/games/'.$fixture['gameId'].'/debug/health', token: $fixture['ownerToken']);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame($fixture['gameId'], $response['gameId']);
        self::assertTrue($response['enabled']);
        self::assertIsArray($response['context']['players']);
        self::assertIsArray($response['health']);
    }

    public function testDebugHealthReturnsNotFoundWhenGameDoesNotExist(): void
    {
        $this->jsonRequest('GET', '/games/00000000-0000-7000-8000-000000000000/debug/health', token: $this->registerAndLogin('debug-health-missing@example.test', 'Debug Missing'));

        self::assertResponseStatusCodeSame(404);
    }

    public function testDebugHealthReturnsForbiddenForOutsider(): void
    {
        $fixture = $this->startedGameFixture('debug-health-forbidden');
        $outsiderToken = $this->registerAndLogin('debug-health-outsider@example.test', 'Debug Outsider');

        $this->jsonRequest('GET', '/games/'.$fixture['gameId'].'/debug/health', token: $outsiderToken);

        self::assertResponseStatusCodeSame(403);
    }

    public function testDebugHealthReturnsSanitizedHealthReportForGameViewer(): void
    {
        $fixture = $this->startedGameFixture('debug-health-success');

        $this->jsonRequest('GET', '/games/'.$fixture['gameId'].'/debug/health', token: $fixture['ownerToken']);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();

        self::assertSame($fixture['gameId'], $response['gameId']);
        self::assertTrue($response['enabled']);
        self::assertIsArray($response['context']);
        self::assertIsArray($response['context']['players']);
        self::assertIsInt($response['context']['viewerCount']);
        self::assertIsInt($response['context']['languageCount']);
        self::assertIsInt($response['context']['uniqueCardCount']);
        self::assertIsInt($response['context']['uniqueScryfallIdCount']);
        self::assertIsBool($response['context']['debugObserved']);
        self::assertArrayHasKey('usingLegacyLocalizationFallback', $response['context']);
        self::assertArrayNotHasKey('snapshot', $response);
        self::assertIsArray($response['health']);
        self::assertIsString($response['generatedAt']);
        self::assertIsString($response['updatedAt']);

        self::assertArrayHasKey('websocket', $response['health']);
        self::assertArrayHasKey('traffic', $response['health']);
        self::assertArrayHasKey('actions', $response['health']);
        self::assertArrayHasKey('pipeline', $response['health']);
        self::assertArrayHasKey('performance', $response['health']);
        self::assertArrayHasKey('replay', $response['health']);
        self::assertArrayHasKey('sync', $response['health']);
        self::assertArrayHasKey('errors', $response['health']);
        self::assertArrayHasKey('bootstrap', $response['health']);
        self::assertArrayHasKey('recent', $response['health']);
        self::assertArrayHasKey('events', $response['health']);
        self::assertSame(0, $response['health']['actions']['total']);
        self::assertSame(0, $response['health']['traffic']['incoming']['messages']);
        self::assertSame(0, $response['health']['bootstrap']['stages']['initial_snapshot']['count']);
        self::assertNotEmpty($response['context']['players']);
        $displayNames = array_column($response['context']['players'], 'displayName');
        self::assertContains('Ws Owner', $displayNames);
        self::assertContains('Ws Player', $displayNames);
        self::assertStringNotContainsString('Ws debug-health-success', json_encode($response, JSON_THROW_ON_ERROR));
        self::assertStringNotContainsString('Hidden card', json_encode($response, JSON_THROW_ON_ERROR));
    }

    /**
     * @return array{gameId: string, ownerToken: string, playerToken: string, ownerId: string}
     */
    private function startedGameFixture(string $slug): array
    {
        $ownerToken = $this->registerAndLogin($slug.'-owner@example.test', 'Ws Owner');
        $playerToken = $this->registerAndLogin($slug.'-player@example.test', 'Ws Player');
        $this->jsonRequest('GET', '/me', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $ownerId = (string) $this->jsonResponse()['user']['id'];
        $commanderScryfallId = sprintf('cccccccc-0000-7000-8000-%012d', abs(crc32($slug)));
        $landScryfallId = sprintf('dddddddd-1111-7111-8111-%012d', abs(crc32($slug.' land')));

        $this->seedCard($commanderScryfallId, 'Ws '.$slug.' Commander', [
            'type_line' => 'Legendary Creature - Human Soldier',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard($landScryfallId, 'Ws '.$slug.' Plains', [
            'type_line' => 'Basic Land - Plains',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Ws Owner Deck', $commanderScryfallId, $landScryfallId);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Ws Player Deck', $commanderScryfallId, $landScryfallId);

        $this->jsonRequest('POST', '/rooms', [
            'visibility' => 'public',
            'maxPlayers' => 2,
            'deckId' => $ownerDeckId,
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();

        $this->resolveTurnOrder($roomId, [$ownerToken, $playerToken]);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);

        return [
            'gameId' => (string) $this->jsonResponse()['game']['id'],
            'ownerToken' => $ownerToken,
            'playerToken' => $playerToken,
            'ownerId' => $ownerId,
        ];
    }

    private function quickBuildDeck(string $token, string $name, string $commanderScryfallId, string $landScryfallId): string
    {
        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => $name,
            'cards' => [
                ['scryfallId' => $commanderScryfallId, 'quantity' => 1, 'section' => 'commander'],
                ['scryfallId' => $landScryfallId, 'quantity' => 99, 'section' => 'main'],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);

        return (string) $this->jsonResponse()['deck']['id'];
    }

    /**
     * @param list<string> $tokens
     */
    private function resolveTurnOrder(string $roomId, array $tokens): void
    {
        for ($attempt = 0; $attempt < 20; ++$attempt) {
            $this->jsonRequest('GET', '/rooms/'.$roomId, token: $tokens[0]);
            self::assertResponseIsSuccessful();
            $players = $this->jsonResponse()['room']['players'] ?? [];
            if ($this->turnOrderResolved($players)) {
                return;
            }

            $progress = false;
            foreach ($tokens as $token) {
                $this->jsonRequest('POST', '/rooms/'.$roomId.'/roll-turn', token: $token);
                $statusCode = $this->getClient()->getResponse()->getStatusCode();
                if ($statusCode === 200) {
                    $progress = true;
                    continue;
                }

                $response = $this->jsonResponse();
                if ($statusCode === 409 && ($response['error'] ?? '') === 'Turn order has already been rolled.') {
                    continue;
                }

                self::fail(sprintf('Unexpected turn-order response %d: %s', $statusCode, json_encode($response, JSON_THROW_ON_ERROR)));
            }

            if (!$progress) {
                break;
            }
        }

        self::fail('Unable to resolve turn order after repeated rerolls.');
    }

    /**
     * @param list<array<string,mixed>> $players
     */
    private function turnOrderResolved(array $players): bool
    {
        $rolls = [];
        foreach ($players as $player) {
            $roll = $player['turnRoll'] ?? null;
            if (!is_int($roll)) {
                return false;
            }

            $rolls[] = $roll;
        }

        return count($rolls) >= 2 && count($rolls) === count(array_unique($rolls));
    }
}
