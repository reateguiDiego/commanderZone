<?php

namespace App\Tests\Application;

use App\Application\Game\Runtime\GameplayRuntimePatchAdapter;
use App\Application\Game\Runtime\GameplayRuntimePatchContractException;
use PHPUnit\Framework\TestCase;

final class GameplayRuntimePatchAdapterTest extends TestCase
{
    public function testNormalizesRuntimePatchOpsToFrontendFlatShape(): void
    {
        $patches = (new GameplayRuntimePatchAdapter())->normalize([[
            'gameId' => 'game-1',
            'version' => 2,
            'visibility' => 'player:player-1',
            'ackClientActionId' => 'action-1',
            'ops' => [[
                'op' => 'zone.cards.add',
                'data' => ['playerId' => 'player-1', 'zone' => 'hand', 'cards' => []],
            ]],
        ]]);

        self::assertSame('zone.cards.add', $patches[0]['ops'][0]['op']);
        self::assertSame('player-1', $patches[0]['ops'][0]['playerId']);
        self::assertArrayNotHasKey('data', $patches[0]['ops'][0]);
    }

    public function testRejectsInvalidRuntimePatchContracts(): void
    {
        $this->assertInvalidPatch([[
            'gameId' => 'game-1',
            'visibility' => 'public',
            'ops' => [['op' => 'turn.set', 'data' => ['turn' => []]]],
        ]]);
        $this->assertInvalidPatch([[
            'gameId' => 'game-1',
            'version' => 2,
            'visibility' => 'public',
            'ops' => [['data' => ['turn' => []]]],
        ]]);
    }

    /**
     * @param list<array<string, mixed>> $patches
     */
    private function assertInvalidPatch(array $patches): void
    {
        try {
            (new GameplayRuntimePatchAdapter())->normalize($patches);
            self::fail('Expected invalid runtime patch contract to be rejected.');
        } catch (GameplayRuntimePatchContractException) {
            self::assertTrue(true);
        }
    }
}
