<?php

namespace App\Tests\Application\Game\Contract\V2;

use App\Application\Game\Contract\V2\BootstrapV2;
use App\Application\Game\Contract\V2\CommandEnvelopeV2;
use App\Application\Game\Contract\V2\EventPayloadV2;
use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\PatchEnvelopeV2;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameplayV2ContractFactoryTest extends TestCase
{
    public function testCommandEnvelopeRoundTripsWithOptionalMetadata(): void
    {
        $envelope = CommandEnvelopeV2::fromArray([
            'gameId' => 'game-1',
            'baseVersion' => 3,
            'clientActionId' => 'action-1',
            'type' => 'library.draw',
            'payload' => ['playerId' => 'player-1', 'count' => 1],
            'sentAt' => '2026-01-01T00:00:00+00:00',
            'client' => ['platform' => 'web'],
        ]);

        self::assertSame([
            'gameId' => 'game-1',
            'baseVersion' => 3,
            'clientActionId' => 'action-1',
            'type' => 'library.draw',
            'payload' => ['playerId' => 'player-1', 'count' => 1],
            'sentAt' => '2026-01-01T00:00:00+00:00',
            'client' => ['platform' => 'web'],
        ], $envelope->toArray());
    }

    public function testPatchEnvelopeValidatesVisibilityAndOps(): void
    {
        $patch = PatchEnvelopeV2::fromArray([
            'gameId' => 'game-1',
            'version' => 4,
            'visibility' => 'player:user-1',
            'ackClientActionId' => 'action-1',
            'ops' => [
                ['op' => 'card.move', 'instanceId' => 'c1', 'toZone' => 'battlefield'],
            ],
        ]);

        self::assertSame('player:user-1', $patch->visibility);
        self::assertSame('action-1', $patch->ackClientActionId);
        self::assertSame('card.move', $patch->ops[0]['op']);
    }

    public function testPatchEnvelopeRejectsInvalidVisibility(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        PatchEnvelopeV2::fromArray([
            'gameId' => 'game-1',
            'version' => 2,
            'visibility' => 'private',
            'ops' => [['op' => 'x']],
        ]);
    }

    public function testFactoryBuildsBootstrapV2FromProjectedSnapshot(): void
    {
        [$game, $viewer] = $this->game();
        $factory = new GameplayV2ContractFactory();
        $bootstrap = $factory->bootstrap($game, $viewer, $this->projectedSnapshot($viewer));

        self::assertInstanceOf(BootstrapV2::class, $bootstrap);
        self::assertSame($game->id(), $bootstrap->game['id']);
        self::assertSame($viewer->id(), $bootstrap->game['viewerId']);
        self::assertArrayHasKey($viewer->id().':battlefield', $bootstrap->zones);
        self::assertArrayHasKey('battlefield-1', $bootstrap->instances);
        self::assertSame('battlefield', $bootstrap->zones[$viewer->id().':battlefield']['name']);
        self::assertSame(1, $bootstrap->zoneCounts[$viewer->id().':battlefield']);
        self::assertNotEmpty($bootstrap->staticCards);
        self::assertSame('chat-1', $bootstrap->chatCursor);
        self::assertSame('log-1', $bootstrap->logCursor);
    }

    public function testFactoryBuildsEventPayloadV2FromCurrentEvent(): void
    {
        [$game, $viewer] = $this->game();
        $event = new GameEvent($game, 'life.changed', ['playerId' => $viewer->id(), 'delta' => -1], $viewer, 'action-1');
        $factory = new GameplayV2ContractFactory();

        $payload = $factory->event($game, $event, 2);

        self::assertInstanceOf(EventPayloadV2::class, $payload);
        self::assertSame($game->id(), $payload->gameId);
        self::assertSame(2, $payload->version);
        self::assertSame('life.changed', $payload->type);
        self::assertSame('action-1', $payload->clientActionId);
        self::assertSame($viewer->id(), $payload->createdBy);
    }

    public function testFactoryConvertsLegacyCommandPayloadIntoV2Envelope(): void
    {
        $factory = new GameplayV2ContractFactory();
        $envelope = $factory->commandFromLegacyPayload('game-1', [
            'baseVersion' => 8,
            'clientActionId' => 'action-legacy',
            'type' => 'life.changed',
            'payload' => ['playerId' => 'p1', 'delta' => -2],
        ]);

        self::assertSame('game-1', $envelope->gameId);
        self::assertSame(8, $envelope->baseVersion);
        self::assertSame('action-legacy', $envelope->clientActionId);
    }

    public function testBootstrapContractRejectsInvalidZoneCounts(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        BootstrapV2::fromArray([
            'game' => ['id' => 'game-1'],
            'players' => [],
            'zones' => [],
            'instances' => [],
            'zoneCounts' => ['p1:hand' => -1],
            'relations' => [],
            'turn' => [],
            'staticCards' => [],
        ]);
    }

    /**
     * @return array{Game, User}
     */
    private function game(): array
    {
        $viewer = new User('viewer@example.test', 'Viewer');
        $room = new Room($viewer);
        $room->addPlayer(new RoomPlayer($room, $viewer));

        return [new Game($room, ['version' => 1, 'players' => [$viewer->id() => ['zones' => []]]]), $viewer];
    }

    /**
     * @return array<string,mixed>
     */
    private function projectedSnapshot(User $viewer): array
    {
        return [
            'version' => 2,
            'ownerId' => $viewer->id(),
            'players' => [
                $viewer->id() => [
                    'user' => $viewer->toArray(),
                    'life' => 40,
                    'status' => 'active',
                    'handCount' => 1,
                    'deckName' => 'Deck',
                    'commanderDamage' => [],
                    'counters' => [],
                    'zoneCounts' => [
                        'library' => 1,
                        'hand' => 1,
                        'battlefield' => 1,
                    ],
                    'zones' => [
                        'library' => [[
                            'instanceId' => 'library-1',
                            'ownerId' => $viewer->id(),
                            'controllerId' => $viewer->id(),
                            'scryfallId' => '11111111-1111-1111-1111-111111111111',
                            'name' => 'Library Card',
                            'tapped' => false,
                            'zone' => 'library',
                        ]],
                        'hand' => [[
                            'instanceId' => 'hand-1',
                            'ownerId' => $viewer->id(),
                            'controllerId' => $viewer->id(),
                            'scryfallId' => '22222222-2222-2222-2222-222222222222',
                            'name' => 'Hand Card',
                            'tapped' => false,
                            'zone' => 'hand',
                        ]],
                        'battlefield' => [[
                            'instanceId' => 'battlefield-1',
                            'ownerId' => $viewer->id(),
                            'controllerId' => $viewer->id(),
                            'scryfallId' => '33333333-3333-3333-3333-333333333333',
                            'name' => 'Battlefield Card',
                            'tapped' => true,
                            'zone' => 'battlefield',
                            'position' => ['x' => 0.2, 'y' => 0.3, 'unit' => 'ratio'],
                            'counters' => ['+1/+1' => 1],
                            'imageUris' => ['small' => 'https://example.test/card.png'],
                            'cardFaces' => [],
                            'colorIdentity' => ['G'],
                        ]],
                    ],
                ],
            ],
            'turn' => ['activePlayerId' => $viewer->id(), 'phase' => 'main-1', 'number' => 3],
            'stack' => [['id' => 'stack-1', 'kind' => 'spell', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'arrows' => [['id' => 'arrow-1', 'fromInstanceId' => 'battlefield-1', 'toInstanceId' => 'hand-1', 'color' => 'red', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'attachments' => [['id' => 'attachment-1', 'equipmentInstanceId' => 'battlefield-1', 'attachedToInstanceId' => 'hand-1', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'specialEntities' => [['id' => 'entity-1', 'template' => 'monarch', 'scope' => 'global', 'ownerPlayerId' => null, 'card' => null, 'state' => [], 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'chat' => [['id' => 'chat-1', 'message' => 'hola', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'eventLog' => [['id' => 'log-1', 'message' => 'log', 'createdAt' => '2026-01-01T00:00:00+00:00']],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:00+00:00',
        ];
    }
}
