<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\Debug\GameDebugHealthAggregator;
use PHPUnit\Framework\TestCase;

class GameDebugHealthAggregatorTest extends TestCase
{
    public function testConnectionSnapshotsTrackPresenceTransitionsAndCounts(): void
    {
        $aggregator = new GameDebugHealthAggregator();
        $state = $aggregator->normalize([]);

        $state = $aggregator->recordConnectionSnapshot($state, 'user-1', 'Player One', 'online', 2, 1, '2026-05-24T10:00:00+00:00');
        $state = $aggregator->recordConnectionSnapshot($state, 'user-1', 'Player One', 'offline', 1, 0, '2026-05-24T10:01:00+00:00');

        self::assertSame(1, $state['websocket']['connections']['total']);
        self::assertSame('Player One', $state['websocket']['connections']['byUser']['user-1']['displayName']);
        self::assertSame('offline', $state['websocket']['connections']['byUser']['user-1']['status']);
        self::assertSame(1, $state['websocket']['connections']['byUser']['user-1']['disconnects']);
        self::assertSame('Player One', $state['websocket']['connections']['disconnectRanking'][0]['displayName']);
        self::assertSame(1, $state['websocket']['connections']['disconnectRanking'][0]['disconnects']);
        self::assertSame(1, $state['websocket']['connections']['transitions']['online']);
        self::assertSame(1, $state['websocket']['connections']['transitions']['offline']);
        self::assertSame('2026-05-24T10:01:00+00:00', $state['websocket']['connections']['byUser']['user-1']['offlineSince']);
    }

    public function testOutboundMessagesUpdatePipelineAndSyncMetadata(): void
    {
        $aggregator = new GameDebugHealthAggregator();
        $state = $aggregator->normalize([]);

        $state = $aggregator->recordOutboundMessage($state, [
            'kind' => 'game_patch',
            'baseVersion' => 3,
            'version' => 4,
            'clientActionId' => 'action-1',
            'operations' => [['op' => 'player.life.set', 'playerId' => 'user-1', 'value' => 38]],
            'event' => ['id' => 'event-1', 'type' => 'life.changed', 'clientActionId' => 'action-1', 'createdAt' => ''],
        ], 'broadcast');
        $state = $aggregator->recordOutboundMessage($state, [
            'kind' => 'command_ack',
            'status' => 'resync_required',
            'version' => 4,
            'clientActionId' => 'action-2',
            'error' => ['code' => 'BASE_VERSION_MISMATCH', 'message' => 'mismatch'],
        ], 'direct');
        $state = $aggregator->recordOutboundMessage($state, [
            'kind' => 'resync_required',
            'currentVersion' => 6,
            'reason' => 'version_gap',
        ], 'direct');

        self::assertSame(1, $state['pipeline']['gamePatch']);
        self::assertSame(1, $state['pipeline']['commandAck']['resync_required']);
        self::assertSame(1, $state['pipeline']['resyncRequired']);
        self::assertSame(3, $state['traffic']['outgoing']['messages']);
        self::assertGreaterThan(0, $state['traffic']['outgoing']['characters']);
        self::assertSame(4, $state['sync']['lastGamePatch']['version']);
        self::assertSame(['player.life.set'], $state['sync']['lastGamePatch']['operationTypes']);
        self::assertSame('BASE_VERSION_MISMATCH', $state['sync']['lastConflict']['code']);
        self::assertSame('version_gap', $state['sync']['lastVersionGap']['reason']);
        self::assertNotEmpty($state['recent']);
        self::assertNotEmpty($state['events']);
    }

    public function testKeepaliveTrafficDoesNotChangeActionTraffic(): void
    {
        $aggregator = new GameDebugHealthAggregator();
        $state = $aggregator->normalize([]);

        $state = $aggregator->recordIncomingMessage($state, [
            'kind' => 'ping',
            'messageId' => 'ping-1',
            'sentAt' => '2026-05-24T10:00:00+00:00',
        ], 96);
        $state = $aggregator->recordOutboundMessage($state, [
            'kind' => 'pong',
            'messageId' => 'ping-1',
            'serverTime' => '2026-05-24T10:00:01+00:00',
        ], 'direct', 104);

        self::assertSame(0, $state['traffic']['incoming']['messages']);
        self::assertSame(0, $state['traffic']['incoming']['characters']);
        self::assertSame(0, $state['traffic']['outgoing']['messages']);
        self::assertSame(0, $state['traffic']['outgoing']['characters']);
        self::assertSame(1, $state['traffic']['keepalive']['incoming']['messages']);
        self::assertSame(96, $state['traffic']['keepalive']['incoming']['characters']);
        self::assertSame(1, $state['traffic']['keepalive']['outgoing']['messages']);
        self::assertSame(104, $state['traffic']['keepalive']['outgoing']['characters']);
        self::assertSame(1, $state['pipeline']['pong']);
        self::assertSame([], $state['recent']);
    }

    public function testActionExchangeTracksMessagesCharactersAndSanitizedOperationTypes(): void
    {
        $aggregator = new GameDebugHealthAggregator();
        $state = $aggregator->normalize([]);

        $state = $aggregator->recordActionExchange($state, [
            'kind' => 'command',
            'action' => 'card.tapped',
            'clientActionId' => 'action-tap',
            'userId' => 'user-1',
            'baseVersion' => 7,
            'characters' => 192,
        ], [[
            'kind' => 'game_patch',
            'channel' => 'broadcast',
            'recipientUserId' => 'user-1',
            'version' => 8,
            'clientActionId' => 'action-tap',
            'operations' => [[
                'op' => 'card.tapped.set',
                'instanceId' => 'must-not-leak',
                'name' => 'Must Not Leak',
            ]],
            'characters' => 512,
        ], [
            'kind' => 'game_patch',
            'channel' => 'broadcast',
            'recipientUserId' => 'user-2',
            'version' => 8,
            'clientActionId' => 'action-tap',
            'operations' => [[
                'op' => 'card.tapped.set',
                'instanceId' => 'must-not-leak-2',
                'name' => 'Must Not Leak 2',
            ]],
            'characters' => 498,
        ]], 12.3456);

        self::assertSame(1, $state['actions']['total']);
        self::assertSame(1, $state['actions']['byType']['card.tapped']);
        self::assertSame(1, $state['traffic']['incoming']['messages']);
        self::assertSame(2, $state['traffic']['outgoing']['messages']);
        self::assertSame(192, $state['traffic']['incoming']['characters']);
        self::assertSame(1010, $state['traffic']['outgoing']['characters']);
        self::assertSame(12.35, $state['actions']['recent'][0]['durationMs']);
        self::assertSame('user-1', $state['actions']['recent'][0]['userId']);
        self::assertSame(2, $state['actions']['recent'][0]['outgoing']['messages']);
        self::assertSame(2, $state['actions']['recent'][0]['outgoing']['recipientCount']);
        self::assertSame(['card.tapped.set'], $state['actions']['recent'][0]['outgoing']['operationTypes']);
        self::assertStringNotContainsString('Must Not Leak', json_encode($state['actions']['recent'][0], JSON_THROW_ON_ERROR));
        self::assertStringNotContainsString('must-not-leak', json_encode($state['actions']['recent'][0], JSON_THROW_ON_ERROR));
    }

    public function testTappedActionExchangeKeepsStablePayloadSizesAndMoveCanBeLarger(): void
    {
        $aggregator = new GameDebugHealthAggregator();
        $state = $aggregator->normalize([]);

        foreach ([true, false] as $index => $tapped) {
            $state = $aggregator->recordActionExchange($state, [
                'kind' => 'command',
                'action' => 'card.tapped',
                'clientActionId' => 'tap-'.$index,
                'userId' => 'user-1',
                'baseVersion' => 7 + $index,
                'characters' => 190,
            ], [[
                'kind' => 'game_patch',
                'channel' => 'broadcast',
                'recipientUserId' => 'user-1',
                'version' => 8 + $index,
                'clientActionId' => 'tap-'.$index,
                'operations' => [[
                    'op' => 'card.state.set',
                    'playerId' => 'user-1',
                    'zone' => 'battlefield',
                    'tapped' => $tapped,
                ]],
                'characters' => $tapped ? 420 : 421,
            ]], 4.2);
        }

        $state = $aggregator->recordActionExchange($state, [
            'kind' => 'command',
            'action' => 'card.moved',
            'clientActionId' => 'move-1',
            'userId' => 'user-1',
            'baseVersion' => 9,
            'characters' => 260,
        ], [[
            'kind' => 'game_patch',
            'channel' => 'broadcast',
            'recipientUserId' => 'user-1',
            'version' => 10,
            'clientActionId' => 'move-1',
            'operations' => [[
                'op' => 'card.move',
                'from' => ['playerId' => 'user-1', 'zone' => 'hand'],
                'to' => ['playerId' => 'user-1', 'zone' => 'battlefield'],
                'card' => ['name' => 'Sanitized Test Card'],
            ]],
            'characters' => 950,
        ]], 8.5);

        self::assertSame(3, $state['actions']['total']);
        self::assertSame(2, $state['actions']['byType']['card.tapped']);
        self::assertSame(1, $state['actions']['byType']['card.moved']);
        self::assertSame(420, $state['actions']['recent'][0]['outgoing']['characters']);
        self::assertSame(421, $state['actions']['recent'][1]['outgoing']['characters']);
        self::assertSame(950, $state['actions']['recent'][2]['outgoing']['characters']);
        self::assertSame(['card.state.set'], $state['actions']['recent'][0]['outgoing']['operationTypes']);
        self::assertSame(['card.state.set'], $state['actions']['recent'][1]['outgoing']['operationTypes']);
        self::assertSame(['card.move'], $state['actions']['recent'][2]['outgoing']['operationTypes']);
    }

    public function testIncomingErrorsAndReplayMetricsAreTracked(): void
    {
        $aggregator = new GameDebugHealthAggregator();
        $state = $aggregator->normalize([]);

        $state = $aggregator->recordIncomingValidationError($state, 'INVALID_JSON', 'WebSocket message must be valid JSON.');
        $state = $aggregator->recordReplayResult($state, 'user-1', 3, 5, null, 'gap');

        self::assertSame(1, $state['errors']['total']);
        self::assertSame(1, $state['errors']['byCode']['INVALID_JSON']);
        self::assertSame('WebSocket message must be valid JSON.', $state['errors']['recent'][0]['message']);
        self::assertSame(1, $state['traffic']['incoming']['messages']);
        self::assertSame(1, $state['replay']['attempts']);
        self::assertSame(1, $state['replay']['gaps']);
        self::assertSame('version_gap', $state['sync']['lastVersionGap']['reason']);
        self::assertSame('user-1', $state['replay']['lastWindow']['userId']);
    }

    public function testRecentAndEventsBuffersAreBounded(): void
    {
        $aggregator = new GameDebugHealthAggregator();
        $state = $aggregator->normalize([]);

        for ($i = 0; $i < 400; ++$i) {
            $state = $aggregator->recordOutboundMessage($state, [
                'kind' => 'error',
                'error' => [
                    'code' => 'ERR_'.$i,
                    'message' => 'Failure '.$i,
                    'retryable' => false,
                ],
            ], 'direct');
        }

        self::assertLessThanOrEqual(120, count($state['recent']));
        self::assertLessThanOrEqual(240, count($state['events']));
    }
}
