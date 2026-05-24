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
}
