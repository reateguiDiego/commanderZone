<?php

namespace App\Tests\Integration;

use Doctrine\ORM\EntityManagerInterface;

class GameDebugHealthApiTest extends ApiTestCase
{
    protected function tearDown(): void
    {
        $this->setDebugHealthFlag('1');
        parent::tearDown();
    }

    public function testDebugHealthRequiresAuthentication(): void
    {
        $fixture = $this->startedGameFixture('debug-health-auth');

        $this->jsonRequest('GET', '/games/'.$fixture['gameId'].'/debug/health');

        self::assertResponseStatusCodeSame(401);
    }

    public function testDebugHealthReturnsNotFoundWhenFeatureFlagIsDisabled(): void
    {
        $fixture = $this->startedGameFixture('debug-health-flag-disabled');

        $this->setDebugHealthFlag('0');
        $this->rebootClient();

        $this->jsonRequest('GET', '/games/'.$fixture['gameId'].'/debug/health', token: $fixture['ownerToken']);

        self::assertResponseStatusCodeSame(404);
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

    public function testDebugHealthReturnsProjectedSnapshotAndHealthReportForGameViewer(): void
    {
        $fixture = $this->startedGameFixture('debug-health-success');

        $this->jsonRequest('GET', '/games/'.$fixture['gameId'].'/debug/health', token: $fixture['ownerToken']);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();

        self::assertSame($fixture['gameId'], $response['gameId']);
        self::assertIsArray($response['snapshot']);
        self::assertIsArray($response['health']);
        self::assertIsString($response['generatedAt']);
        self::assertIsString($response['updatedAt']);

        self::assertArrayHasKey('websocket', $response['health']);
        self::assertArrayHasKey('pipeline', $response['health']);
        self::assertArrayHasKey('replay', $response['health']);
        self::assertArrayHasKey('sync', $response['health']);
        self::assertArrayHasKey('errors', $response['health']);
        self::assertArrayHasKey('recent', $response['health']);
        self::assertArrayHasKey('events', $response['health']);

        $ownerId = $fixture['ownerId'];
        $players = $response['snapshot']['players'];
        self::assertIsArray($players);
        self::assertArrayHasKey($ownerId, $players);

        $opponentId = null;
        foreach (array_keys($players) as $playerId) {
            if ($playerId !== $ownerId) {
                $opponentId = $playerId;
                break;
            }
        }

        self::assertIsString($opponentId);
        $opponentHand = $players[$opponentId]['zones']['hand'] ?? [];
        self::assertNotEmpty($opponentHand);
        foreach ($opponentHand as $card) {
            self::assertSame('Hidden card', $card['name'] ?? null);
            self::assertStringContainsString('-hidden-hand-', (string) ($card['instanceId'] ?? ''));
        }
    }

    private function rebootClient(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->entityManager = static::getContainer()->get(EntityManagerInterface::class);
    }

    private function setDebugHealthFlag(string $value): void
    {
        putenv('GAME_DEBUG_HEALTH_ENABLED='.$value);
        $_ENV['GAME_DEBUG_HEALTH_ENABLED'] = $value;
        $_SERVER['GAME_DEBUG_HEALTH_ENABLED'] = $value;
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

        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $playerToken);

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

    private function rollTurnOrder(string $roomId, string $token): void
    {
        $this->jsonRequest('POST', '/rooms/'.$roomId.'/roll-turn', token: $token);
        self::assertResponseIsSuccessful();
    }
}
