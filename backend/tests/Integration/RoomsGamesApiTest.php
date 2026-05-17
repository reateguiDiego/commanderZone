<?php

namespace App\Tests\Integration;

use App\Tests\Support\RecordingMercureHub;

class RoomsGamesApiTest extends ApiTestCase
{
    public function testCurrentRoomEndpointReturnsActiveMembership(): void
    {
        $ownerToken = $this->registerAndLogin('current-room-owner@example.test', 'Current Room Owner');

        $this->jsonRequest('GET', '/rooms/current', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertNull($this->jsonResponse()['room']);
        self::assertNull($this->jsonResponse()['player']);
        self::assertNull($this->jsonResponse()['turn']);
        self::assertNull($this->jsonResponse()['viewerRole']);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 3], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/rooms/current', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $current = $this->jsonResponse();
        self::assertSame($roomId, $current['room']['id']);
        self::assertSame(1, $current['room']['playerCount']);
        self::assertArrayNotHasKey('players', $current['room']);
        self::assertIsString($current['player']['playerId']);
        self::assertNull($current['player']['deckName']);
        self::assertNull($current['turn']['number']);
        self::assertSame('owner_player', $current['viewerRole']);
    }

    public function testCurrentRoomEndpointIgnoresRoomsWithoutPlayers(): void
    {
        $ownerToken = $this->registerAndLogin('current-room-owner-only@example.test', 'Current Owner Only');

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 3], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->entityManager->getConnection()->executeStatement('DELETE FROM room_player WHERE room_id = ?', [$roomId]);
        $this->entityManager->clear();

        $this->jsonRequest('GET', '/rooms/current', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $current = $this->jsonResponse();
        self::assertNull($current['room']);
        self::assertNull($current['player']);
        self::assertNull($current['turn']);
        self::assertNull($current['viewerRole']);
    }

    public function testOwnerLeavingNonStartedRoomDeletesRoomAndClearsAllMemberships(): void
    {
        $ownerToken = $this->registerAndLogin('owner-leave-room-owner@example.test', 'Owner Leave Host');
        $guestToken = $this->registerAndLogin('owner-leave-room-guest@example.test', 'Owner Leave Guest');

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->entityManager->getConnection()->executeStatement('UPDATE room SET status = ? WHERE id = ?', ['open', $roomId]);
        $this->entityManager->clear();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/leave', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame(['left' => true, 'roomDeleted' => true], $this->jsonResponse());

        $this->jsonRequest('GET', '/rooms/current', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertNull($this->jsonResponse()['room']);

        $this->jsonRequest('GET', '/rooms/current', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertNull($this->jsonResponse()['room']);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2], $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2], $guestToken);
        self::assertResponseStatusCodeSame(201);
    }

    public function testGuestLeavingNonStartedOpenRoomClearsMembershipWithoutDeletingNonEmptyRoom(): void
    {
        $ownerToken = $this->registerAndLogin('guest-leave-open-owner@example.test', 'Guest Leave Host');
        $guestToken = $this->registerAndLogin('guest-leave-open-player@example.test', 'Guest Leave Player');

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 4], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->entityManager->getConnection()->executeStatement('UPDATE room SET status = ? WHERE id = ?', ['open', $roomId]);
        $this->entityManager->clear();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/leave', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertSame(['left' => true, 'roomDeleted' => false], $this->jsonResponse());

        $this->jsonRequest('GET', '/rooms/current', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertNull($this->jsonResponse()['room']);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2], $guestToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(1, $this->jsonResponse()['room']['players']);
        $this->assertRoomPlayersDoNotContainDisplayName($this->jsonResponse()['room'], 'Guest Leave Player');
    }

    public function testCreatingRoomDeletesExistingRoomMembershipBeforeCreatingNewRoom(): void
    {
        $this->seedCard('abababab-0000-7000-8000-000000000001', 'Commander Alpha', [
            'type_line' => 'Legendary Creature - Human Soldier',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('abababab-1111-7111-8111-111111111111', 'Mountain', [
            'type_line' => 'Basic Land â€” Mountain',
            'set' => 'tst',
            'collector_number' => '30',
        ]);
        $ownerToken = $this->registerAndLogin('single-room-owner@example.test', 'Single Room Owner');
        $guestToken = $this->registerAndLogin('single-room-guest@example.test', 'Single Room Guest');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Owner Single Deck', [
            ['scryfallId' => 'abababab-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $guestDeckId = $this->quickBuildDeck($guestToken, 'Guest Single Deck', [
            ['scryfallId' => 'abababab-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', [
            'visibility' => 'public',
            'maxPlayers' => 2,
            'startingLife' => 35,
            'timerMode' => 'turn',
            'timerDurationSeconds' => 120,
            'deckId' => $ownerDeckId,
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $firstRoomId = (string) $this->jsonResponse()['room']['id'];
        self::assertArrayHasKey('createdAt', $this->jsonResponse()['room']);
        self::assertArrayHasKey('updatedAt', $this->jsonResponse()['room']);
        self::assertSame(35, $this->jsonResponse()['room']['startingLife']);
        self::assertSame('turn', $this->jsonResponse()['room']['timerMode']);
        self::assertSame(120, $this->jsonResponse()['room']['timerDurationSeconds']);

        $this->jsonRequest('POST', '/rooms/'.$firstRoomId.'/join', ['deckId' => $guestDeckId], $guestToken);
        self::assertResponseIsSuccessful();

        $this->rollTurnOrder($firstRoomId, $ownerToken);
        $this->rollTurnOrder($firstRoomId, $guestToken);

        $this->jsonRequest('POST', '/rooms/'.$firstRoomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $firstGameId = (string) $this->jsonResponse()['game']['id'];
        self::assertArrayHasKey('createdAt', $this->jsonResponse()['game']);
        self::assertArrayHasKey('updatedAt', $this->jsonResponse()['game']);
        self::assertSame('turn', $this->jsonResponse()['game']['snapshot']['timer']['mode']);
        self::assertSame(120, $this->jsonResponse()['game']['snapshot']['timer']['durationSeconds']);
        foreach ($this->jsonResponse()['game']['snapshot']['players'] as $playerSnapshot) {
            self::assertSame(35, $playerSnapshot['life']);
            self::assertSame('back_5', $playerSnapshot['backgroundName']);
            self::assertSame('facedown_card', $playerSnapshot['sleevesName']);
        }

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $newRoomId = (string) $this->jsonResponse()['room']['id'];
        self::assertNotSame($firstRoomId, $newRoomId);

        $this->jsonRequest('GET', '/rooms/'.$firstRoomId, token: $ownerToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/games/'.$firstGameId.'/snapshot', token: $ownerToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/rooms/current', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame($newRoomId, $this->jsonResponse()['room']['id']);
    }

    public function testJoiningAnotherRoomFailsUntilUserLeavesCurrentRoom(): void
    {
        $firstOwnerToken = $this->registerAndLogin('single-join-first-owner@example.test', 'Single Join First Owner');
        $secondOwnerToken = $this->registerAndLogin('single-join-second-owner@example.test', 'Single Join Second Owner');
        $playerToken = $this->registerAndLogin('single-join-player@example.test', 'Single Join Player');

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 3], $firstOwnerToken);
        self::assertResponseStatusCodeSame(201);
        $firstRoomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$firstRoomId.'/join', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 3], $secondOwnerToken);
        self::assertResponseStatusCodeSame(201);
        $secondRoomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$secondRoomId.'/join', token: $playerToken);
        self::assertResponseStatusCodeSame(409);
        self::assertStringContainsString('Leave your current room', (string) $this->jsonResponse()['error']);

        $this->jsonRequest('GET', '/rooms/'.$firstRoomId, token: $firstOwnerToken);
        self::assertResponseIsSuccessful();
        $this->assertRoomPlayersContainDisplayName($this->jsonResponse()['room'], 'Single Join Player');

        $this->jsonRequest('POST', '/rooms/'.$firstRoomId.'/leave', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame(['left' => true, 'roomDeleted' => false], $this->jsonResponse());

        $this->jsonRequest('POST', '/rooms/'.$secondRoomId.'/join', token: $playerToken);
        self::assertResponseIsSuccessful();
        $this->assertRoomPlayersContainDisplayName($this->jsonResponse()['room'], 'Single Join Player');
    }

    public function testCreatingRoomDeletesPreviousJoinedMembershipRoom(): void
    {
        $ownerToken = $this->registerAndLogin('single-create-host@example.test', 'Single Create Host');
        $playerToken = $this->registerAndLogin('single-create-player@example.test', 'Single Create Player');

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 3], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $previousRoomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$previousRoomId.'/join', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2], $playerToken);
        self::assertResponseStatusCodeSame(201);
        $newRoom = $this->jsonResponse()['room'];
        self::assertSame('Single Create Player', $newRoom['owner']['displayName']);
        $this->assertRoomPlayersContainDisplayName($newRoom, 'Single Create Player');

        $this->jsonRequest('GET', '/rooms/'.$previousRoomId, token: $ownerToken);
        self::assertResponseStatusCodeSame(404);
    }

    public function testAcceptingInviteFailsUntilUserLeavesCurrentRoom(): void
    {
        $previousOwnerToken = $this->registerAndLogin('single-invite-previous-owner@example.test', 'Prev Invite Owner');
        $inviteOwnerToken = $this->registerAndLogin('single-invite-owner@example.test', 'Single Invite Owner');
        $playerToken = $this->registerAndLogin('single-invite-player@example.test', 'Single Invite Player');

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'single-invite-player@example.test'], $inviteOwnerToken);
        self::assertResponseStatusCodeSame(201);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $playerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 3], $previousOwnerToken);
        self::assertResponseStatusCodeSame(201);
        $previousRoomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$previousRoomId.'/join', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 3], $inviteOwnerToken);
        self::assertResponseStatusCodeSame(201);
        $inviteRoomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/friends', token: $inviteOwnerToken);
        self::assertResponseIsSuccessful();
        $playerId = (string) $this->jsonResponse()['data'][0]['friend']['id'];

        $this->jsonRequest('POST', '/rooms/'.$inviteRoomId.'/invites', ['userId' => $playerId], $inviteOwnerToken);
        self::assertResponseStatusCodeSame(201);
        $inviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', token: $playerToken);
        self::assertResponseStatusCodeSame(409);
        self::assertStringContainsString('Leave your current room', (string) $this->jsonResponse()['error']);

        $this->jsonRequest('GET', '/rooms/'.$previousRoomId, token: $previousOwnerToken);
        self::assertResponseIsSuccessful();
        $this->assertRoomPlayersContainDisplayName($this->jsonResponse()['room'], 'Single Invite Player');

        $this->jsonRequest('POST', '/rooms/'.$previousRoomId.'/leave', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame(['left' => true, 'roomDeleted' => false], $this->jsonResponse());

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', token: $playerToken);
        self::assertResponseIsSuccessful();
        $this->assertRoomPlayersContainDisplayName($this->jsonResponse()['room'], 'Single Invite Player');
    }

    public function testCreatingRoomDeletesPreviousStartedRoomAndGame(): void
    {
        $this->seedCard('dddddddd-0000-7000-8000-000000000001', 'Commander Started Membership', [
            'type_line' => 'Legendary Creature - Human Knight',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('dddddddd-1111-7111-8111-111111111111', 'Forest Started Membership', [
            'type_line' => 'Basic Land - Forest',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $ownerToken = $this->registerAndLogin('single-started-owner@example.test', 'Single Started Owner');
        $playerToken = $this->registerAndLogin('single-started-player@example.test', 'Single Started Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Started Owner Deck', [
            ['scryfallId' => 'dddddddd-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'dddddddd-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Started Player Deck', [
            ['scryfallId' => 'dddddddd-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'dddddddd-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $startedRoomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$startedRoomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();
        $this->rollTurnOrder($startedRoomId, $ownerToken);
        $this->rollTurnOrder($startedRoomId, $playerToken);

        $this->jsonRequest('POST', '/rooms/'.$startedRoomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $playerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2, 'deckId' => $playerDeckId], $playerToken);
        self::assertResponseStatusCodeSame(201);
        $newRoomId = (string) $this->jsonResponse()['room']['id'];
        self::assertNotSame($startedRoomId, $newRoomId);

        $this->jsonRequest('GET', '/rooms/'.$startedRoomId, token: $ownerToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $playerToken);
        self::assertResponseStatusCodeSame(404);
    }

    public function testLeavingStartedRoomDeletesRoomAndGameWhenNoPlayersRemain(): void
    {
        $this->seedCard('eeeeeeee-0000-7000-8000-000000000001', 'Commander Epsilon', [
            'type_line' => 'Legendary Creature - Human Soldier',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '5',
        ]);
        $this->seedCard('eeeeeeee-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'set' => 'tst',
            'collector_number' => '50',
        ]);
        $ownerToken = $this->registerAndLogin('last-started-owner@example.test', 'Last Started Owner');
        $playerToken = $this->registerAndLogin('last-started-player@example.test', 'Last Started Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Last Owner Deck', [
            ['scryfallId' => 'eeeeeeee-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'eeeeeeee-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Last Player Deck', [
            ['scryfallId' => 'eeeeeeee-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'eeeeeeee-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();
        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $playerToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->entityManager->getConnection()->executeStatement(
            'DELETE FROM room_player WHERE room_id = ? AND user_id = (SELECT id FROM app_user WHERE email = ?)',
            [$roomId, 'last-started-owner@example.test'],
        );
        $this->entityManager->clear();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/leave', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame(['left' => true, 'roomDeleted' => true], $this->jsonResponse());

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseStatusCodeSame(404);
    }

    public function testDefeatedPlayerPlayAgainVoteWaitsUntilGameEnds(): void
    {
        $fixture = $this->startedRematchGameFixture('wait', [
            ['owner-wait@example.test', 'Rematch Wait Winner'],
            ['defeated-wait@example.test', 'Rematch Wait Defeated'],
            ['alive-wait@example.test', 'Rematch Wait Alive'],
        ]);
        $gameId = $fixture['gameId'];
        $roomId = $fixture['roomId'];
        $defeatedPlayerId = $this->playerIdByName($fixture['snapshot'], 'Rematch Wait Defeated');

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'life.changed',
            'payload' => ['playerId' => $defeatedPlayerId, 'delta' => -40],
        ], $fixture['tokens']['Rematch Wait Defeated']);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('POST', '/games/'.$gameId.'/rematch-vote', [
            'vote' => 'play_again',
        ], $fixture['tokens']['Rematch Wait Defeated']);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame('waiting_for_game_end', $response['status']);
        self::assertSame('Tu voto se ha guardado. Espera a que termine la partida.', $response['message']);
        self::assertSame('play_again', $response['snapshot']['rematch']['votes'][$defeatedPlayerId]['vote']);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $fixture['tokens']['Rematch Wait Winner']);
        self::assertResponseIsSuccessful();
        self::assertSame('started', $this->jsonResponse()['room']['status']);
        self::assertSame($gameId, $this->jsonResponse()['room']['gameId']);
    }

    public function testRematchVotesReturnSameRoomToWaitingWithVotingPlayers(): void
    {
        $fixture = $this->startedRematchGameFixture('ready', [
            ['owner-ready@example.test', 'Rematch Ready Winner'],
            ['defeated-ready-one@example.test', 'Rematch Ready One'],
            ['defeated-ready-two@example.test', 'Rematch Ready Two'],
        ]);
        $gameId = $fixture['gameId'];
        $roomId = $fixture['roomId'];
        $winnerPlayerId = $this->playerIdByName($fixture['snapshot'], 'Rematch Ready Winner');
        $firstDefeatedPlayerId = $this->playerIdByName($fixture['snapshot'], 'Rematch Ready One');
        $secondDefeatedPlayerId = $this->playerIdByName($fixture['snapshot'], 'Rematch Ready Two');

        foreach ([
            [$firstDefeatedPlayerId, $fixture['tokens']['Rematch Ready One']],
            [$secondDefeatedPlayerId, $fixture['tokens']['Rematch Ready Two']],
        ] as [$playerId, $token]) {
            $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
                'type' => 'life.changed',
                'payload' => ['playerId' => $playerId, 'delta' => -40],
            ], $token);
            self::assertResponseStatusCodeSame(201);
        }

        $this->jsonRequest('POST', '/games/'.$gameId.'/rematch-vote', [
            'vote' => 'play_again',
        ], $fixture['tokens']['Rematch Ready One']);
        self::assertResponseIsSuccessful();
        self::assertSame('waiting_for_votes', $this->jsonResponse()['status']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/rematch-vote', [
            'vote' => 'play_again',
        ], $fixture['tokens']['Rematch Ready Winner']);
        self::assertResponseIsSuccessful();
        self::assertSame('waiting_for_votes', $this->jsonResponse()['status']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/rematch-vote', [
            'vote' => 'leave',
        ], $fixture['tokens']['Rematch Ready Two']);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame('room_ready', $response['status']);
        self::assertSame($roomId, $response['room']['id']);
        self::assertSame('waiting', $response['room']['status']);
        self::assertNull($response['room']['gameId']);
        self::assertSame(2, $response['room']['maxPlayers']);
        $this->assertRoomPlayersContainDisplayName($response['room'], 'Rematch Ready Winner');
        $this->assertRoomPlayersContainDisplayName($response['room'], 'Rematch Ready One');
        $this->assertRoomPlayersDoNotContainDisplayName($response['room'], 'Rematch Ready Two');
        self::assertSame('Rematch Ready Winner', $response['room']['owner']['displayName']);
        self::assertSame([null, null], array_column($response['room']['players'], 'turnRoll'));

        $gameRematchUpdates = array_values(array_filter(
            RecordingMercureHub::updates(),
            static function (array $update) use ($gameId, $roomId): bool {
                if ($update['topics'] !== ['games/'.$gameId]) {
                    return false;
                }

                $payload = json_decode($update['data'], true, flags: JSON_THROW_ON_ERROR);

                return ($payload['event']['type'] ?? null) === 'room.rematch.created'
                    && ($payload['event']['payload']['roomId'] ?? null) === $roomId;
            },
        ));
        self::assertNotEmpty($gameRematchUpdates);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $fixture['tokens']['Rematch Ready Winner']);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $fixture['tokens']['Rematch Ready One']);
        self::assertResponseIsSuccessful();
        self::assertSame('waiting', $this->jsonResponse()['room']['status']);
    }

    public function testRematchReadyWorksForRoomSizesTwoThroughSix(): void
    {
        for ($playerCount = 2; $playerCount <= 6; ++$playerCount) {
            $players = [];
            for ($index = 1; $index <= $playerCount; ++$index) {
                $players[] = [
                    sprintf('rematch-size-%d-player-%d@example.test', $playerCount, $index),
                    sprintf('Rematch Size %d Player %d', $playerCount, $index),
                ];
            }

            $fixture = $this->startedRematchGameFixture('size-'.$playerCount, $players);
            $gameId = $fixture['gameId'];
            $roomId = $fixture['roomId'];
            $winnerName = $players[0][1];
            $firstDefeatedName = $players[1][1];

            foreach (array_slice($players, 1) as [, $displayName]) {
                $defeatedPlayerId = $this->playerIdByName($fixture['snapshot'], $displayName);
                $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
                    'type' => 'life.changed',
                    'payload' => ['playerId' => $defeatedPlayerId, 'delta' => -40],
                ], $fixture['tokens'][$displayName]);
                self::assertResponseStatusCodeSame(201);
            }

            $this->jsonRequest('POST', '/games/'.$gameId.'/rematch-vote', [
                'vote' => 'play_again',
            ], $fixture['tokens'][$firstDefeatedName]);
            self::assertResponseIsSuccessful();
            self::assertSame('waiting_for_votes', $this->jsonResponse()['status']);

            $this->jsonRequest('POST', '/games/'.$gameId.'/rematch-vote', [
                'vote' => 'play_again',
            ], $fixture['tokens'][$winnerName]);
            self::assertResponseIsSuccessful();
            $response = $this->jsonResponse();

            if ($playerCount > 2) {
                self::assertSame('waiting_for_votes', $response['status']);
                foreach (array_slice($players, 2) as $index => [, $displayName]) {
                    $this->jsonRequest('POST', '/games/'.$gameId.'/rematch-vote', [
                        'vote' => 'leave',
                    ], $fixture['tokens'][$displayName]);
                    self::assertResponseIsSuccessful();
                    $response = $this->jsonResponse();

                    if ($index < $playerCount - 3) {
                        self::assertSame('left', $response['status']);
                    }
                }
            }

            self::assertSame('room_ready', $response['status']);
            self::assertSame($roomId, $response['room']['id']);
            self::assertSame('waiting', $response['room']['status']);
            self::assertNull($response['room']['gameId']);
            self::assertSame(2, $response['room']['maxPlayers']);
            self::assertCount(2, $response['room']['players']);
            $this->assertRoomPlayersContainDisplayName($response['room'], $winnerName);
            $this->assertRoomPlayersContainDisplayName($response['room'], $firstDefeatedName);

            $gameRematchUpdates = array_values(array_filter(
                RecordingMercureHub::updates(),
                static function (array $update) use ($gameId, $roomId): bool {
                    if ($update['topics'] !== ['games/'.$gameId]) {
                        return false;
                    }

                    $payload = json_decode($update['data'], true, flags: JSON_THROW_ON_ERROR);

                    return ($payload['event']['type'] ?? null) === 'room.rematch.created'
                        && ($payload['event']['payload']['roomId'] ?? null) === $roomId;
                },
            ));
            self::assertNotEmpty($gameRematchUpdates);
        }
    }

    public function testLastRematchLeaveDeletesRoomAndClearsCurrentRoomForParticipants(): void
    {
        $fixture = $this->startedRematchGameFixture('leave-last', [
            ['rematch-leave-owner@example.test', 'Rematch Leave Owner'],
            ['rematch-leave-guest@example.test', 'Rematch Leave Guest'],
        ]);
        $gameId = $fixture['gameId'];
        $roomId = $fixture['roomId'];

        $this->jsonRequest('POST', '/games/'.$gameId.'/rematch-vote', [
            'vote' => 'leave',
        ], $fixture['tokens']['Rematch Leave Guest']);
        self::assertResponseIsSuccessful();
        self::assertSame('left', $this->jsonResponse()['status']);

        $this->jsonRequest('GET', '/rooms/current', token: $fixture['tokens']['Rematch Leave Guest']);
        self::assertResponseIsSuccessful();
        self::assertNull($this->jsonResponse()['room']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/rematch-vote', [
            'vote' => 'leave',
        ], $fixture['tokens']['Rematch Leave Owner']);
        self::assertResponseIsSuccessful();
        self::assertSame('room_deleted', $this->jsonResponse()['status']);
        self::assertTrue($this->jsonResponse()['roomDeleted']);

        $this->jsonRequest('GET', '/rooms/current', token: $fixture['tokens']['Rematch Leave Owner']);
        self::assertResponseIsSuccessful();
        self::assertNull($this->jsonResponse()['room']);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $fixture['tokens']['Rematch Leave Owner']);
        self::assertResponseStatusCodeSame(404);
    }

    public function testRoomOwnerCanDeleteWaitingRooms(): void
    {
        $this->seedCard('aaaaaaaa-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land — Island',
            'set' => 'tst',
            'collector_number' => '10',
        ]);
        $ownerToken = $this->registerAndLogin('delete-owner@example.test', 'Delete Owner');
        $externalToken = $this->registerAndLogin('delete-external@example.test', 'Delete External');
        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Delete Deck', [
            ['scryfallId' => 'aaaaaaaa-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('DELETE', '/rooms/'.$roomId, token: $externalToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('DELETE', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseStatusCodeSame(204);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseStatusCodeSame(404);
    }

    public function testRoomOwnerCanKickWaitingRoomPlayers(): void
    {
        $ownerToken = $this->registerAndLogin('kick-owner@example.test', 'Kick Owner');
        $guestToken = $this->registerAndLogin('kick-guest@example.test', 'Kick Guest');
        $externalToken = $this->registerAndLogin('kick-external@example.test', 'Kick External');

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 3], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];
        $ownerPlayerId = (string) $this->jsonResponse()['room']['players'][0]['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $guestPlayerId = '';
        foreach ($this->jsonResponse()['room']['players'] as $player) {
            if (($player['user']['displayName'] ?? null) === 'Kick Guest') {
                $guestPlayerId = (string) $player['id'];
            }
        }
        self::assertNotSame('', $guestPlayerId);

        $this->jsonRequest('DELETE', '/rooms/'.$roomId.'/players/'.$guestPlayerId, token: $externalToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('DELETE', '/rooms/'.$roomId.'/players/'.$ownerPlayerId, token: $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('DELETE', '/rooms/'.$roomId.'/players/'.$guestPlayerId, token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(1, $this->jsonResponse()['room']['players']);
        self::assertSame('Kick Owner', $this->jsonResponse()['room']['players'][0]['user']['displayName']);
    }

    public function testPrivateRoomVisibilityForOutsiderInvitedAndParticipant(): void
    {
        $this->seedCard('cccccccc-0000-7000-8000-000000000001', 'Commander Privacy', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('cccccccc-1111-7111-8111-111111111111', 'Swamp', [
            'type_line' => 'Basic Land â€” Swamp',
            'set' => 'tst',
            'collector_number' => '40',
        ]);
        $ownerToken = $this->registerAndLogin('privacy-owner@example.test', 'Privacy Owner');
        $invitedToken = $this->registerAndLogin('privacy-invited@example.test', 'Privacy Invited');
        $participantToken = $this->registerAndLogin('privacy-participant@example.test', 'Privacy Participant');
        $outsiderToken = $this->registerAndLogin('privacy-outsider@example.test', 'Privacy Outsider');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Privacy Owner Deck', [
            ['scryfallId' => 'cccccccc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'cccccccc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $participantDeckId = $this->quickBuildDeck($participantToken, 'Privacy Part Deck', [
            ['scryfallId' => 'cccccccc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'cccccccc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'privacy-invited@example.test'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $invitedFriendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$invitedFriendshipId.'/accept', token: $invitedToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'privacy-participant@example.test'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $participantFriendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$participantFriendshipId.'/accept', token: $participantToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/friends', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $friendIdsByName = [];
        foreach ($this->jsonResponse()['data'] as $friendship) {
            $friend = $friendship['friend'] ?? null;
            if (!is_array($friend)) {
                continue;
            }
            $friendIdsByName[(string) ($friend['displayName'] ?? '')] = (string) ($friend['id'] ?? '');
        }
        self::assertArrayHasKey('Privacy Invited', $friendIdsByName);
        self::assertArrayHasKey('Privacy Participant', $friendIdsByName);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $friendIdsByName['Privacy Invited']], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $invitedInviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $friendIdsByName['Privacy Participant']], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $participantInviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $outsiderToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['room']['id']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $participantDeckId], $outsiderToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('valid deck', (string) $this->jsonResponse()['error']);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $invitedToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['room']['id']);

        $this->jsonRequest('GET', '/rooms/invites/incoming', token: $participantToken);
        self::assertResponseIsSuccessful();
        self::assertContains($participantInviteId, array_column($this->jsonResponse()['data'], 'id'));
        self::assertNotContains($invitedInviteId, array_column($this->jsonResponse()['data'], 'id'));

        $this->jsonRequest('POST', '/rooms/invites/'.$participantInviteId.'/accept', ['deckId' => $participantDeckId], $participantToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $participantToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['room']['id']);

        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $participantToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $participantToken);
        self::assertResponseIsSuccessful();
        self::assertSame('started', $this->jsonResponse()['room']['status']);
    }

    public function testPrivateWaitingRoomCanBeJoinedByDirectCode(): void
    {
        $this->seedCard('c0dec0de-0000-7000-8000-000000000001', 'Commander Private Code', [
            'type_line' => 'Legendary Creature - Human Scout',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('c0dec0de-1111-7111-8111-111111111111', 'Forest', [
            'type_line' => 'Basic Land - Forest',
            'color_identity' => ['G'],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('private-code-owner@example.test', 'Private Code Owner');
        $guestToken = $this->registerAndLogin('private-code-guest@example.test', 'Private Code Guest');
        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Private Code Deck', [
            ['scryfallId' => 'c0dec0de-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'c0dec0de-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 3, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/code/'.$this->roomCode($roomId).'/join', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['room']['id']);
        self::assertCount(2, $this->jsonResponse()['room']['players']);
    }

    public function testRoomListIncludesPrivateRoomsWithMaskedHostForOutsiders(): void
    {
        $ownerToken = $this->registerAndLogin('private-list-owner@example.test', 'Private List Owner');
        $outsiderToken = $this->registerAndLogin('private-list-outsider@example.test', 'Private List Outsider');

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'name' => 'Hidden Browser Room', 'maxPlayers' => 4], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/rooms', token: $outsiderToken);
        self::assertResponseIsSuccessful();
        $roomsById = [];
        foreach ($this->jsonResponse()['data'] as $room) {
            $roomsById[(string) $room['id']] = $room;
        }

        self::assertArrayHasKey($roomId, $roomsById);
        self::assertSame('private', $roomsById[$roomId]['visibility']);
        self::assertSame('XXXX', $roomsById[$roomId]['owner']['displayName']);
        self::assertSame('', $roomsById[$roomId]['owner']['email']);
    }

    public function testRoomStartFailsWhenAnyDeckIsNotCommanderValid(): void
    {
        $this->seedCard('dddddddd-0000-7000-8000-000000000001', 'Commander Start Gate', [
            'type_line' => 'Legendary Creature - Human Knight',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('dddddddd-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('start-gate-owner@example.test', 'Start Gate Owner');
        $playerToken = $this->registerAndLogin('start-gate-player@example.test', 'Start Gate Player');

        $invalidOwnerDeckId = $this->quickBuildDeck($ownerToken, 'Invalid Owner Deck', [
            ['scryfallId' => 'dddddddd-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Valid Player Deck', [
            ['scryfallId' => 'dddddddd-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'dddddddd-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2, 'deckId' => $invalidOwnerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $playerToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Commander-valid deck', (string) $this->jsonResponse()['error']);
        self::assertArrayHasKey('invalidDecks', $this->jsonResponse());
        self::assertCount(1, $this->jsonResponse()['invalidDecks']);
        self::assertSame($invalidOwnerDeckId, $this->jsonResponse()['invalidDecks'][0]['deckId']);
        self::assertSame('Start Gate Owner', $this->jsonResponse()['invalidDecks'][0]['displayName']);
        self::assertFalse($this->jsonResponse()['invalidDecks'][0]['validation']['valid']);
        self::assertContains('deck.size.invalid', array_column($this->jsonResponse()['invalidDecks'][0]['validation']['errors'], 'code'));

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('waiting', $this->jsonResponse()['room']['status']);
        self::assertNull($this->jsonResponse()['room']['gameId']);
    }

    public function testJoinPublicRoomRejectsCommanderInvalidDeck(): void
    {
        $this->seedCard('eeeeeeee-0000-7000-8000-000000000001', 'Commander Join Gate', [
            'type_line' => 'Legendary Creature - Human Knight',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('eeeeeeee-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('join-gate-owner@example.test', 'Join Gate Owner');
        $playerToken = $this->registerAndLogin('join-gate-player@example.test', 'Join Gate Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Join Gate Owner Deck', [
            ['scryfallId' => 'eeeeeeee-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'eeeeeeee-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $invalidPlayerDeckId = $this->quickBuildDeck($playerToken, 'Join Invalid Deck', [
            ['scryfallId' => 'eeeeeeee-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $invalidPlayerDeckId], $playerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Commander-valid deck', (string) $this->jsonResponse()['error']);
        self::assertArrayHasKey('validation', $this->jsonResponse());
        self::assertFalse($this->jsonResponse()['validation']['valid']);
    }

    public function testRoomCreationSupportsNameAndMaxPlayersAndJoinRespectsCapacity(): void
    {
        $this->seedCard('ababbbbb-0000-7000-8000-000000000001', 'Commander Capacity', [
            'type_line' => 'Legendary Creature - Human Warrior',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('ababbbbb-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('capacity-owner@example.test', 'Mario');
        $playerOneToken = $this->registerAndLogin('capacity-player-one@example.test', 'Sofia');
        $playerTwoToken = $this->registerAndLogin('capacity-player-two@example.test', 'Diego');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Deck Mario', [
            ['scryfallId' => 'ababbbbb-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababbbbb-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerOneDeckId = $this->quickBuildDeck($playerOneToken, 'Deck Sofia', [
            ['scryfallId' => 'ababbbbb-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababbbbb-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerTwoDeckId = $this->quickBuildDeck($playerTwoToken, 'Deck Diego', [
            ['scryfallId' => 'ababbbbb-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababbbbb-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', [
            'name' => 'La Cueva del Dragon',
            'format' => 'commander',
            'maxPlayers' => 2,
            'visibility' => 'public',
            'deckId' => $ownerDeckId,
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('La Cueva del Dragon', $this->jsonResponse()['room']['name']);
        self::assertSame('commander', $this->jsonResponse()['room']['format']);
        self::assertSame(2, $this->jsonResponse()['room']['maxPlayers']);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/code/'.$this->roomCode($roomId).'/join', ['deckId' => $playerOneDeckId], $playerOneToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerTwoDeckId], $playerTwoToken);
        self::assertResponseStatusCodeSame(409);
        self::assertStringContainsString('Room is full', (string) $this->jsonResponse()['error']);

        $this->jsonRequest('PATCH', '/rooms/'.$roomId, ['maxPlayers' => 3], $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame(3, $this->jsonResponse()['room']['maxPlayers']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerTwoDeckId], $playerTwoToken);
        self::assertResponseIsSuccessful();
        self::assertCount(3, $this->jsonResponse()['room']['players']);

        $this->jsonRequest('PATCH', '/rooms/'.$roomId, ['maxPlayers' => 2], $ownerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('lower than current players', (string) $this->jsonResponse()['error']);
    }

    public function testRoomStartRequiresAllConfiguredSeatsFilled(): void
    {
        $this->seedCard('ababbbcc-0000-7000-8000-000000000001', 'Commander Full Table', [
            'type_line' => 'Legendary Creature - Human Warrior',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('ababbbcc-1111-7111-8111-111111111111', 'Island Full Table', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('full-table-owner@example.test', 'Mario');
        $playerToken = $this->registerAndLogin('full-table-player@example.test', 'Sofia');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Full Mario Deck', [
            ['scryfallId' => 'ababbbcc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababbbcc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Full Sofia Deck', [
            ['scryfallId' => 'ababbbcc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababbbcc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', [
            'name' => 'Mesa Incompleta',
            'maxPlayers' => 3,
            'visibility' => 'public',
            'deckId' => $ownerDeckId,
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();
        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $playerToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('room must be full', (string) $this->jsonResponse()['error']);

        $this->jsonRequest('PATCH', '/rooms/'.$roomId, ['maxPlayers' => 2], $ownerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
    }

    public function testRoomCreationRejectsNonCommanderFormat(): void
    {
        $this->seedCard('ababcabc-0000-7000-8000-000000000001', 'Commander Format Gate', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('ababcabc-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('format-owner@example.test', 'Lucia');
        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Deck Lucia', [
            ['scryfallId' => 'ababcabc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababcabc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', [
            'name' => 'Mesa imposible',
            'format' => 'modern',
            'maxPlayers' => 4,
            'visibility' => 'public',
            'deckId' => $ownerDeckId,
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Only Commander format', (string) $this->jsonResponse()['error']);
    }

    public function testPrivateInviteAcceptRejectsCommanderInvalidDeck(): void
    {
        $this->seedCard('fefefefe-0000-7000-8000-000000000001', 'Commander Invite Gate', [
            'type_line' => 'Legendary Creature - Human Knight',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('fefefefe-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('invite-gate-owner@example.test', 'Invite Gate Owner');
        $invitedToken = $this->registerAndLogin('invite-gate-invited@example.test', 'Invite Gate Invited');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Invite Owner Deck', [
            ['scryfallId' => 'fefefefe-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'fefefefe-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $invalidInvitedDeckId = $this->quickBuildDeck($invitedToken, 'Invite Invalid Deck', [
            ['scryfallId' => 'fefefefe-1111-7111-8111-111111111111', 'quantity' => 1, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'invite-gate-invited@example.test'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $invitedToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/friends', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $invitedUserId = (string) $this->jsonResponse()['data'][0]['friend']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $invitedUserId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $inviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', ['deckId' => $invalidInvitedDeckId], $invitedToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Commander-valid deck', (string) $this->jsonResponse()['error']);
        self::assertArrayHasKey('validation', $this->jsonResponse());
        self::assertFalse($this->jsonResponse()['validation']['valid']);

        $this->jsonRequest('GET', '/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(1, $this->jsonResponse()['room']['players']);
    }

    public function testRoomInvitePublishesMercureUpdatesForRecipientAndOwner(): void
    {
        $this->seedCard('abababab-2222-7222-8222-222222222222', 'Commander Invite Realtime', [
            'type_line' => 'Legendary Creature - Human Scout',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('abababab-3333-7333-8333-333333333333', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('invite-realtime-owner@example.test', 'Invite Realtime Owner');
        $recipientToken = $this->registerAndLogin('invite-realtime-recipient@example.test', 'Invite Realtime Recipient');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Invite RT Owner Deck', [
            ['scryfallId' => 'abababab-2222-7222-8222-222222222222', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-3333-7333-8333-333333333333', 'quantity' => 99, 'section' => 'main'],
        ]);
        $recipientDeckId = $this->quickBuildDeck($recipientToken, 'Invite RT Rec Deck', [
            ['scryfallId' => 'abababab-2222-7222-8222-222222222222', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-3333-7333-8333-333333333333', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'invite-realtime-recipient@example.test'], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $recipientToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/me', token: $recipientToken);
        self::assertResponseIsSuccessful();
        $recipientId = (string) $this->jsonResponse()['user']['id'];
        $this->jsonRequest('GET', '/me', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $ownerId = (string) $this->jsonResponse()['user']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $recipientId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $inviteId = (string) $this->jsonResponse()['invite']['id'];

        $updates = RecordingMercureHub::updates();
        self::assertNotEmpty($updates);
        self::assertContains('rooms/invites/users/'.$recipientId, $updates[array_key_last($updates)]['topics']);

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', ['deckId' => $recipientDeckId], $recipientToken);
        self::assertResponseIsSuccessful();

        $updates = RecordingMercureHub::updates();
        $topics = array_merge(...array_map(
            static fn (array $update): array => $update['topics'],
            $updates,
        ));
        self::assertContains('rooms/invites/users/'.$recipientId, $topics);
        self::assertContains('rooms/invites/users/'.$ownerId, $topics);
        self::assertContains('rooms/'.$roomId.'/waiting', $topics);
    }

    public function testWaitingRoomPublishesMercureStateUpdates(): void
    {
        $this->seedCard('abababab-4444-7444-8444-444444444444', 'Commander Waiting Realtime', [
            'type_line' => 'Legendary Creature - Human Scout',
            'color_identity' => [],
            'image_uris' => [
                'normal' => 'https://cards.scryfall.io/normal/front/waiting-realtime.jpg',
                'art_crop' => 'https://cards.scryfall.io/art_crop/front/waiting-realtime.jpg',
            ],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('abababab-5555-7555-8555-555555555555', 'Plains Waiting Realtime', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('waiting-realtime-owner@example.test', 'Waiting Realtime Owner');
        $guestToken = $this->registerAndLogin('waiting-realtime-guest@example.test', 'Waiting Realtime Guest');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Waiting RT Owner', [
            ['scryfallId' => 'abababab-4444-7444-8444-444444444444', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-5555-7555-8555-555555555555', 'quantity' => 99, 'section' => 'main'],
        ]);
        $guestDeckId = $this->quickBuildDeck($guestToken, 'Waiting RT Guest', [
            ['scryfallId' => 'abababab-4444-7444-8444-444444444444', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abababab-5555-7555-8555-555555555555', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', [
            'visibility' => 'public',
            'deckId' => $ownerDeckId,
            'name' => 'Realtime Tavern',
            'format' => 'commander',
            'maxPlayers' => 4,
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('PATCH', '/rooms/'.$roomId, ['maxPlayers' => 3], $ownerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $guestDeckId], $guestToken);
        self::assertResponseIsSuccessful();

        $this->rollTurnOrder($roomId, $ownerToken);

        $updates = array_values(array_filter(
            RecordingMercureHub::updates(),
            static fn (array $update): bool => $update['topics'] === ['rooms/'.$roomId.'/waiting'],
        ));
        self::assertGreaterThanOrEqual(4, count($updates));

        $types = array_map(
            static fn (array $update): string => (string) json_decode($update['data'], true, flags: JSON_THROW_ON_ERROR)['type'],
            $updates,
        );
        self::assertContains('room.created', $types);
        self::assertContains('room.updated', $types);
        self::assertContains('room.player.joined', $types);
        self::assertContains('room.player.rolled', $types);

        $lastPayload = json_decode($updates[array_key_last($updates)]['data'], true, flags: JSON_THROW_ON_ERROR);
        self::assertSame($roomId, $lastPayload['roomId']);
        self::assertSame($roomId, $lastPayload['room']['id']);
        self::assertCount(2, $lastPayload['room']['players']);

        $playersByDeckName = [];
        foreach ($lastPayload['room']['players'] as $player) {
            $playersByDeckName[(string) ($player['deck']['name'] ?? '')] = $player;
        }
        self::assertArrayHasKey('Waiting RT Owner', $playersByDeckName);
        self::assertArrayHasKey('Waiting RT Guest', $playersByDeckName);
        self::assertSame(
            'https://cards.scryfall.io/art_crop/front/waiting-realtime.jpg',
            $playersByDeckName['Waiting RT Guest']['deck']['commander']['imageUris']['art_crop'] ?? null,
        );
    }

    public function testPrivateRoomInviteRequiresAcceptedFriendship(): void
    {
        $this->seedCard('ababcdab-0000-7000-8000-000000000001', 'Commander Invite Permission', [
            'type_line' => 'Legendary Creature - Human Scout',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('ababcdab-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('invite-permission-owner@example.test', 'Invite Permission Owner');
        $strangerToken = $this->registerAndLogin('invite-permission-stranger@example.test', 'Invite Perm Stranger');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Invite Perm Owner', [
            ['scryfallId' => 'ababcdab-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababcdab-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('GET', '/me', token: $strangerToken);
        self::assertResponseIsSuccessful();
        $strangerUserId = (string) $this->jsonResponse()['user']['id'];

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'private', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $strangerUserId], $ownerToken);
        self::assertResponseStatusCodeSame(403);
        self::assertStringContainsString('accepted friends', (string) $this->jsonResponse()['error']);
    }

    public function testCardsMovedAndZoneChangedAllowReorderButRejectInjection(): void
    {
        $this->seedCard('cabacaba-0000-7000-8000-000000000001', 'Commander Move Test', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('cabacaba-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('cards-moved-owner@example.test', 'Cards Move Owner');
        $playerToken = $this->registerAndLogin('cards-moved-player@example.test', 'Cards Move Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Cards Owner Deck', [
            ['scryfallId' => 'cabacaba-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'cabacaba-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Cards Player Deck', [
            ['scryfallId' => 'cabacaba-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'cabacaba-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();

        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $playerToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $snapshot = $this->jsonResponse()['game']['snapshot'];
        $ownerPlayerId = $this->playerIdByName($snapshot, 'Cards Move Owner');
        $hand = $snapshot['players'][$ownerPlayerId]['zones']['hand'];
        self::assertGreaterThanOrEqual(2, count($hand));
        $firstId = (string) $hand[0]['instanceId'];
        $secondId = (string) $hand[1]['instanceId'];

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'cards.moved',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'fromZone' => 'hand',
                'toZone' => 'battlefield',
                'instanceIds' => [$firstId, $secondId],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterMove = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['battlefield'];
        self::assertCount(2, $afterMove);

        $reordered = [$afterMove[1], $afterMove[0]];
        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'zone.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'battlefield',
                'cards' => $reordered,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterReorder = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['battlefield'];
        self::assertSame((string) $reordered[0]['instanceId'], (string) $afterReorder[0]['instanceId']);
        self::assertSame((string) $reordered[1]['instanceId'], (string) $afterReorder[1]['instanceId']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'zone.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'battlefield',
                'cards' => [[
                    'instanceId' => 'injected-instance',
                    'name' => 'Injected',
                ]],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('reorder existing cards', (string) $this->jsonResponse()['error']);
    }

    public function testLibraryCommandsPreserveTotalsAndRevealVisibility(): void
    {
        $this->seedCard('decafbad-0000-7000-8000-000000000001', 'Commander Library Test', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('decafbad-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('library-owner@example.test', 'Library Owner');
        $playerToken = $this->registerAndLogin('library-player@example.test', 'Library Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Library Owner Deck', [
            ['scryfallId' => 'decafbad-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'decafbad-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Library Player Deck', [
            ['scryfallId' => 'decafbad-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'decafbad-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();

        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $playerToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $snapshot = $this->jsonResponse()['game']['snapshot'];
        $ownerPlayerId = $this->playerIdByName($snapshot, 'Library Owner');

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw_many',
            'payload' => ['playerId' => $ownerPlayerId, 'count' => 3],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterDrawMany = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones'];
        self::assertCount(89, $afterDrawMany['library']);
        self::assertCount(10, $afterDrawMany['hand']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.move_top',
            'payload' => ['playerId' => $ownerPlayerId, 'toZone' => 'graveyard', 'count' => 2],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterMoveTop = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones'];
        self::assertCount(87, $afterMoveTop['library']);
        self::assertCount(2, $afterMoveTop['graveyard']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.shuffle',
            'payload' => ['playerId' => $ownerPlayerId],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterShuffle = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones'];
        self::assertCount(87, $afterShuffle['library']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.reveal_top',
            'payload' => ['playerId' => $ownerPlayerId, 'count' => 1, 'to' => 'all'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $playerToken);
        self::assertResponseIsSuccessful();
        $playerProjection = $this->jsonResponse()['game']['snapshot']['players'][$ownerPlayerId];
        self::assertCount(1, $playerProjection['zones']['library']);
        self::assertSame(87, $playerProjection['zoneCounts']['library']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.play_top_revealed',
            'payload' => ['playerId' => $ownerPlayerId],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $afterPlayTop = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones'];
        self::assertCount(86, $afterPlayTop['library']);
        self::assertCount(1, $afterPlayTop['battlefield']);
    }

    public function testLifeCommanderDamageAndCountersCommandsUpdateSnapshot(): void
    {
        $this->seedCard('feedfeed-0000-7000-8000-000000000001', 'Commander Counters Test', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('feedfeed-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('counters-owner@example.test', 'Counters Owner');
        $playerToken = $this->registerAndLogin('counters-player@example.test', 'Counters Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Counters Owner Deck', [
            ['scryfallId' => 'feedfeed-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'feedfeed-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Counters Player Deck', [
            ['scryfallId' => 'feedfeed-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'feedfeed-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();

        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $playerToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $snapshot = $this->jsonResponse()['game']['snapshot'];
        $ownerPlayerId = $this->playerIdByName($snapshot, 'Counters Owner');
        $playerPlayerId = $this->playerIdByName($snapshot, 'Counters Player');
        $commanderInstanceId = (string) $snapshot['players'][$ownerPlayerId]['zones']['command'][0]['instanceId'];

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'life.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'delta' => -1,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(39, $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['life']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'commander.damage.changed',
            'payload' => [
                'targetPlayerId' => $ownerPlayerId,
                'sourcePlayerId' => $playerPlayerId,
                'damage' => 5,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(5, $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['commanderDamage'][$playerPlayerId]);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'counter.changed',
            'payload' => [
                'scope' => 'global',
                'key' => 'storm',
                'value' => 2,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(2, $this->jsonResponse()['snapshot']['counters']['global']['storm']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.counter.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'command',
                'instanceId' => $commanderInstanceId,
                'key' => '+1/+1',
                'value' => 3,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $commandZone = $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['command'];
        self::assertSame(3, $commandZone[0]['counters']['+1/+1']);
    }

    public function testInitialSnapshotUsesCommanderZoneOpeningHandAndUniqueInstanceIds(): void
    {
        $this->seedCard('abab1234-0000-7000-8000-000000000001', 'Snapshot Commander', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('abab1234-1111-7111-8111-111111111111', 'Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => ['U'],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('snapshot-owner@example.test', 'Snapshot Owner');
        $playerToken = $this->registerAndLogin('snapshot-player@example.test', 'Snapshot Player');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Snapshot Owner Deck', [
            ['scryfallId' => 'abab1234-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abab1234-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Snapshot Player Deck', [
            ['scryfallId' => 'abab1234-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'abab1234-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();

        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $playerToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $snapshot = $this->jsonResponse()['game']['snapshot'];

        $ownerPlayerId = (string) $snapshot['ownerId'];
        foreach ($snapshot['players'] as $playerId => $playerState) {
            self::assertSame(40, $playerState['life']);
            self::assertCount(1, $playerState['zones']['command']);
            self::assertSame('command', $playerState['zones']['command'][0]['zone']);
            self::assertSame((string) $playerId, $playerState['zones']['command'][0]['ownerId']);
            self::assertSame(7, $playerState['zoneCounts']['hand']);
            self::assertSame(92, $playerState['zoneCounts']['library']);
            if ((string) $playerId === $ownerPlayerId) {
                self::assertCount(7, $playerState['zones']['hand']);
                self::assertCount(92, $playerState['zones']['library']);
            } else {
                self::assertCount(0, $playerState['zones']['hand']);
            }

            $instanceIds = [];
            $visibleZoneTotal = 0;
            foreach ($playerState['zones'] as $zoneName => $cards) {
                $visibleZoneTotal += count($cards);
                foreach ($cards as $card) {
                    self::assertSame($zoneName, $card['zone']);
                    $instanceIds[] = (string) $card['instanceId'];
                }
            }

            self::assertSame(100, array_sum($playerState['zoneCounts']));
            self::assertSame(count($instanceIds), count(array_unique($instanceIds)));
            if ((string) $playerId === $ownerPlayerId) {
                self::assertSame(100, $visibleZoneTotal);
                self::assertCount(100, $instanceIds);
            }
        }
    }

    public function testRoomGameCommandEventsAndAccessControl(): void
    {
        $this->seedCard('11111111-1111-7111-8111-111111111111', 'Forest', [
            'type_line' => 'Basic Land — Forest',
            'color_identity' => ['G'],
            'oracle_text' => '({T}: Add {G}.)',
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('22222222-2222-7222-8222-222222222222', 'Sol Ring', [
            'type_line' => 'Artifact',
            'oracle_text' => '{T}: Add {C}{C}.',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $this->seedCard('33333333-3333-7333-8333-333333333333', 'Command Tower', [
            'type_line' => 'Land',
            'oracle_text' => '{T}: Add one mana of any color in your commander color identity.',
            'set' => 'tst',
            'collector_number' => '3',
        ]);
        $this->seedCard('44444444-4444-7444-8444-444444444444', 'Commander Root', [
            'type_line' => 'Legendary Creature - Elf Druid',
            'color_identity' => ['G'],
            'oracle_text' => 'Vigilance',
            'power' => '2',
            'toughness' => '3',
            'card_faces' => [
                [
                    'name' => 'Commander Root',
                    'mana_cost' => '{2}{G}',
                    'type_line' => 'Legendary Creature - Elf Druid',
                    'oracle_text' => 'Vigilance',
                    'power' => '2',
                    'toughness' => '3',
                    'colors' => ['G'],
                    'image_uris' => ['normal' => 'https://cards.scryfall.io/root-front.jpg'],
                ],
                [
                    'name' => 'Rooted Ancient',
                    'type_line' => 'Creature - Treefolk',
                    'oracle_text' => 'Reach',
                    'power' => '5',
                    'toughness' => '7',
                    'colors' => ['G'],
                    'image_uris' => ['normal' => 'https://cards.scryfall.io/root-back.jpg'],
                ],
            ],
            'set' => 'tst',
            'collector_number' => '4',
        ]);
        $this->seedCard('55555555-5555-7555-8555-555555555555', 'Loyalty Adept', [
            'type_line' => 'Legendary Planeswalker - Adept',
            'color_identity' => ['G'],
            'oracle_text' => '+1: Add one mana of any color.',
            'loyalty' => '3',
            'set' => 'tst',
            'collector_number' => '5',
        ]);

        $ownerToken = $this->registerAndLogin('owner@example.test', 'Owner');
        $playerToken = $this->registerAndLogin('player@example.test', 'Player');
        $externalToken = $this->registerAndLogin('external@example.test', 'External');

        $this->jsonRequest('GET', '/me', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('Player', $this->jsonResponse()['user']['displayName']);

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Owner Deck', [
            ['scryfallId' => '44444444-4444-7444-8444-444444444444', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => '11111111-1111-7111-8111-111111111111', 'quantity' => 97, 'section' => 'main'],
            ['scryfallId' => '22222222-2222-7222-8222-222222222222', 'quantity' => 1, 'section' => 'main'],
            ['scryfallId' => '55555555-5555-7555-8555-555555555555', 'quantity' => 1, 'section' => 'main'],
        ]);
        $playerDeckId = $this->quickBuildDeck($playerToken, 'Player Deck', [
            ['scryfallId' => '44444444-4444-7444-8444-444444444444', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => '11111111-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', ['visibility' => 'public', 'maxPlayers' => 2, 'deckId' => $ownerDeckId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('GET', '/rooms', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $playerDeckId], $playerToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['room']['players']);

        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $playerToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];

        $this->jsonRequest('PATCH', '/me/avatar', [
            'type' => 'preset',
            'imageUrl' => 'assets/images/avatars/storm-seer.png',
        ], $playerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $externalToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'chat.message',
            'payload' => ['message' => 'external attempt'],
        ], $externalToken);
        self::assertResponseStatusCodeSame(403);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $ownerSnapshot = $this->jsonResponse()['game']['snapshot'];
        self::assertArrayHasKey('snapshot', $this->jsonResponse()['game']);
        self::assertArrayHasKey('version', $ownerSnapshot);
        $ownerPlayerId = $this->playerIdByName($ownerSnapshot, 'Owner');
        $playerPlayerId = $this->playerIdByName($ownerSnapshot, 'Player');
        self::assertSame($ownerPlayerId, $ownerSnapshot['ownerId']);
        self::assertSame('assets/images/avatars/storm-seer.png', $ownerSnapshot['players'][$playerPlayerId]['user']['avatar']['imageUrl']);
        self::assertCount(92, $ownerSnapshot['players'][$ownerPlayerId]['zones']['library']);
        self::assertSame(['G'], $ownerSnapshot['players'][$ownerPlayerId]['colorIdentity']);
        self::assertContains(['G'], array_column($ownerSnapshot['players'][$ownerPlayerId]['zones']['library'], 'colorIdentity'));
        $commanderInstance = $ownerSnapshot['players'][$ownerPlayerId]['zones']['command'][0];
        self::assertSame(2, $commanderInstance['power']);
        self::assertSame(3, $commanderInstance['toughness']);
        self::assertSame(2, $commanderInstance['defaultPower']);
        self::assertSame(3, $commanderInstance['defaultToughness']);
        self::assertSame('Rooted Ancient', $commanderInstance['cardFaces'][1]['name']);
        self::assertSame('5', $commanderInstance['cardFaces'][1]['power']);
        self::assertSame('7', $commanderInstance['cardFaces'][1]['toughness']);
        $ownerVisibleMainCards = [
            ...$ownerSnapshot['players'][$ownerPlayerId]['zones']['hand'],
            ...$ownerSnapshot['players'][$ownerPlayerId]['zones']['library'],
        ];
        $planeswalkerInstance = array_values(array_filter(
            $ownerVisibleMainCards,
            static fn (array $card): bool => ($card['name'] ?? null) === 'Loyalty Adept',
        ))[0] ?? null;
        self::assertIsArray($planeswalkerInstance);
        self::assertSame(3, $planeswalkerInstance['loyalty']);
        self::assertSame(3, $planeswalkerInstance['defaultLoyalty']);

        $activePlayerId = (string) $ownerSnapshot['turn']['activePlayerId'];
        $nonActiveToken = $activePlayerId === $ownerPlayerId ? $playerToken : $ownerToken;
        $activeToken = $activePlayerId === $ownerPlayerId ? $ownerToken : $playerToken;

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'turn.changed',
            'payload' => ['phase' => 'upkeep'],
        ], $nonActiveToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Only the active turn player', (string) $this->jsonResponse()['error']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'turn.changed',
            'payload' => ['phase' => 'upkeep'],
        ], $activeToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('Fase upkeep.', $this->jsonResponse()['snapshot']['eventLog'][0]['message']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'unknown.command',
            'payload' => [],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('Unknown game command: unknown.command', (string) $this->jsonResponse()['error']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'life.changed',
            'payload' => ['playerId' => $ownerPlayerId, 'delta' => -1],
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);
        self::assertStringContainsString('You can only change your own life total.', (string) $this->jsonResponse()['error']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'life.changed',
            'payload' => ['playerId' => $ownerPlayerId, 'delta' => -1],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(39, $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['life']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'life.changed',
            'payload' => ['playerId' => $ownerPlayerId],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'turn.changed',
            'payload' => [],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'arrow.created',
            'payload' => ['fromInstanceId' => 'from-only'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'stack.item_removed',
            'payload' => [],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'zone.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'graveyard',
                'cards' => [[
                    'instanceId' => 'injected-card',
                    'name' => 'Injected Card',
                ]],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'chat.message',
            'payload' => ['message' => 'hello'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('chat.message', $this->jsonResponse()['event']['type']);

        $updates = array_values(array_filter(
            RecordingMercureHub::updates(),
            static fn (array $update): bool => $update['topics'] === ['games/'.$gameId],
        ));
        self::assertNotEmpty($updates);
        $mercurePayload = json_decode($updates[array_key_last($updates)]['data'], true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('chat.message', $mercurePayload['event']['type'] ?? null);
        self::assertArrayHasKey('version', $mercurePayload);
        self::assertArrayNotHasKey('snapshot', $mercurePayload);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $ownerPlayerId],
            'clientActionId' => 'draw-1',
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertTrue($this->jsonResponse()['applied']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $ownerPlayerId],
            'clientActionId' => 'player-draws-owner-library',
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $ownerPlayerId],
            'clientActionId' => 'draw-1',
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['applied']);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $ownerToken);
        self::assertResponseIsSuccessful();
        $ownerSnapshot = $this->jsonResponse()['game']['snapshot'];
        self::assertCount(8, $ownerSnapshot['players'][$ownerPlayerId]['zones']['hand']);
        $drawnCardId = (string) $ownerSnapshot['players'][$ownerPlayerId]['zones']['hand'][0]['instanceId'];

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.moved',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'fromZone' => 'hand',
                'toZone' => 'battlefield',
                'instanceId' => $drawnCardId,
                'position' => ['x' => 320, 'y' => 180],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(['x' => 320, 'y' => 180], $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['battlefield'][0]['position']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.position.changed',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'zone' => 'battlefield',
                'instanceId' => $drawnCardId,
                'position' => ['x' => 420, 'y' => 220],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(['x' => 420, 'y' => 220], $this->jsonResponse()['snapshot']['players'][$ownerPlayerId]['zones']['battlefield'][0]['position']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.moved',
            'payload' => [
                'playerId' => $ownerPlayerId,
                'fromZone' => 'battlefield',
                'toZone' => 'graveyard',
                'instanceId' => $drawnCardId,
            ],
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $playerToken);
        self::assertResponseIsSuccessful();
        $playerProjection = $this->jsonResponse()['game']['snapshot'];
        self::assertCount(0, $playerProjection['players'][$ownerPlayerId]['zones']['hand']);
        self::assertSame(7, $playerProjection['players'][$ownerPlayerId]['zoneCounts']['hand']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.reveal_top',
            'payload' => ['playerId' => $ownerPlayerId, 'count' => 1, 'to' => 'all'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('GET', '/games/'.$gameId.'/zones/'.$ownerPlayerId.'/library', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->jsonResponse()['total']);
        self::assertCount(1, $this->jsonResponse()['data']);

        $this->jsonRequest('GET', '/games/'.$gameId.'/events?limit=10', token: $playerToken);
        self::assertResponseIsSuccessful();
        self::assertContains('chat.message', array_column($this->jsonResponse()['data'], 'type'));

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'game.concede',
            'payload' => [],
        ], $playerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('conceded', $this->jsonResponse()['snapshot']['players'][$playerPlayerId]['status']);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'game.concede',
            'payload' => [],
        ], $playerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $playerPlayerId],
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'card.tapped',
            'payload' => [
                'playerId' => $playerPlayerId,
                'zone' => 'battlefield',
                'instanceId' => 'missing-card',
                'tapped' => true,
            ],
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'game.close',
            'payload' => [],
        ], $playerToken);
        self::assertResponseStatusCodeSame(400);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'game.close',
            'payload' => [],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'library.draw',
            'payload' => ['playerId' => $ownerPlayerId],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(409);

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'chat.message',
            'payload' => ['message' => 'post-finish chat'],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('GET', '/rooms', token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertContains($roomId, array_column($this->jsonResponse()['data'], 'id'));
    }

    public function testPrivateChatMessagesAreOnlyProjectedForSenderAndRecipient(): void
    {
        $this->seedCard('ababcccc-0000-7000-8000-000000000001', 'Private Chat Commander', [
            'type_line' => 'Legendary Creature - Human Wizard',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('ababcccc-1111-7111-8111-111111111111', 'Private Chat Island', [
            'type_line' => 'Basic Land - Island',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $ownerToken = $this->registerAndLogin('private-chat-owner@example.test', 'Private Chat Owner');
        $recipientToken = $this->registerAndLogin('private-chat-recipient@example.test', 'Private Chat Recipient');
        $spectatorToken = $this->registerAndLogin('private-chat-spectator@example.test', 'Private Chat Spectator');

        $ownerDeckId = $this->quickBuildDeck($ownerToken, 'Chat Owner Deck', [
            ['scryfallId' => 'ababcccc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababcccc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $recipientDeckId = $this->quickBuildDeck($recipientToken, 'Chat Recipient Deck', [
            ['scryfallId' => 'ababcccc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababcccc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);
        $spectatorDeckId = $this->quickBuildDeck($spectatorToken, 'Chat Spectator Deck', [
            ['scryfallId' => 'ababcccc-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
            ['scryfallId' => 'ababcccc-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
        ]);

        $this->jsonRequest('POST', '/rooms', [
            'visibility' => 'public',
            'maxPlayers' => 3,
            'deckId' => $ownerDeckId,
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $recipientDeckId], $recipientToken);
        self::assertResponseIsSuccessful();
        $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', ['deckId' => $spectatorDeckId], $spectatorToken);
        self::assertResponseIsSuccessful();

        $this->rollTurnOrder($roomId, $ownerToken);
        $this->rollTurnOrder($roomId, $recipientToken);
        $this->rollTurnOrder($roomId, $spectatorToken);

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $gameId = (string) $this->jsonResponse()['game']['id'];
        $snapshot = $this->jsonResponse()['game']['snapshot'];
        $recipientPlayerId = $this->playerIdByName($snapshot, 'Private Chat Recipient');

        $this->jsonRequest('POST', '/games/'.$gameId.'/commands', [
            'type' => 'chat.message',
            'payload' => [
                'message' => 'secret line',
                'targetPlayerId' => $recipientPlayerId,
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame(['private' => true], $this->jsonResponse()['event']['payload']);
        self::assertSame('secret line', $this->jsonResponse()['snapshot']['chat'][0]['message']);
        self::assertSame($recipientPlayerId, $this->jsonResponse()['snapshot']['chat'][0]['targetPlayerId']);
        self::assertSame('Private Chat Recipient', $this->jsonResponse()['snapshot']['chat'][0]['targetDisplayName']);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $recipientToken);
        self::assertResponseIsSuccessful();
        self::assertSame('secret line', $this->jsonResponse()['game']['snapshot']['chat'][0]['message']);

        $this->jsonRequest('GET', '/games/'.$gameId.'/snapshot', token: $spectatorToken);
        self::assertResponseIsSuccessful();
        self::assertSame([], $this->jsonResponse()['game']['snapshot']['chat']);

        $updates = array_values(array_filter(
            RecordingMercureHub::updates(),
            static fn (array $update): bool => $update['topics'] === ['games/'.$gameId],
        ));
        self::assertNotEmpty($updates);
        $mercurePayload = json_decode($updates[array_key_last($updates)]['data'], true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(['private' => true], $mercurePayload['event']['payload'] ?? null);
    }

    /**
     * @param list<array<string,mixed>> $cards
     */
    private function quickBuildDeck(string $token, string $name, array $cards): string
    {
        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => $name,
            'cards' => $cards,
        ], $token);
        self::assertResponseStatusCodeSame(201);

        return (string) $this->jsonResponse()['deck']['id'];
    }

    private function rollTurnOrder(string $roomId, string $token): int
    {
        $this->jsonRequest('POST', '/rooms/'.$roomId.'/roll-turn', token: $token);
        self::assertResponseIsSuccessful();
        foreach ($this->jsonResponse()['room']['players'] as $player) {
            $roll = $player['turnRoll'] ?? null;
            if (is_int($roll)) {
                self::assertGreaterThanOrEqual(1, $roll);
                self::assertLessThanOrEqual(20, $roll);

                return $roll;
            }
        }

        self::fail('Turn roll was not returned for the room player.');
    }

    /**
     * @param list<array{0: string, 1: string}> $players
     *
     * @return array{roomId: string, gameId: string, snapshot: array<string,mixed>, tokens: array<string,string>}
     */
    private function startedRematchGameFixture(string $slug, array $players): array
    {
        $commanderScryfallId = sprintf('ffffffff-0000-7000-8000-%012d', abs(crc32($slug)));
        $landScryfallId = sprintf('eeeeeeee-1111-7111-8111-%012d', abs(crc32($slug.' land')));

        $this->seedCard($commanderScryfallId, 'Rematch '.$slug.' Commander', [
            'type_line' => 'Legendary Creature - Human Soldier',
            'color_identity' => [],
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard($landScryfallId, 'Rematch '.$slug.' Plains', [
            'type_line' => 'Basic Land - Plains',
            'set' => 'tst',
            'collector_number' => '2',
        ]);

        $tokens = [];
        $deckIds = [];
        foreach ($players as $index => [$email, $displayName]) {
            $tokens[$displayName] = $this->registerAndLogin($email, $displayName);
            $deckIds[$displayName] = $this->quickBuildDeck($tokens[$displayName], 'Rematch '.$slug.' '.($index + 1), [
                ['scryfallId' => $commanderScryfallId, 'quantity' => 1, 'section' => 'commander'],
                ['scryfallId' => $landScryfallId, 'quantity' => 99, 'section' => 'main'],
            ]);
        }

        $ownerName = $players[0][1];
        $this->jsonRequest('POST', '/rooms', [
            'visibility' => 'public',
            'maxPlayers' => count($players),
            'deckId' => $deckIds[$ownerName],
        ], $tokens[$ownerName]);
        self::assertResponseStatusCodeSame(201);
        $roomId = (string) $this->jsonResponse()['room']['id'];

        foreach (array_slice($players, 1) as [, $displayName]) {
            $this->jsonRequest('POST', '/rooms/'.$roomId.'/join', [
                'deckId' => $deckIds[$displayName],
            ], $tokens[$displayName]);
            self::assertResponseIsSuccessful();
        }

        foreach ($players as [, $displayName]) {
            $this->rollTurnOrder($roomId, $tokens[$displayName]);
        }

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/start', token: $tokens[$ownerName]);
        self::assertResponseStatusCodeSame(201);

        return [
            'roomId' => $roomId,
            'gameId' => (string) $this->jsonResponse()['game']['id'],
            'snapshot' => $this->jsonResponse()['game']['snapshot'],
            'tokens' => $tokens,
        ];
    }

    private function roomCode(string $roomId): string
    {
        $compactId = strtoupper(substr(str_replace('-', '', $roomId), -9));

        return sprintf('CZ-%s-%s-%s', substr($compactId, 0, 3), substr($compactId, 3, 3), substr($compactId, 6, 3));
    }

    /**
     * @param array<string,mixed> $room
     */
    private function assertRoomPlayersContainDisplayName(array $room, string $displayName): void
    {
        self::assertContains($displayName, $this->roomPlayerDisplayNames($room));
    }

    /**
     * @param array<string,mixed> $room
     */
    private function assertRoomPlayersDoNotContainDisplayName(array $room, string $displayName): void
    {
        self::assertNotContains($displayName, $this->roomPlayerDisplayNames($room));
    }

    /**
     * @param array<string,mixed> $room
     *
     * @return list<string>
     */
    private function roomPlayerDisplayNames(array $room): array
    {
        return array_map(
            static fn (array $player): string => (string) ($player['user']['displayName'] ?? ''),
            $room['players'] ?? [],
        );
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    private function playerIdByName(array $snapshot, string $displayName): string
    {
        foreach ($snapshot['players'] as $playerId => $player) {
            if (($player['user']['displayName'] ?? null) === $displayName) {
                return (string) $playerId;
            }
        }

        self::fail(sprintf('Player "%s" not found in snapshot.', $displayName));
    }
}

