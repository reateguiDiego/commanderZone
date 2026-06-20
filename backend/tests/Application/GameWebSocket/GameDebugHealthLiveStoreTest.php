<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\Debug\GameDebugHealthAggregator;
use App\Application\Game\Debug\GameDebugHealthLiveStore;
use PHPUnit\Framework\TestCase;

class GameDebugHealthLiveStoreTest extends TestCase
{
    public function testItDoesNotCollectWhenNoDebugClientIsConnected(): void
    {
        $store = new GameDebugHealthLiveStore(new GameDebugHealthAggregator());

        $store->recordIncomingMessage('game-1', [
            'kind' => 'command',
            'command' => ['type' => 'card.tapped'],
        ], 16);

        self::assertFalse($store->isObserved('game-1'));
        self::assertSame(0, $store->reportForGame('game-1')['health']['traffic']['incoming']['messages']);
    }

    public function testItCollectsAndPublishesOnlyWhileObserved(): void
    {
        $store = new GameDebugHealthLiveStore(new GameDebugHealthAggregator());
        $reports = [];

        $subscriberId = $store->subscribe('game-1', static function (array $report) use (&$reports): void {
            $reports[] = $report;
        });

        $store->recordIncomingMessage('game-1', [
            'kind' => 'command',
            'command' => ['type' => 'card.tapped'],
        ], 16);

        self::assertTrue($store->isObserved('game-1'));
        self::assertCount(2, $reports);
        self::assertSame(1, $reports[1]['health']['traffic']['incoming']['messages']);

        $store->unsubscribe('game-1', $subscriberId);
        $store->recordIncomingMessage('game-1', ['kind' => 'ping'], 16);

        self::assertFalse($store->isObserved('game-1'));
        self::assertSame(0, $store->reportForGame('game-1')['health']['traffic']['incoming']['messages']);
    }

    public function testKeepaliveTrafficDoesNotPublishFullDebugReports(): void
    {
        $store = new GameDebugHealthLiveStore(new GameDebugHealthAggregator());
        $reports = [];

        $store->subscribe('game-1', static function (array $report) use (&$reports): void {
            $reports[] = $report;
        });

        $store->recordIncomingMessage('game-1', ['kind' => 'ping'], 72);
        $store->recordOutboundMessage('game-1', ['kind' => 'pong'], 'direct');

        self::assertCount(1, $reports);

        $current = $store->reportForGame('game-1');
        self::assertSame(0, $current['health']['traffic']['incoming']['messages']);
        self::assertSame(0, $current['health']['traffic']['outgoing']['messages']);
        self::assertSame(1, $current['health']['traffic']['keepalive']['incoming']['messages']);
        self::assertSame(1, $current['health']['traffic']['keepalive']['outgoing']['messages']);
    }

    public function testMulliganDebugMessagesAreRedactedBeforeAggregation(): void
    {
        $store = new GameDebugHealthLiveStore(new GameDebugHealthAggregator());
        $store->subscribe('game-1', static function (): void {
        });

        $store->recordIncomingMessage('game-1', [
            'kind' => 'mulligan.keep',
            'gameId' => 'game-1',
            'bottomCardInstanceIds' => ['secret-card-2', 'secret-card-1'],
        ], 96);
        $store->recordOutboundMessage('game-1', [
            'kind' => 'mulligan.private_state',
            'gameId' => 'game-1',
            'hand' => [
                ['instanceId' => 'secret-hand-1', 'name' => 'Secret Hand Card'],
            ],
            'scryCard' => ['instanceId' => 'secret-library-1', 'name' => 'Secret Library Card'],
        ], 'direct');

        $encodedReport = json_encode($store->reportForGame('game-1'), JSON_THROW_ON_ERROR);

        self::assertStringNotContainsString('secret-card-2', $encodedReport);
        self::assertStringNotContainsString('secret-card-1', $encodedReport);
        self::assertStringNotContainsString('Secret Hand Card', $encodedReport);
        self::assertStringNotContainsString('secret-hand-1', $encodedReport);
        self::assertStringNotContainsString('Secret Library Card', $encodedReport);
        self::assertStringNotContainsString('secret-library-1', $encodedReport);
    }

    public function testUpdatedAtTracksLastMutationInsteadOfReadTime(): void
    {
        $store = new GameDebugHealthLiveStore(new GameDebugHealthAggregator());
        $store->subscribe('game-1', static function (): void {
        });

        $baseline = $store->reportForGame('game-1');
        self::assertSame($baseline['generatedAt'], $baseline['updatedAt']);

        sleep(1);
        $afterRead = $store->reportForGame('game-1');
        self::assertNotSame($baseline['generatedAt'], $afterRead['generatedAt']);
        self::assertSame($afterRead['generatedAt'], $afterRead['updatedAt']);
        self::assertNotSame($baseline['updatedAt'], $afterRead['updatedAt']);

        sleep(1);
        $store->recordIncomingMessage('game-1', [
            'kind' => 'command',
            'command' => ['type' => 'life.changed'],
        ], 18);

        $afterMutation = $store->reportForGame('game-1');
        self::assertNotSame($afterRead['updatedAt'], $afterMutation['updatedAt']);

        sleep(1);
        $afterMutationRead = $store->reportForGame('game-1');
        self::assertNotSame($afterMutation['generatedAt'], $afterMutationRead['generatedAt']);
        self::assertSame($afterMutation['updatedAt'], $afterMutationRead['updatedAt']);
    }

    public function testBootstrapStageMutationIsStoredAndPublishedWhileObserved(): void
    {
        $store = new GameDebugHealthLiveStore(new GameDebugHealthAggregator());
        $reports = [];

        $store->subscribe('game-1', static function (array $report) use (&$reports): void {
            $reports[] = $report;
        });

        $store->recordBootstrapStage('game-1', 'websocket_ticket', 32.5, ['viewerCount' => 4]);

        self::assertCount(2, $reports);
        self::assertSame(1, $reports[1]['health']['bootstrap']['stages']['websocket_ticket']['count']);
        self::assertSame(32.5, $reports[1]['health']['bootstrap']['stages']['websocket_ticket']['lastMs']);
        self::assertSame(4, $reports[1]['health']['bootstrap']['stages']['websocket_ticket']['lastContext']['viewerCount']);
    }
}
