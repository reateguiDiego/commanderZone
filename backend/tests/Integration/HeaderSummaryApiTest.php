<?php

namespace App\Tests\Integration;

use App\Domain\Friendship\Friendship;
use App\Domain\Message\UserMessage;
use App\Domain\Room\Room;
use App\Domain\Room\RoomInvite;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;

final class HeaderSummaryApiTest extends ApiTestCase
{
    public function testSummariesRequireAuthentication(): void
    {
        foreach (['/friends/summary', '/messages/summary', '/realtime/mercure-cookie'] as $path) {
            $this->jsonRequest($path === '/realtime/mercure-cookie' ? 'POST' : 'GET', $path);
            self::assertResponseStatusCodeSame(401);
        }
    }

    public function testMessagesCountAllReceivedMessagesBeyondListLimitAndIsolateRecipients(): void
    {
        $alice = $this->registerAndLogin('summary-alice@example.test', 'Summary Alice');
        $bob = $this->registerAndLogin('summary-bob@example.test', 'Summary Bob');
        $aliceId = $this->currentUserId($alice);
        $em = self::getContainer()->get(EntityManagerInterface::class);
        $user = $em->find(User::class, $aliceId);
        for ($i = 0; $i < 55; ++$i) {
            $message = UserMessage::system($user, 'Notice', str_repeat('Body', 1000));
            if ($i < 10) {
                $message->markRead();
            }
            $em->persist($message);
        }
        $em->flush();
        $this->jsonRequest('GET', '/messages/summary', token: $alice);
        self::assertResponseIsSuccessful();
        self::assertSame(['totalCount' => 56, 'unreadCount' => 46], $this->jsonResponse());
        $this->jsonRequest('GET', '/messages/summary', token: $bob);
        self::assertSame(['totalCount' => 1, 'unreadCount' => 1], $this->jsonResponse());
        $em = self::getContainer()->get(EntityManagerInterface::class);
        $em->createQuery('DELETE FROM '.UserMessage::class.' m')->execute();
        $this->jsonRequest('GET', '/messages/summary', token: $bob);
        self::assertSame(['totalCount' => 0, 'unreadCount' => 0], $this->jsonResponse());
    }

    public function testFriendsSummaryMatchesPresenceAndPendingListsInBothDirections(): void
    {
        $alice = $this->registerAndLogin('friends-summary-a@example.test', 'Summary A');
        $bob = $this->registerAndLogin('friends-summary-b@example.test', 'Summary B');
        $carol = $this->registerAndLogin('friends-summary-c@example.test', 'Summary C');
        $aliceId = $this->currentUserId($alice);
        $bobId = $this->currentUserId($bob);
        $carolId = $this->currentUserId($carol);
        $em = self::getContainer()->get(EntityManagerInterface::class);
        $a = $em->find(User::class, $aliceId);
        $b = $em->find(User::class, $bobId);
        $c = $em->find(User::class, $carolId);
        $friend = new Friendship($a, $b);
        $friend->accept();
        $em->persist($friend);
        $em->persist(new Friendship($c, $a));
        $room = new Room($b);
        $em->persist($room);
        $em->persist(new RoomInvite($room, $b, $a));
        $em->persist(new RoomInvite($room, $b, $c));
        $declined = new RoomInvite($room, $b, $a);
        $declined->decline();
        $em->persist($declined);
        $em->persist(new RoomPlayer($room, $b));
        $em->flush();
        $em->getConnection()->executeStatement('UPDATE room SET status = :status WHERE id = :id', ['status' => Room::STATUS_STARTED, 'id' => $room->id()]);
        $this->jsonRequest('GET', '/friends', token: $alice);
        self::assertSame('in_game', $this->jsonResponse()['data'][0]['friend']['presence']);
        $this->jsonRequest('GET', '/friends/summary', token: $alice);
        self::assertResponseIsSuccessful();
        self::assertSame(['onlineFriendsCount' => 1, 'incomingRequestsCount' => 1, 'roomInvitesCount' => 1], $this->jsonResponse());
        $this->jsonRequest('GET', '/friends/summary', token: $bob);
        self::assertSame(['onlineFriendsCount' => 1, 'incomingRequestsCount' => 0, 'roomInvitesCount' => 0], $this->jsonResponse());
        $this->jsonRequest('POST', '/me/offline', token: $bob);
        $this->jsonRequest('GET', '/friends/summary', token: $alice);
        self::assertSame(0, $this->jsonResponse()['onlineFriendsCount']);
        $this->jsonRequest('GET', '/friends/summary', token: $carol);
        self::assertSame(['onlineFriendsCount' => 0, 'incomingRequestsCount' => 0, 'roomInvitesCount' => 1], $this->jsonResponse());
        $em = self::getContainer()->get(EntityManagerInterface::class);
        $em->find(User::class, $bobId)->markSeen(new \DateTimeImmutable('-6 minutes'));
        $em->flush();
        $this->jsonRequest('GET', '/friends/summary', token: $alice);
        self::assertSame(0, $this->jsonResponse()['onlineFriendsCount']);
    }
}
