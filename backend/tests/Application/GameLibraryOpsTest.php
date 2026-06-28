<?php

namespace App\Tests\Application;

use App\Application\Game\GameLibraryOps;
use PHPUnit\Framework\TestCase;

class GameLibraryOpsTest extends TestCase
{
    public function testDrawOneReturnsLogicalTopCardAndPreservesMagicOrder(): void
    {
        $ops = new GameLibraryOps();
        $player = $this->playerWithLibrary(['top-card', 'second-card', 'bottom-card']);

        $drawn = $ops->drawOne($player);

        self::assertSame('top-card', $drawn['instanceId'] ?? null);
        self::assertSame(['second-card', 'bottom-card'], $this->libraryIds($ops, $player));
    }

    public function testDrawManyReturnsTopBatchInOrder(): void
    {
        $ops = new GameLibraryOps();
        $player = $this->playerWithLibrary(['top-card', 'second-card', 'third-card', 'bottom-card']);

        $drawn = $ops->drawMany($player, 2);

        self::assertSame(['top-card', 'second-card'], array_map(
            static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
            $drawn,
        ));
        self::assertSame(['third-card', 'bottom-card'], $this->libraryIds($ops, $player));
    }

    public function testPutOnTopAndPutOnBottomPreserveProjectionOrder(): void
    {
        $ops = new GameLibraryOps();
        $player = $this->playerWithLibrary(['old-top', 'old-bottom']);

        $ops->putOnTop($player, $this->card('new-top'));
        $ops->putOnBottom($player, $this->card('new-bottom'));

        self::assertSame(['new-top', 'old-top', 'old-bottom', 'new-bottom'], $this->libraryIds($ops, $player));
    }

    public function testPutManyOnTopAndBottomPreserveSequentialPlacementOrder(): void
    {
        $ops = new GameLibraryOps();
        $player = $this->playerWithLibrary(['old-top', 'old-bottom']);

        $ops->putManyOnTop($player, [$this->card('top-a'), $this->card('top-b')]);
        $ops->putManyOnBottom($player, [$this->card('bottom-a'), $this->card('bottom-b')]);

        self::assertSame(
            ['top-b', 'top-a', 'old-top', 'old-bottom', 'bottom-a', 'bottom-b'],
            $this->libraryIds($ops, $player),
        );
    }

    public function testExtractByInstanceIdsPreservesRequestedOrderAndRemainingLibrary(): void
    {
        $ops = new GameLibraryOps();
        $player = $this->playerWithLibrary(['top-card', 'second-card', 'third-card', 'bottom-card']);

        $removed = $ops->extractByInstanceIds($player, ['third-card', 'top-card']);

        self::assertSame(['third-card', 'top-card'], array_map(
            static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
            $removed,
        ));
        self::assertSame(['second-card', 'bottom-card'], $this->libraryIds($ops, $player));
    }

    public function testRevealTopUsesVisibilityEpochWithoutClearingWholeLibrary(): void
    {
        $ops = new GameLibraryOps();
        $viewerId = 'viewer@example.test';
        $player = $this->playerWithLibrary(['top-card', 'second-card', 'third-card']);
        $player['zones']['library'][0]['revealedTo'] = [$viewerId];
        $player['zones']['library'][0][GameLibraryOps::CARD_VISIBILITY_EPOCH_KEY] = 1;

        $revealed = $ops->revealTop($player, 1, [$viewerId]);

        self::assertSame(1, $revealed);
        self::assertSame(2, $player[GameLibraryOps::VISIBILITY_EPOCH_KEY]);

        $topCard = $ops->topCard($player);
        self::assertSame('top-card', $topCard['instanceId'] ?? null);
        self::assertTrue($ops->isCardVisibleTo($player, $topCard, $viewerId));

        $projected = $ops->projectionOrderCards($player);
        self::assertFalse($ops->isCardVisibleTo($player, $projected[1], $viewerId));
        self::assertFalse($ops->isCardVisibleTo($player, $projected[2], $viewerId));
    }

    public function testReorderTopOnlyMutatesRequestedWindow(): void
    {
        $ops = new GameLibraryOps();
        $player = $this->playerWithLibrary(['top-card', 'second-card', 'third-card', 'fourth-card']);

        $ops->reorderTop($player, ['second-card', 'top-card']);

        self::assertSame(['second-card', 'top-card', 'third-card', 'fourth-card'], $this->libraryIds($ops, $player));
    }

    public function testShuffleClearsRevealByEpoch(): void
    {
        $ops = new GameLibraryOps();
        $viewerId = 'viewer@example.test';
        $player = $this->playerWithLibrary(['top-card', 'second-card', 'third-card']);
        $ops->revealTop($player, 2, [$viewerId]);

        $beforeShuffleTop = $ops->topCard($player);
        self::assertTrue($ops->isCardVisibleTo($player, $beforeShuffleTop, $viewerId));

        $ops->shuffle($player, static fn (array $cards): array => array_reverse($cards));

        self::assertSame([], $player['revealedLibraryTo']);
        self::assertSame(3, $player[GameLibraryOps::VISIBILITY_EPOCH_KEY]);
        self::assertFalse($ops->isCardVisibleTo($player, $beforeShuffleTop, $viewerId));
    }

    /**
     * @param list<string> $instanceIds
     *
     * @return array<string,mixed>
     */
    private function playerWithLibrary(array $instanceIds): array
    {
        return [
            'zones' => [
                'library' => array_map(fn (string $instanceId): array => $this->card($instanceId), $instanceIds),
            ],
            'revealedLibraryTo' => [],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function card(string $instanceId): array
    {
        return [
            'instanceId' => $instanceId,
            'ownerId' => 'owner@example.test',
            'controllerId' => 'owner@example.test',
            'zone' => 'library',
            'faceDown' => false,
            'revealedTo' => [],
        ];
    }

    /**
     * @return list<string>
     */
    private function libraryIds(GameLibraryOps $ops, array $player): array
    {
        return array_map(
            static fn (array $card): string => (string) ($card['instanceId'] ?? ''),
            $ops->projectionOrderCards($player),
        );
    }
}
