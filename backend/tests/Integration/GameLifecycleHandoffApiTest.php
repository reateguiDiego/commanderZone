<?php

namespace App\Tests\Integration;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use App\Tests\Support\RecordingMercureHub;

final class GameLifecycleHandoffApiTest extends ApiTestCase
{
    public function testUnsignedLifecycleHandoffIsRejected(): void
    {
        $this->client->request('POST', '/internal/runtime/lifecycle', [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
        ], '{}');

        self::assertResponseStatusCodeSame(401);
    }

    public function testSignedFinishHandoffIsPersistedWithoutWritingGameEvent(): void
    {
        $owner = new User('handoff-owner@example.test', 'Handoff Owner');
        $owner->setPassword('test-password-hash');
        $room = new Room($owner);
        $game = new Game($room, [
            'version' => 1,
            'players' => [
                $owner->id() => ['status' => 'active'],
                'player-2' => ['status' => 'active'],
            ],
        ]);
        $this->entityManager->persist($owner);
        $this->entityManager->persist($room);
        $this->entityManager->persist($game);
        $this->entityManager->flush();

        $payload = [
            'eventId' => $game->id().':2',
            'gameId' => $game->id(),
            'type' => 'game.finished',
            'playerId' => 'player-2',
            'playerReason' => 'conceded',
            'winnerPlayerId' => $owner->id(),
            'finishReason' => 'last_player_standing',
            'clientActionId' => 'concede-player-2',
            'version' => 2,
            'generation' => 1,
            'fencing' => 9,
            'occurredAt' => '2026-08-10T12:00:00+00:00',
        ];

        $this->signedLifecycleRequest($payload);
        self::assertResponseIsSuccessful();
        self::assertSame('applied', $this->jsonResponse()['result']);

        $this->signedLifecycleRequest($payload);
        self::assertResponseIsSuccessful();
        self::assertSame('duplicate', $this->jsonResponse()['result']);

        $this->entityManager->clear();
        $persisted = $this->entityManager->find(Game::class, $game->id());
        self::assertInstanceOf(Game::class, $persisted);
        self::assertSame(Game::STATUS_FINISHED, $persisted->status());
        self::assertSame($owner->id(), $persisted->winnerPlayerId());
        self::assertSame('last_player_standing', $persisted->finishReason());
        self::assertSame('2026-08-10T12:00:00+00:00', $persisted->finishedAt()?->format(DATE_ATOM));
        self::assertSame('FINISHED', $persisted->snapshot()['gamePhase']);
        self::assertSame($owner->id(), $persisted->snapshot()['winnerPlayerId']);
        self::assertCount(0, $this->entityManager->getRepository(GameEvent::class)->findBy(['game' => $persisted]));
    }

    public function testExpelHandoffLeavesRoomTransfersOwnershipAndIsIdempotent(): void
    {
        $owner = new User('expelled-owner@example.test', 'Expelled Owner');
        $remaining = new User('remaining-player@example.test', 'Remaining Player');
        $owner->setPassword('test-password-hash');
        $remaining->setPassword('test-password-hash');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $remaining));
        $game = new Game($room, [
            'version' => 3,
            'players' => [
                $owner->id() => ['status' => 'active'],
                $remaining->id() => ['status' => 'active'],
            ],
        ]);
        $room->start($game);
        $this->entityManager->persist($owner);
        $this->entityManager->persist($remaining);
        $this->entityManager->persist($room);
        $this->entityManager->persist($game);
        $this->entityManager->flush();

        $payload = [
            'eventId' => $game->id().':4',
            'gameId' => $game->id(),
            'type' => 'player.expelled',
            'playerId' => $owner->id(),
            'clientActionId' => 'disconnect-expel-owner',
            'version' => 4,
            'generation' => 1,
            'fencing' => 4,
            'occurredAt' => '2026-08-10T12:05:00+00:00',
        ];

        RecordingMercureHub::reset();
        $this->signedLifecycleRequest($payload);
        self::assertResponseIsSuccessful();
        self::assertSame('applied', $this->jsonResponse()['result']);
        $this->signedLifecycleRequest($payload);
        self::assertResponseIsSuccessful();
        self::assertSame('duplicate', $this->jsonResponse()['result']);

        $this->entityManager->clear();
        $persistedRoom = $this->entityManager->find(Room::class, $room->id());
        $persistedGame = $this->entityManager->find(Game::class, $game->id());
        self::assertInstanceOf(Room::class, $persistedRoom);
        self::assertInstanceOf(Game::class, $persistedGame);
        self::assertSame($remaining->id(), $persistedRoom->owner()->id());
        self::assertCount(1, $persistedRoom->players());
        self::assertTrue($persistedRoom->hasPlayer($remaining));
        self::assertFalse($persistedRoom->hasPlayer($owner));
        self::assertFalse($persistedGame->canBeViewedBy($owner));
        self::assertTrue($persistedGame->canBeViewedBy($remaining));
        self::assertSame('leave_room', $persistedGame->rematchState()['votes'][$owner->id()]['vote'] ?? null);
        self::assertSame('conceded', $persistedGame->lifecycleState()['players'][$owner->id()]['status'] ?? null);
        self::assertCount(0, $this->entityManager->getRepository(GameEvent::class)->findBy(['game' => $persistedGame]));

        $roomUpdates = array_values(array_filter(
            RecordingMercureHub::updates(),
            static fn (array $update): bool => $update['topics'] === ['rooms/'.$room->id().'/waiting'],
        ));
        self::assertCount(1, $roomUpdates);
        $roomPayload = json_decode($roomUpdates[0]['data'], true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('room.player.left', $roomPayload['type'] ?? null);
    }

    /** @param array<string,mixed> $payload */
    private function signedLifecycleRequest(array $payload): void
    {
        $body = json_encode($payload, JSON_THROW_ON_ERROR);
        $secret = (string) static::getContainer()->getParameter('game_runtime_ticket_secret');
        $this->client->request('POST', '/internal/runtime/lifecycle', [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_COMMANDERZONE_SIGNATURE' => hash_hmac('sha256', $body, $secret),
        ], $body);
    }
}
