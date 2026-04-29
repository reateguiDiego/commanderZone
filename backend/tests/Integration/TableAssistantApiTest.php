<?php

namespace App\Tests\Integration;

class TableAssistantApiTest extends ApiTestCase
{
    public function testTableAssistantRoomCanBeCreatedFetchedAndJoined(): void
    {
        $ownerToken = $this->registerAndLogin('table-owner@example.test', 'Table Owner');
        $guestToken = $this->registerAndLogin('table-guest@example.test', 'Table Guest');

        $this->jsonRequest('POST', '/table-assistant/rooms', [
            'mode' => 'per-player-device',
            'players' => [
                ['name' => 'Jugador Grixis', 'color' => 'grixis'],
                ['name' => 'Jugador Verde', 'color' => 'green'],
            ],
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $room = $this->jsonResponse()['tableAssistantRoom'];
        $roomId = (string) $room['id'];

        self::assertSame('per-player-device', $room['state']['mode']);
        self::assertSame(1, $room['version']);
        self::assertCount(4, $room['state']['players']);
        self::assertSame(40, $room['state']['players'][0]['life']);
        self::assertSame('Jugador Grixis', $room['state']['players'][0]['name']);
        self::assertSame('grixis', $room['state']['players'][0]['color']);
        self::assertSame('green', $room['state']['players'][1]['color']);

        $this->jsonRequest('GET', '/table-assistant/rooms/'.$roomId, token: $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame($roomId, $this->jsonResponse()['tableAssistantRoom']['id']);

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/join', ['deviceId' => 'guest-phone'], $guestToken);
        self::assertResponseIsSuccessful();
        $joined = $this->jsonResponse()['tableAssistantRoom'];

        self::assertCount(2, $joined['room']['players']);
        self::assertCount(2, $joined['state']['participants']);
        self::assertSame('player-2', $joined['state']['participants'][1]['assignedPlayerId']);
    }

    public function testActionsAreVersionedAndIdempotent(): void
    {
        $ownerToken = $this->registerAndLogin('action-owner@example.test', 'Action Owner');

        $this->jsonRequest('POST', '/table-assistant/rooms', ['mode' => 'single-device'], $ownerToken);
        $roomId = (string) $this->jsonResponse()['tableAssistantRoom']['id'];

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'life.changed',
            'payload' => ['playerId' => 'player-1', 'delta' => -5],
            'clientActionId' => 'life-1',
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        $first = $this->jsonResponse();
        self::assertTrue($first['applied']);
        self::assertSame(35, $first['tableAssistantRoom']['state']['players'][0]['life']);
        self::assertSame(2, $first['tableAssistantRoom']['version']);

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'life.changed',
            'payload' => ['playerId' => 'player-1', 'delta' => -5],
            'clientActionId' => 'life-1',
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        $second = $this->jsonResponse();
        self::assertFalse($second['applied']);
        self::assertSame(35, $second['tableAssistantRoom']['state']['players'][0]['life']);
        self::assertSame(2, $second['tableAssistantRoom']['version']);
    }

    public function testInvalidActionsAndPermissionsAreRejected(): void
    {
        $ownerToken = $this->registerAndLogin('permission-owner@example.test', 'Permission Owner');
        $guestToken = $this->registerAndLogin('permission-guest@example.test', 'Permission Guest');

        $this->jsonRequest('POST', '/table-assistant/rooms', ['mode' => 'per-player-device'], $ownerToken);
        $roomId = (string) $this->jsonResponse()['tableAssistantRoom']['id'];
        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/join', token: $guestToken);

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'life.changed',
            'payload' => ['playerId' => 'player-1', 'delta' => -1],
            'clientActionId' => 'guest-invalid-life',
        ], $guestToken);
        self::assertResponseStatusCodeSame(422);

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'unknown.action',
            'payload' => [],
            'clientActionId' => 'unknown-action',
        ], $ownerToken);
        self::assertResponseStatusCodeSame(422);
    }

    public function testPhasesAndTimerActionsArePersisted(): void
    {
        $ownerToken = $this->registerAndLogin('timer-owner@example.test', 'Timer Owner');

        $this->jsonRequest('POST', '/table-assistant/rooms', [
            'mode' => 'single-device',
            'phasesEnabled' => true,
            'timerMode' => 'phase',
            'timerDurationSeconds' => 120,
        ], $ownerToken);
        $roomId = (string) $this->jsonResponse()['tableAssistantRoom']['id'];

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'timer.started',
            'payload' => ['durationSeconds' => 120],
            'clientActionId' => 'timer-start',
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        self::assertSame('running', $this->jsonResponse()['tableAssistantRoom']['state']['timer']['status']);

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'phase.passed',
            'payload' => [],
            'clientActionId' => 'phase-pass',
        ], $ownerToken);
        self::assertResponseIsSuccessful();
        $state = $this->jsonResponse()['tableAssistantRoom']['state'];
        self::assertSame('upkeep', $state['turn']['phaseId']);
        self::assertSame('idle', $state['timer']['status']);
        self::assertSame(120, $state['timer']['remainingSeconds']);
    }

    public function testPhaseTimerIsNormalizedWhenPhasesAreDisabled(): void
    {
        $ownerToken = $this->registerAndLogin('timer-normalized@example.test', 'Timer Normalized');

        $this->jsonRequest('POST', '/table-assistant/rooms', [
            'mode' => 'single-device',
            'phasesEnabled' => false,
            'timerMode' => 'phase',
        ], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('none', $this->jsonResponse()['tableAssistantRoom']['state']['timer']['mode']);
    }

    public function testExistingFriendInvitesWorkForTableAssistantRooms(): void
    {
        $ownerToken = $this->registerAndLogin('invite-owner@example.test', 'Invite Owner');
        $guestToken = $this->registerAndLogin('invite-guest@example.test', 'Invite Guest');

        $this->jsonRequest('POST', '/friends/requests', ['email' => 'invite-guest@example.test'], $ownerToken);
        $friendshipId = (string) $this->jsonResponse()['friendship']['id'];
        $this->jsonRequest('POST', '/friends/requests/'.$friendshipId.'/accept', token: $guestToken);

        $this->jsonRequest('POST', '/table-assistant/rooms', ['mode' => 'per-player-device'], $ownerToken);
        $roomId = (string) $this->jsonResponse()['tableAssistantRoom']['id'];

        $this->jsonRequest('GET', '/friends', token: $ownerToken);
        $guestId = (string) $this->jsonResponse()['data'][0]['friend']['id'];

        $this->jsonRequest('POST', '/rooms/'.$roomId.'/invites', ['userId' => $guestId], $ownerToken);
        self::assertResponseStatusCodeSame(201);
        $inviteId = (string) $this->jsonResponse()['invite']['id'];

        $this->jsonRequest('GET', '/rooms/invites/incoming', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertSame($inviteId, $this->jsonResponse()['data'][0]['id']);

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', token: $guestToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/join', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['tableAssistantRoom']['state']['participants']);
    }
}
