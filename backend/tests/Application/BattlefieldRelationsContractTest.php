<?php

namespace App\Tests\Application;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\GameEventReplayService;
use App\Application\Game\WebSocket\GameWebsocketMessageFactory;
use App\Application\Game\WebSocket\GameWebsocketPatchBuilder;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

final class BattlefieldRelationsContractTest extends TestCase
{
    public function testReplayUsesFinalEffectsForAttachmentDetachStackMemberRemovalAndDissolve(): void
    {
        $owner = new User('relations-replay@example.test', 'Relations Replay');
        $snapshot = $this->snapshot($owner);
        $game = new Game(new Room($owner), $snapshot);
        $events = [
            new GameEvent($game, 'attachment.created', [
                'attachment' => [
                    'id' => 'attachment-1',
                    'relationType' => 'attachment',
                    'equipmentInstanceId' => 'i4',
                    'attachedToInstanceId' => 'i5',
                    'ownerPlayerId' => $owner->id(),
                    'order' => 1,
                    'effectVersion' => 1,
                    'createdAtVersion' => 2,
                    'createdAt' => '2026-07-14T00:00:00+00:00',
                ],
            ], $owner, 'attachment-create', 2),
            new GameEvent($game, 'attachment.removed', [
                'id' => 'attachment-1',
                'instanceId' => 'i4',
                'position' => ['x' => 0.44, 'y' => 0.55, 'unit' => 'ratio'],
            ], $owner, 'attachment-remove', 3),
            new GameEvent($game, 'battlefield.stack.created', [
                'stack' => $this->stack(['i1', 'i2', 'i3']),
            ], $owner, 'stack-create', 4),
            new GameEvent($game, 'battlefield.stack.member_removed', [
                'stackId' => 'stack-1',
                'instanceId' => 'i2',
                'position' => ['x' => 0.62, 'y' => 0.41, 'unit' => 'ratio'],
                'stack' => $this->stack(['i1', 'i3']),
            ], $owner, 'stack-remove-member', 5),
            new GameEvent($game, 'battlefield.stack.dissolved', [
                'stackId' => 'stack-1',
                'positions' => [
                    ['instanceId' => 'i1', 'position' => ['x' => 0.1, 'y' => 0.2, 'unit' => 'ratio']],
                    ['instanceId' => 'i3', 'position' => ['x' => 0.3, 'y' => 0.2, 'unit' => 'ratio']],
                ],
            ], $owner, 'stack-dissolve', 6),
        ];

        $rebuilt = (new GameEventReplayService())->replay($snapshot, $events);

        self::assertSame([], $rebuilt['attachments']);
        self::assertSame([], $rebuilt['battlefieldStacks']);
        self::assertSame(['x' => 0.44, 'y' => 0.55, 'unit' => 'ratio'], $this->card($rebuilt, $owner->id(), 'i4')['position']);
        self::assertSame(['x' => 0.62, 'y' => 0.41, 'unit' => 'ratio'], $this->card($rebuilt, $owner->id(), 'i2')['position']);
        self::assertSame(['x' => 0.1, 'y' => 0.2, 'unit' => 'ratio'], $this->card($rebuilt, $owner->id(), 'i1')['position']);
        self::assertSame(['x' => 0.3, 'y' => 0.2, 'unit' => 'ratio'], $this->card($rebuilt, $owner->id(), 'i3')['position']);
    }

    public function testReplayNormalizesThenDissolvesBattlefieldStackWhenMembersLeaveBattlefield(): void
    {
        $owner = new User('relations-zone-exit@example.test', 'Relations Zone Exit');
        $snapshot = $this->snapshot($owner);
        $snapshot['battlefieldStacks'] = [$this->stack(['i1', 'i2', 'i3'])];
        $game = new Game(new Room($owner), $snapshot);
        $rootExit = new GameEvent($game, 'card.moved', [
            'moves' => [[
                'instanceId' => 'i1',
                'from' => ['playerId' => $owner->id(), 'zone' => 'battlefield'],
                'to' => ['playerId' => $owner->id(), 'zone' => 'graveyard', 'index' => 0],
            ]],
        ], $owner, 'stack-root-exit', 2);

        $normalized = (new GameEventReplayService())->replay($snapshot, [$rootExit]);

        self::assertSame('i2', $normalized['battlefieldStacks'][0]['rootInstanceId']);
        self::assertSame(['i2', 'i3'], $normalized['battlefieldStacks'][0]['orderedMemberIds']);

        $secondExit = new GameEvent($game, 'card.moved', [
            'moves' => [[
                'instanceId' => 'i2',
                'from' => ['playerId' => $owner->id(), 'zone' => 'battlefield'],
                'to' => ['playerId' => $owner->id(), 'zone' => 'graveyard', 'index' => 1],
            ]],
        ], $owner, 'stack-second-exit', 3);

        $dissolved = (new GameEventReplayService())->replay($normalized, [$secondExit]);

        self::assertSame([], $dissolved['battlefieldStacks']);
    }

    public function testCompactRoundTripAndBootstrapPreserveRelationGraphWithoutIdentityPayload(): void
    {
        $owner = new User('relations-bootstrap@example.test', 'Relations Bootstrap');
        $snapshot = $this->snapshot($owner);
        $snapshot['attachments'] = [[
            'id' => 'attachment-1',
            'relationType' => 'attachment',
            'equipmentInstanceId' => 'i4',
            'attachedToInstanceId' => 'i5',
            'ownerPlayerId' => $owner->id(),
            'order' => 1,
            'effectVersion' => 1,
            'createdAtVersion' => 2,
            'createdAt' => '2026-07-14T00:00:00+00:00',
        ]];
        $snapshot['battlefieldStacks'] = [$this->stack(['i1', 'i2', 'i3'])];
        $mapper = new CompactGameCardStateMapper();

        $compact = $mapper->compactSnapshot($snapshot, 'relations-game', Game::STATUS_ACTIVE);
        $roundTrip = $mapper->hydrateSnapshot($compact);
        $bootstrap = (new GameplayV2ContractFactory())
            ->bootstrap(new Game(new Room($owner), $compact), $owner, $roundTrip)
            ->toArray();

        self::assertSame($snapshot['attachments'], $roundTrip['attachments']);
        self::assertSame($snapshot['battlefieldStacks'], $roundTrip['battlefieldStacks']);
        self::assertSame($snapshot['attachments'], $bootstrap['relations']['attachments']);
        self::assertSame($snapshot['battlefieldStacks'], $bootstrap['relations']['battlefieldStacks']);
        $encodedRelations = json_encode($bootstrap['relations'], JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString('name', $encodedRelations);
        self::assertStringNotContainsString('imageUris', $encodedRelations);
        self::assertStringNotContainsString('oracleText', $encodedRelations);
    }

    public function testPatchBuilderEmitsTypedBattlefieldRelationOperations(): void
    {
        $owner = new User('relations-patch@example.test', 'Relations Patch');
        $previous = $this->snapshot($owner);
        $game = new Game(new Room($owner), $previous);
        $stack = $this->stack(['i1', 'i2', 'i3']);
        $created = new GameEvent($game, 'battlefield.stack.created', ['stack' => $stack], $owner, 'stack-patch-create', 2);
        $next = [...$previous, 'version' => 2, 'battlefieldStacks' => [$stack]];
        $builder = new GameWebsocketPatchBuilder(new GameWebsocketMessageFactory());

        $createPatch = $builder->build($game->id(), $previous, $next, $created, $created->payload());

        self::assertSame(['battlefield.stack.set'], array_column($createPatch['operations'], 'op'));
        self::assertSame($stack, $createPatch['operations'][0]['stack']);

        $positions = [
            ['instanceId' => 'i1', 'position' => ['x' => 0.1, 'y' => 0.2, 'unit' => 'ratio']],
            ['instanceId' => 'i2', 'position' => ['x' => 0.3, 'y' => 0.2, 'unit' => 'ratio']],
            ['instanceId' => 'i3', 'position' => ['x' => 0.5, 'y' => 0.2, 'unit' => 'ratio']],
        ];
        $dissolved = new GameEvent($game, 'battlefield.stack.dissolved', [
            'stackId' => 'stack-1',
            'positions' => $positions,
        ], $owner, 'stack-patch-dissolve', 3);
        $final = [...$next, 'version' => 3, 'battlefieldStacks' => []];

        $dissolvePatch = $builder->build($game->id(), $next, $final, $dissolved, $dissolved->payload());

        self::assertSame(['battlefield.stack.remove', 'cards.position.set'], array_column($dissolvePatch['operations'], 'op'));
        self::assertSame($positions, $dissolvePatch['operations'][1]['positions']);
    }

    /** @return array<string,mixed> */
    private function snapshot(User $owner): array
    {
        $battlefield = [];
        for ($index = 1; $index <= 5; ++$index) {
            $battlefield[] = [
                'instanceId' => 'i'.$index,
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'battlefield',
                'name' => 'Public card '.$index,
                'tapped' => false,
                'position' => ['x' => $index / 10, 'y' => 0.2, 'unit' => 'ratio'],
            ];
        }

        return [
            'version' => 1,
            'ownerId' => $owner->id(),
            'players' => [
                $owner->id() => [
                    'user' => ['id' => $owner->id(), 'email' => $owner->email(), 'displayName' => $owner->displayName(), 'roles' => []],
                    'life' => 40,
                    'zones' => ['library' => [], 'hand' => [], 'battlefield' => $battlefield, 'graveyard' => [], 'exile' => [], 'command' => []],
                    'commanderDamage' => [],
                    'counters' => [],
                ],
            ],
            'turn' => ['activePlayerId' => $owner->id(), 'phase' => 'main-1', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'battlefieldStacks' => [],
            'chat' => [],
            'eventLog' => [],
            'counters' => [],
            'createdAt' => '2026-07-14T00:00:00+00:00',
        ];
    }

    /** @param list<string> $members @return array<string,mixed> */
    private function stack(array $members): array
    {
        return [
            'id' => 'stack-1',
            'relationType' => 'battlefield_stack',
            'rootInstanceId' => $members[0],
            'orderedMemberIds' => $members,
            'stackKind' => 'land',
            'effectVersion' => 1,
            'createdAtVersion' => 4,
        ];
    }

    /** @param array<string,mixed> $snapshot @return array<string,mixed> */
    private function card(array $snapshot, string $playerId, string $instanceId): array
    {
        foreach ($snapshot['players'][$playerId]['zones']['battlefield'] as $card) {
            if (($card['instanceId'] ?? null) === $instanceId) {
                return $card;
            }
        }

        self::fail('Card not found: '.$instanceId);
    }
}
