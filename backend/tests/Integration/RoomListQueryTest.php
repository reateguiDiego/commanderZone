<?php

namespace App\Tests\Integration;

use App\Application\Room\RoomListQuery;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;

final class RoomListQueryTest extends ApiTestCase
{
    public function testAllIncludesOnlyOwnedOrJoinedActiveGames(): void
    {
        $token = $this->registerAndLogin('membership@example.test', 'Member');
        $viewerId = $this->currentUserId($token);
        $viewer = $this->entityManager->find(User::class, $viewerId);
        $other = new User('other@example.test', 'Other');
        $other->setPassword('hash');
        $this->entityManager->persist($other);
        $expected = [];
        foreach (['owned', 'joined', 'outsider', 'finished', 'archived'] as $kind) {
            $room = new Room($kind === 'owned' ? $viewer : $other);
            $room->setName($kind);
            $room->setVisibility('public');
            $this->entityManager->persist($room);
            if ($kind !== 'outsider') $room->addPlayer(new RoomPlayer($room, $viewer));
            $game = new \App\Domain\Game\Game($room, []);
            if ($kind === 'finished') $game->finish();
            $this->entityManager->persist($game);
            $this->entityManager->flush();
            $room->start($game);
            $this->entityManager->flush();
            if ($kind === 'archived') $this->entityManager->getConnection()->executeStatement("UPDATE room SET status = 'archived' WHERE id = ?", [$room->id()]);
            if (in_array($kind, ['joined', 'owned'], true)) $expected[$kind] = $room->id();
        }
        $query = new RoomListQuery($this->entityManager->getConnection());
        self::assertSame([], $query->page($viewerId)['data']);
        self::assertSame([$expected['joined'], $expected['owned']], array_column($query->page($viewerId, 'all')['data'], 'id'));
        $first = $query->page($viewerId, 'all', 1);
        self::assertSame($expected['owned'], $query->page($viewerId, 'all', 1, $first['nextCursor'])['data'][0]['id']);
        $this->expectException(\InvalidArgumentException::class);
        $query->page($other->id(), 'all', 1, $first['nextCursor']);
    }

    public function testPagesPreserveRankNamesTiesVisibilityAndCompactPayload(): void
    {
        $token = $this->registerAndLogin('list@example.test', 'Viewer');
        $viewerId = $this->currentUserId($token);
        $viewer = $this->entityManager->find(User::class, $viewerId);
        $owner = new User('host@example.test', 'Hidden Host');
        $owner->setPassword('hash');
        $this->entityManager->persist($owner);
        $rooms = [];
        foreach (['Zulu', 'Alpha', 'Alpha', 'Full', 'Private', 'Archived', 'Started'] as $name) {
            $room = new Room($owner);
            $room->setName($name);
            $room->setVisibility($name === 'Private' ? 'private' : 'public');
            $room->setMaxPlayers(2);
            $room->addPlayer(new RoomPlayer($room, $owner));
            if (in_array($name, ['Full', 'Private'], true)) $room->addPlayer(new RoomPlayer($room, $viewer));
            $this->entityManager->persist($room);
            $rooms[] = $room;
        }
        $this->entityManager->flush();
        $db = $this->entityManager->getConnection();
        $db->executeStatement("UPDATE room SET status = 'archived' WHERE name = 'Archived'");
        $db->executeStatement("UPDATE room SET status = 'started' WHERE name = 'Started'");
        $query = new RoomListQuery($db);
        $ids = [];
        $names = [];
        $cursor = null;
        do {
            $page = $query->page($viewerId, 'active', 2, $cursor);
            self::assertLessThanOrEqual(2, count($page['data']));
            foreach ($page['data'] as $room) {
                $ids[] = $room['id'];
                $names[] = $room['name'];
                self::assertArrayNotHasKey('waitingLog', $room);
                self::assertArrayNotHasKey('deck', $room['players'][0]);
                self::assertSame('', $room['owner']['email']);
                self::assertIsBool($room['firstMulliganFree']);
                if ($room['visibility'] === 'private') {
                    self::assertSame('XXXX', $room['owner']['displayName']);
                    self::assertSame('XXXX', $room['players'][0]['user']['displayName']);
                    self::assertStringNotContainsString($owner->id(), json_encode($room));
                    self::assertSame($viewerId, $room['players'][1]['user']['id']);
                }
            }
            $cursor = $page['nextCursor'];
        } while ($cursor !== null);
        self::assertSame(['Alpha', 'Alpha', 'Zulu', 'Full', 'Private'], $names);
        self::assertCount(5, array_unique($ids));
        $ties = [$rooms[1]->id(), $rooms[2]->id()];
        sort($ties);
        self::assertSame($ties, array_slice($ids, 0, 2));
        self::assertCount(5, $query->page($viewerId, 'all')['data']);
        self::assertNull($query->page($viewerId, 'active', 5)['nextCursor']);
        self::assertCount(5, $query->page($viewerId, 'active', 100)['data']);
        self::assertSame('Hidden Host', $query->page($owner->id())['data'][4]['owner']['displayName']);

        $firstCursor = $query->page($viewerId, 'active', 1)['nextCursor'];
        // A deleted boundary remains usable: cursors carry values, not an offset or lookup ID.
        $db->executeStatement("UPDATE room SET status = 'archived' WHERE id = ?", [$ids[0]]);
        self::assertSame($ids[1], $query->page($viewerId, 'active', 1, $firstCursor)['data'][0]['id']);
        foreach (['limit=0', 'limit=101', 'limit=1.5', 'status=closed', 'cursor=garbage', 'status=all&cursor='.urlencode($firstCursor)] as $parameters) {
            $this->jsonRequest('GET', '/rooms?'.$parameters, token: $token);
            self::assertResponseStatusCodeSame(400);
        }
        $this->jsonRequest('GET', '/rooms?limit=1', token: $token);
        self::assertResponseIsSuccessful();
        self::assertCount(1, $this->jsonResponse()['data']);
        self::assertIsString($this->jsonResponse()['nextCursor']);
    }
}
