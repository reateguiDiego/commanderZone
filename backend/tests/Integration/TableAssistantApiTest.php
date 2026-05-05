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

    public function testPassingTurnSkipsEliminatedPlayers(): void
    {
        $ownerToken = $this->registerAndLogin('skip-owner@example.test', 'Skip Owner');

        $this->jsonRequest('POST', '/table-assistant/rooms', ['mode' => 'single-device'], $ownerToken);
        $roomId = (string) $this->jsonResponse()['tableAssistantRoom']['id'];

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'life.changed',
            'payload' => ['playerId' => 'player-2', 'delta' => -40],
            'clientActionId' => 'eliminate-player-2',
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'turn.passed',
            'payload' => [],
            'clientActionId' => 'pass-skip-player-2',
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $state = $this->jsonResponse()['tableAssistantRoom']['state'];
        self::assertSame('player-3', $state['turn']['activePlayerId']);
        self::assertSame(1, $state['turn']['number']);
    }

    public function testActivePlayerIsSkippedWhenLifeReachesZero(): void
    {
        $ownerToken = $this->registerAndLogin('active-skip-owner@example.test', 'Active Skip Owner');

        $this->jsonRequest('POST', '/table-assistant/rooms', ['mode' => 'single-device'], $ownerToken);
        $roomId = (string) $this->jsonResponse()['tableAssistantRoom']['id'];

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'life.changed',
            'payload' => ['playerId' => 'player-1', 'delta' => -40],
            'clientActionId' => 'eliminate-active-player',
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $state = $this->jsonResponse()['tableAssistantRoom']['state'];
        self::assertTrue($state['players'][0]['eliminated']);
        self::assertSame('player-2', $state['turn']['activePlayerId']);
        self::assertSame(1, $state['turn']['number']);
    }

    public function testTurnNumberIncrementsOnlyAfterFullRound(): void
    {
        $ownerToken = $this->registerAndLogin('round-owner@example.test', 'Round Owner');

        $this->jsonRequest('POST', '/table-assistant/rooms', ['mode' => 'single-device'], $ownerToken);
        $roomId = (string) $this->jsonResponse()['tableAssistantRoom']['id'];
        $state = null;

        for ($index = 1; $index <= 3; $index++) {
            $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
                'type' => 'turn.passed',
                'payload' => [],
                'clientActionId' => 'pass-turn-'.$index,
            ], $ownerToken);
            self::assertResponseIsSuccessful();
            $state = $this->jsonResponse()['tableAssistantRoom']['state'];
        }

        self::assertSame('player-4', $state['turn']['activePlayerId']);
        self::assertSame(1, $state['turn']['number']);

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'turn.passed',
            'payload' => [],
            'clientActionId' => 'pass-turn-4',
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $state = $this->jsonResponse()['tableAssistantRoom']['state'];
        self::assertSame('player-1', $state['turn']['activePlayerId']);
        self::assertSame(2, $state['turn']['number']);
    }

    public function testGameResetRestoresInitialTableState(): void
    {
        $ownerToken = $this->registerAndLogin('reset-owner@example.test', 'Reset Owner');

        $this->jsonRequest('POST', '/table-assistant/rooms', [
            'mode' => 'single-device',
            'phasesEnabled' => true,
            'timerMode' => 'turn',
            'timerDurationSeconds' => 120,
            'activeTrackerIds' => ['commander-damage', 'poison', 'storm'],
        ], $ownerToken);
        $roomId = (string) $this->jsonResponse()['tableAssistantRoom']['id'];

        foreach ([
            ['type' => 'life.changed', 'payload' => ['playerId' => 'player-1', 'delta' => -12]],
            ['type' => 'tracker.changed', 'payload' => ['trackerId' => 'poison', 'playerId' => 'player-1', 'value' => 4]],
            ['type' => 'tracker.changed', 'payload' => ['trackerId' => 'storm', 'value' => 6]],
            ['type' => 'commander-damage.changed', 'payload' => ['targetPlayerId' => 'player-1', 'sourcePlayerId' => 'player-2', 'delta' => 7]],
            ['type' => 'timer.started', 'payload' => ['durationSeconds' => 120]],
            ['type' => 'turn.passed', 'payload' => []],
        ] as $index => $action) {
            $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
                ...$action,
                'clientActionId' => 'before-reset-'.$index,
            ], $ownerToken);
            self::assertResponseIsSuccessful();
        }

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/actions', [
            'type' => 'game.reset',
            'payload' => [
                'seatOrder' => ['player-2', 'player-1', 'player-4', 'player-3'],
                'turnOrder' => ['player-3', 'player-1', 'player-2', 'player-4'],
            ],
            'clientActionId' => 'reset-game',
        ], $ownerToken);
        self::assertResponseIsSuccessful();

        $state = $this->jsonResponse()['tableAssistantRoom']['state'];
        self::assertSame(40, $state['players'][0]['life']);
        self::assertFalse($state['players'][0]['eliminated']);
        self::assertSame(0, $state['players'][0]['trackers']['poison']);
        self::assertSame(0, $state['globalTrackers']['storm']);
        self::assertSame(0, $state['commanderDamage']['player-1']['player-2']);
        self::assertSame(1, $state['players'][0]['seatIndex']);
        self::assertSame(0, $state['players'][1]['seatIndex']);
        self::assertSame(0, $state['players'][2]['turnOrder']);
        self::assertSame(['activePlayerId' => 'player-3', 'number' => 1, 'phaseId' => 'untap'], $state['turn']);
        self::assertSame('idle', $state['timer']['status']);
        self::assertSame(120, $state['timer']['remainingSeconds']);
        self::assertCount(1, $state['actionLog']);
        self::assertSame('game.reset', $state['actionLog'][0]['type']);
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
        $this->seedCard('fafafafa-0000-7000-8000-000000000001', 'Commander Assistant Invite', [
            'type_line' => 'Legendary Creature - Human Advisor',
            'set' => 'tst',
            'collector_number' => '1',
        ]);
        $this->seedCard('fafafafa-1111-7111-8111-111111111111', 'Plains', [
            'type_line' => 'Basic Land - Plains',
            'set' => 'tst',
            'collector_number' => '2',
        ]);
        $ownerToken = $this->registerAndLogin('invite-owner@example.test', 'Invite Owner');
        $guestToken = $this->registerAndLogin('invite-guest@example.test', 'Invite Guest');

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Invite Guest Deck',
            'cards' => [
                ['scryfallId' => 'fafafafa-0000-7000-8000-000000000001', 'quantity' => 1, 'section' => 'commander'],
                ['scryfallId' => 'fafafafa-1111-7111-8111-111111111111', 'quantity' => 99, 'section' => 'main'],
            ],
        ], $guestToken);
        self::assertResponseStatusCodeSame(201);
        $guestDeckId = (string) $this->jsonResponse()['deck']['id'];

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

        $this->jsonRequest('POST', '/rooms/invites/'.$inviteId.'/accept', ['deckId' => $guestDeckId], $guestToken);
        self::assertResponseIsSuccessful();

        $this->jsonRequest('POST', '/table-assistant/rooms/'.$roomId.'/join', token: $guestToken);
        self::assertResponseIsSuccessful();
        self::assertCount(2, $this->jsonResponse()['tableAssistantRoom']['state']['participants']);
    }
}
