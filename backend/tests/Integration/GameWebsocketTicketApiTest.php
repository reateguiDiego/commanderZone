<?php

namespace App\Tests\Integration;

class GameWebsocketTicketApiTest extends ApiTestCase
{
    public function testWebsocketTicketEndpointRequiresAuthentication(): void
    {
        $fixture = $this->startedGameFixture('ws-auth-required');

        $this->jsonRequest('POST', '/games/'.$fixture['gameId'].'/websocket-ticket');

        self::assertResponseStatusCodeSame(401);
    }

    public function testWebsocketTicketEndpointRejectsMissingGameAndOutsider(): void
    {
        $fixture = $this->startedGameFixture('ws-access');
        $outsiderToken = $this->registerAndLogin('ws-outsider@example.test', 'Ws Outsider');

        $this->jsonRequest('POST', '/games/00000000-0000-7000-8000-000000000000/websocket-ticket', token: $fixture['ownerToken']);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('POST', '/games/'.$fixture['gameId'].'/websocket-ticket', token: $outsiderToken);
        self::assertResponseStatusCodeSame(403);
    }

    public function testWebsocketTicketEndpointIssuesTicketForGameParticipants(): void
    {
        $fixture = $this->startedGameFixture('ws-ticket');

        $this->jsonRequest('POST', '/games/'.$fixture['gameId'].'/websocket-ticket', token: $fixture['ownerToken']);
        self::assertResponseIsSuccessful();
        $ownerResponse = $this->jsonResponse();

        self::assertIsString($ownerResponse['ticket']);
        self::assertNotSame('', $ownerResponse['ticket']);
        self::assertIsString($ownerResponse['expiresAt']);
        self::assertStringStartsWith('ws://127.0.0.1:8081/games/'.$fixture['gameId'].'?ticket=', (string) $ownerResponse['websocketUrl']);

        $this->jsonRequest('POST', '/games/'.$fixture['gameId'].'/websocket-ticket', token: $fixture['playerToken']);
        self::assertResponseIsSuccessful();
        self::assertIsString($this->jsonResponse()['ticket']);
    }

    /**
     * @return array{gameId: string, ownerToken: string, playerToken: string}
     */
    private function startedGameFixture(string $slug): array
    {
        $ownerToken = $this->registerAndLogin($slug.'-owner@example.test', 'Ws Owner');
        $playerToken = $this->registerAndLogin($slug.'-player@example.test', 'Ws Player');
        $commanderScryfallId = sprintf('aaaaaaaa-0000-7000-8000-%012d', abs(crc32($slug)));
        $landScryfallId = sprintf('bbbbbbbb-1111-7111-8111-%012d', abs(crc32($slug.' land')));

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

}
