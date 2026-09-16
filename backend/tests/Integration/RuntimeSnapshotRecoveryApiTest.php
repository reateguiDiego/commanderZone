<?php

namespace App\Tests\Integration;

use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\User\User;

final class RuntimeSnapshotRecoveryApiTest extends ApiTestCase
{
    public function testUnsignedRuntimeSnapshotRecoveryRequestIsRejected(): void
    {
        $this->client->request('GET', '/internal/runtime/games/unknown/compact-snapshot', [], [], [
            'HTTP_ACCEPT' => 'application/json',
        ]);

        self::assertResponseStatusCodeSame(401);
    }

    public function testSignedRuntimeSnapshotRecoveryReturnsVerifiableCompactState(): void
    {
        $owner = new User('runtime-snapshot-owner@example.test', 'Runtime Owner');
        $owner->setPassword('test-password-hash');
        $room = new Room($owner);
        $game = new Game($room, [
            'version' => 7,
            'players' => [
                $owner->id() => [
                    'status' => 'active',
                    'zones' => [
                        'library' => [],
                        'hand' => [],
                        'battlefield' => [],
                        'graveyard' => [],
                        'exile' => [],
                        'command' => [],
                    ],
                ],
            ],
            'attachments' => [],
            'battlefieldStacks' => [],
            'arrows' => [],
            'specialEntities' => [],
            'stack' => [],
        ]);
        $this->entityManager->persist($owner);
        $this->entityManager->persist($room);
        $this->entityManager->persist($game);
        $this->entityManager->flush();

        $path = '/internal/runtime/games/'.$game->id().'/compact-snapshot';
        $this->client->request('GET', $path, [], [], [
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_COMMANDERZONE_SIGNATURE' => $this->recoverySignature($path),
        ]);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame($game->id(), $response['gameId']);
        self::assertSame(7, $response['version']);
        self::assertIsArray($response['snapshot']);
        self::assertArrayNotHasKey('cardCatalog', $response['snapshot']);
        self::assertSame(
            hash('sha256', json_encode($response['snapshot'], JSON_THROW_ON_ERROR)),
            $response['checksum'],
        );
    }

    private function recoverySignature(string $path): string
    {
        $secret = (string) static::getContainer()->getParameter('game_runtime_ticket_secret');

        return hash_hmac('sha256', "GET\n".$path, $secret);
    }
}
