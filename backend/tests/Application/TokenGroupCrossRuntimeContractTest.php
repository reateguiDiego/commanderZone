<?php

namespace App\Tests\Application;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameEventReplayService;
use App\Application\Game\TokenGroup\RuntimeOffTokenCreationEffectFactory;
use App\Application\Game\TokenGroup\TokenGroupCanonicalizer;
use App\Application\Game\TokenGroup\TokenGroupContractException;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

final class TokenGroupCrossRuntimeContractTest extends TestCase
{
    public function testSharedCreationVectorsProduceCrossRuntimeStableIdsAndCanonicalEffects(): void
    {
        $fixture = $this->fixture();
        $canonicalizer = new TokenGroupCanonicalizer();
        $factory = new RuntimeOffTokenCreationEffectFactory($canonicalizer);

        foreach ($fixture['createScenarios'] as $scenario) {
            $effect = $factory->create(
                $scenario['gameId'],
                $scenario['clientActionId'],
                'p1',
                2,
                $scenario['quantity'],
                'Treasure',
                ['cardKey' => 'token:treasure', 'name' => 'Treasure'],
                ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
            );
            $retry = $factory->create(
                $scenario['gameId'],
                $scenario['clientActionId'],
                'p1',
                2,
                $scenario['quantity'],
                'Treasure',
                ['cardKey' => 'token:treasure', 'name' => 'Treasure'],
                ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
            );

            self::assertSame($effect, $retry, $scenario['name'].' retry');
            self::assertSame($scenario['expectedMemberIds'], array_column($effect['tokens'], 'instanceId'), $scenario['name']);
            self::assertSame($scenario['expectedGroupId'], $effect['tokenGroup']['groupId'] ?? null, $scenario['name']);
            self::assertSame($scenario['expectedMemberIds'], $effect['tokenGroup']['orderedMemberIds'] ?? $scenario['expectedMemberIds'], $scenario['name']);
            self::assertSame(2, $effect['eventPayload']['effectVersion']);
            self::assertNull($effect['tokens'][0]['manualOverrides']);
            $validated = $canonicalizer->validateTokenCreatedEffect($effect['eventPayload'], 2, 'p1');
            self::assertSame($scenario['quantity'], $validated['count']);
            self::assertSame($effect['tokenGroup'], $validated['tokenGroup']);
        }
    }

    public function testCanonicalMapperRejectsAliasesQuantityTypesRootDuplicatesAndFutureVersions(): void
    {
        $canonicalizer = new TokenGroupCanonicalizer();
        foreach ($this->fixture()['invalidCanonicalGroups'] as $invalid) {
            try {
                $canonicalizer->normalizeCanonical($invalid['group']);
                self::fail($invalid['name'].' was accepted.');
            } catch (TokenGroupContractException $exception) {
                self::assertSame($invalid['expectedError'], $exception->errorCode(), $invalid['name']);
                self::assertStringNotContainsString('token-a', json_encode($exception->errorPayload(), JSON_THROW_ON_ERROR));
            }
        }

        $valid = $this->validGroup();
        foreach ([
            'null revision' => [...$valid, 'revision' => null],
            'string revision' => [...$valid, 'revision' => '1'],
            'zero revision' => [...$valid, 'revision' => 0],
            'legacy members alias' => array_diff_key([...$valid, 'members' => $valid['orderedMemberIds']], ['orderedMemberIds' => true]),
            'legacy root alias' => array_diff_key([...$valid, 'rootId' => $valid['rootInstanceId']], ['rootInstanceId' => true]),
            'unknown field' => [...$valid, 'metadata' => []],
        ] as $name => $payload) {
            try {
                $canonicalizer->normalizeCanonical($payload);
                self::fail($name.' was accepted.');
            } catch (TokenGroupContractException $exception) {
                self::assertSame(TokenGroupCanonicalizer::INVARIANT_FAILED, $exception->errorCode(), $name);
            }
        }
    }

    public function testNewTokenCreatedEventRequiresExactFinalGroupWhileLegacyDoesNotInferOne(): void
    {
        $canonicalizer = new TokenGroupCanonicalizer();
        $factory = new RuntimeOffTokenCreationEffectFactory($canonicalizer);
        $created = $factory->create('game-1', 'create-two', 'p1', 4, 2, 'Treasure', [], ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio']);

        $invalidEffects = [
            'new quantity two without group' => array_diff_key($created['eventPayload'], ['tokenGroup' => true]),
            'quantity one with group' => [...$created['eventPayload'], 'count' => 1, 'instanceIds' => [$created['eventPayload']['instanceIds'][0]], 'tokens' => [$created['eventPayload']['tokens'][0]]],
            'member mismatch' => [...$created['eventPayload'], 'instanceIds' => array_reverse($created['eventPayload']['instanceIds'])],
            'future effect' => [...$created['eventPayload'], 'effectVersion' => 999],
            'final effects without version' => array_diff_key($created['eventPayload'], ['effectVersion' => true]),
        ];
        foreach ($invalidEffects as $name => $payload) {
            try {
                $canonicalizer->validateTokenCreatedEffect($payload, 4, 'p1');
                self::fail($name.' was accepted.');
            } catch (TokenGroupContractException) {
                self::addToAssertionCount(1);
            }
        }

        self::assertTrue($canonicalizer->validateTokenCreatedEffect([
            'playerId' => 'p1',
            'quantity' => 2,
            'instanceIds' => ['legacy-a', 'legacy-b'],
        ], 3, 'p1')['legacy']);
    }

    public function testRuntimeOffLiveReplayCompactAndRestartPreserveGroupOrderIdentityAndLog(): void
    {
        $actor = new User('cross-runtime@example.test', 'Cross Runtime');
        $before = $this->snapshot($actor->id());
        $game = new Game(new Room($actor), $before);
        $handler = new GameCommandHandler();
        $event = $handler->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'quantity' => 10,
            'card' => [
                'cardKey' => 'token:treasure',
                'printId' => 'treasure-print',
                'cardVersion' => 'oracle-v7',
                'language' => 'es',
                'name' => 'Treasure',
                'typeLine' => 'Token Artifact - Treasure',
            ],
        ], $actor, 'cross-runtime-create-10');

        $live = $game->snapshot();
        $replayed = (new GameEventReplayService())->replay($before, [$event]);
        $mapper = new CompactGameCardStateMapper();
        $restarted = $mapper->hydrateSnapshot($mapper->compactSnapshot($live, $game->id(), $game->status()));

        foreach ([$replayed, $restarted] as $state) {
            self::assertSame($live['tokenGroups'], $state['tokenGroups']);
            self::assertSame(
                array_column($live['players'][$actor->id()]['zones']['battlefield'], 'instanceId'),
                array_column($state['players'][$actor->id()]['zones']['battlefield'], 'instanceId'),
            );
            foreach (['cardKey', 'printId', 'cardVersion', 'language', 'position', 'tokenMeta', 'counters', 'tapped', 'faceDown'] as $field) {
                self::assertSame(
                    $live['players'][$actor->id()]['zones']['battlefield'][0][$field] ?? null,
                    $state['players'][$actor->id()]['zones']['battlefield'][0][$field] ?? null,
                    $field,
                );
            }
            self::assertCount(1, $state['eventLog']);
            self::assertSame(10, $event->payload()['count']);
            self::assertSame('gameLog.token.createdMany', $state['eventLog'][0]['i18nKey'] ?? null);
            self::assertSame(10, $state['eventLog'][0]['i18nParams']['count'] ?? null);
            self::assertSame('Treasure', $state['eventLog'][0]['i18nParams']['tokenName'] ?? null);
            self::assertArrayNotHasKey('groupId', $state['eventLog'][0]);
            self::assertArrayNotHasKey('memberIds', $state['eventLog'][0]);
        }
    }

    public function testRuntimeOffRejectsRelationAndIndividualStateConflictsWithoutMutation(): void
    {
        $actor = new User('group-conflict@example.test', 'Owner');
        $game = new Game(new Room($actor), $this->snapshot($actor->id()));
        $handler = new GameCommandHandler();
        $handler->apply($game, 'card.token.created', [
            'playerId' => $actor->id(),
            'quantity' => 2,
            'card' => ['cardKey' => 'token:treasure', 'name' => 'Treasure'],
        ], $actor, 'group-conflict-create');
        $before = $game->snapshot();
        $memberId = $before['tokenGroups'][0]['orderedMemberIds'][0];

        try {
            $handler->apply($game, 'card.face_down.changed', [
                'playerId' => $actor->id(),
                'zone' => 'battlefield',
                'instanceId' => $memberId,
                'faceDown' => true,
            ], $actor, 'group-conflict-face-down');
            self::fail('Individual group mutation was accepted.');
        } catch (TokenGroupContractException $exception) {
            self::assertSame(TokenGroupCanonicalizer::MEMBER_REQUIRES_SPLIT, $exception->errorCode());
        }
        self::assertSame($before, $game->snapshot());
        self::assertCount(1, $game->events());

		$handler->apply($game, 'token.group.dissolve', [
			'groupId' => $before['tokenGroups'][0]['groupId'], 'expectedRevision' => 1,
		], $actor, 'group-conflict-dissolve');
		$members = array_column($game->snapshot()['players'][$actor->id()]['zones']['battlefield'], 'instanceId');
		$handler->apply($game, 'arrow.created', [
			'fromInstanceId' => $members[0], 'toInstanceId' => $members[1],
		], $actor, 'group-conflict-arrow');
		$beforeMerge = $game->snapshot();
		try {
			$handler->apply($game, 'token.group.merge', [
				'sourceGroupIds' => [], 'sourceInstanceIds' => $members, 'expectedRevisions' => [],
				'destinationPosition' => ['x' => .5, 'y' => .5, 'unit' => 'ratio'],
			], $actor, 'group-conflict-merge');
			self::fail('Merge with an arrow relation was accepted.');
		} catch (TokenGroupContractException $exception) {
			self::assertSame(TokenGroupCanonicalizer::RELATION_CONFLICT, $exception->errorCode());
		}
		self::assertSame($beforeMerge, $game->snapshot());
    }

    public function testRuntimeOffSplitMergeRemoveDissolveAndReplayUseExactFinalEffects(): void
    {
        $actor = new User('group-operations@example.test', 'Owner');
        $before = $this->snapshot($actor->id());
        $game = new Game(new Room($actor), $before);
        $handler = new GameCommandHandler();
        $events = [];
        $events[] = $handler->apply($game, 'card.token.created', [
            'playerId' => $actor->id(), 'quantity' => 20,
            'card' => ['cardKey' => 'token:treasure', 'name' => 'Treasure'],
        ], $actor, 'php-group-create');
        $group = $game->snapshot()['tokenGroups'][0];

        $events[] = $handler->apply($game, 'token.group.split', [
            'groupId' => $group['groupId'], 'expectedRevision' => 1, 'extractQuantity' => 10,
            'destinationPosition' => ['x' => .7, 'y' => .4, 'unit' => 'ratio'],
        ], $actor, 'php-group-split');
        $split = $game->snapshot();
        self::assertCount(2, $split['tokenGroups']);
        self::assertSame([10, 10], array_map(static fn (array $entry): int => count($entry['orderedMemberIds']), $split['tokenGroups']));
        self::assertSame([2, 1], array_column($split['tokenGroups'], 'revision'));
        self::assertSame('token.group.split', $events[1]->type());

        $groupsById = array_column($split['tokenGroups'], null, 'groupId');
        $newGroup = array_values(array_filter($split['tokenGroups'], static fn (array $entry): bool => $entry['groupId'] !== $group['groupId']))[0];
        $events[] = $handler->apply($game, 'token.group.merge', [
            'sourceGroupIds' => [$group['groupId'], $newGroup['groupId']], 'sourceInstanceIds' => [],
            'targetGroupId' => $group['groupId'],
            'expectedRevisions' => [$group['groupId'] => 2, $newGroup['groupId'] => 1],
            'destinationPosition' => ['x' => .5, 'y' => .5, 'unit' => 'ratio'],
        ], $actor, 'php-group-merge');
        $merged = $game->snapshot()['tokenGroups'][0];
        self::assertSame($group['groupId'], $merged['groupId']);
        self::assertSame(20, count($merged['orderedMemberIds']));
        self::assertSame(3, $merged['revision']);
        self::assertSame('token.group.merged', $events[2]->type());

        $events[] = $handler->apply($game, 'token.group.remove_members', [
            'groupId' => $merged['groupId'], 'expectedRevision' => 3, 'quantity' => 19,
            'removalReason' => 'manual',
        ], $actor, 'php-group-remove');
        self::assertSame([], $game->snapshot()['tokenGroups']);
        self::assertCount(1, $game->snapshot()['players'][$actor->id()]['zones']['battlefield']);
        self::assertSame('token.group.members.removed', $events[3]->type());
        self::assertCount(19, $events[3]->payload()['removedInstanceIds'] ?? []);

        $live = $game->snapshot();
        $replayed = (new GameEventReplayService())->replay($before, $events);
        self::assertSame($live['tokenGroups'], $replayed['tokenGroups']);
        self::assertSame(
            array_column($live['players'][$actor->id()]['zones']['battlefield'], 'instanceId'),
            array_column($replayed['players'][$actor->id()]['zones']['battlefield'], 'instanceId'),
        );
        self::assertSame($live['version'], $replayed['version']);
        self::assertCount(4, $live['eventLog']);
        self::assertCount(4, $replayed['eventLog']);

        $secondGame = new Game(new Room($actor), $this->snapshot($actor->id()));
        $handler->apply($secondGame, 'card.token.created', [
            'playerId' => $actor->id(), 'quantity' => 2,
            'card' => ['cardKey' => 'token:treasure', 'name' => 'Treasure'],
        ], $actor, 'php-group-dissolve-create');
        $pair = $secondGame->snapshot()['tokenGroups'][0];
        $dissolved = $handler->apply($secondGame, 'token.group.dissolve', [
            'groupId' => $pair['groupId'], 'expectedRevision' => 1,
        ], $actor, 'php-group-dissolve');
        self::assertSame('token.group.dissolved', $dissolved->type());
        self::assertSame([], $secondGame->snapshot()['tokenGroups']);
        $cards = $secondGame->snapshot()['players'][$actor->id()]['zones']['battlefield'];
        self::assertNotSame($cards[0]['position'], $cards[1]['position']);
    }

    public function testRuntimeOffUniformStatePositionStaleAndLimitsAreAtomic(): void
    {
        $actor = new User('group-state@example.test', 'Owner');
        $before = $this->snapshot($actor->id());
        $game = new Game(new Room($actor), $before);
        $handler = new GameCommandHandler();
        $events = [];
        $events[] = $handler->apply($game, 'card.token.created', [
            'playerId' => $actor->id(), 'quantity' => 3,
            'card' => ['cardKey' => 'token:treasure', 'name' => 'Treasure'],
        ], $actor, 'php-state-create');
        $group = $game->snapshot()['tokenGroups'][0];
        $events[] = $handler->apply($game, 'token.group.state.set', [
            'groupId' => $group['groupId'], 'expectedRevision' => 1, 'tapped' => true,
        ], $actor, 'php-state-tap');
        $events[] = $handler->apply($game, 'token.group.state.set', [
            'groupId' => $group['groupId'], 'expectedRevision' => 2, 'faceDown' => true,
        ], $actor, 'php-state-hide');
        foreach ($events[2]->payload()['instanceStates'] ?? [] as $stateEffect) {
            self::assertSame([$actor->id()], $stateEffect['revealedTo'] ?? null);
        }
        $events[] = $handler->apply($game, 'token.group.position.set', [
            'groupId' => $group['groupId'], 'expectedRevision' => 3,
            'position' => ['x' => .9, 'y' => .1, 'unit' => 'ratio'],
        ], $actor, 'php-state-position');
        $live = $game->snapshot();
        self::assertSame(4, $live['tokenGroups'][0]['revision']);
        foreach ($live['players'][$actor->id()]['zones']['battlefield'] as $card) {
            self::assertTrue($card['tapped']);
            self::assertTrue($card['faceDown']);
            self::assertSame(90, $card['rotation']);
            self::assertSame(['x' => .9, 'y' => .1, 'unit' => 'ratio'], $card['position']);
        }
		$beforeNoOp = $game->snapshot();
		try {
			$handler->apply($game, 'token.group.state.set', [
				'groupId' => $group['groupId'], 'expectedRevision' => 4, 'tapped' => true,
			], $actor, 'php-state-noop');
			self::fail('Uniform state no-op was persisted.');
		} catch (TokenGroupContractException $exception) {
			self::assertSame(TokenGroupCanonicalizer::PATCH_CONFLICT, $exception->errorCode());
		}
		self::assertSame($beforeNoOp, $game->snapshot());
        $replayed = (new GameEventReplayService())->replay($before, $events);
        self::assertSame($live['tokenGroups'], $replayed['tokenGroups']);
        $liveCards = $live['players'][$actor->id()]['zones']['battlefield'];
        $replayedCards = $replayed['players'][$actor->id()]['zones']['battlefield'];
        self::assertSame(array_column($liveCards, 'instanceId'), array_column($replayedCards, 'instanceId'));
        foreach (array_keys($liveCards) as $index) {
            foreach (['cardKey', 'printId', 'cardVersion', 'language', 'position', 'tapped', 'rotation', 'faceDown', 'revealedTo'] as $field) {
                self::assertSame($liveCards[$index][$field] ?? null, $replayedCards[$index][$field] ?? null, $field);
            }
        }

        $beforeStale = $game->snapshot();
        try {
            $handler->apply($game, 'token.group.dissolve', [
                'groupId' => $group['groupId'], 'expectedRevision' => 3,
            ], $actor, 'php-state-stale');
            self::fail('Stale group revision was accepted.');
        } catch (TokenGroupContractException $exception) {
            self::assertSame(TokenGroupCanonicalizer::STALE, $exception->errorCode());
            self::assertArrayNotHasKey('groupId', $exception->errorPayload());
        }
        self::assertSame($beforeStale, $game->snapshot());
    }

    public function testRuntimeOffFinalEffectPayloadStaysBoundedThroughQuantityTwenty(): void
    {
        $factory = new RuntimeOffTokenCreationEffectFactory(new TokenGroupCanonicalizer());
        $sizes = [];
        foreach ([1, 2, 10, 20] as $quantity) {
            $effect = $factory->create(
                'payload-game',
                'payload-action-'.$quantity,
                'p1',
                2,
                $quantity,
                'Treasure',
                ['cardKey' => 'token:treasure', 'name' => 'Treasure', 'typeLine' => 'Token Artifact - Treasure'],
                ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
            );
            $sizes[$quantity] = strlen(json_encode($effect['eventPayload'], JSON_THROW_ON_ERROR));
            self::assertLessThan(65_536, $sizes[$quantity], 'Runtime-off event exceeds the WebSocket payload budget.');
        }

        self::assertLessThan($sizes[10] * 2.5, $sizes[20]);
        self::assertGreaterThan($sizes[2], $sizes[10]);
    }

	public function testRuntimeOffUntapAllUpdatesUniformTokenGroupRevisionOnce(): void
	{
		$actor = new User('group-untap@example.test', 'Owner');
		$before = $this->snapshot($actor->id());
		$game = new Game(new Room($actor), $before);
		$handler = new GameCommandHandler();
		$events = [];
		$events[] = $handler->apply($game, 'card.token.created', [
			'playerId' => $actor->id(), 'quantity' => 3,
			'card' => ['cardKey' => 'token:treasure', 'name' => 'Treasure'],
		], $actor, 'php-untap-create');
		$group = $game->snapshot()['tokenGroups'][0];
		$events[] = $handler->apply($game, 'token.group.state.set', [
			'groupId' => $group['groupId'], 'expectedRevision' => 1, 'tapped' => true,
		], $actor, 'php-untap-tap');
		$events[] = $handler->apply($game, 'battlefield.untap_all', [
			'playerId' => $actor->id(),
		], $actor, 'php-untap-all');
		$live = $game->snapshot();
		self::assertSame(3, $live['tokenGroups'][0]['revision']);
		foreach ($live['players'][$actor->id()]['zones']['battlefield'] as $card) {
			self::assertFalse($card['tapped']);
			self::assertSame(0, $card['rotation']);
		}
		$replayed = (new GameEventReplayService())->replay($before, $events);
		self::assertSame($live['tokenGroups'], $replayed['tokenGroups']);
		$liveCards = $live['players'][$actor->id()]['zones']['battlefield'];
		$replayedCards = $replayed['players'][$actor->id()]['zones']['battlefield'];
		self::assertSame(array_column($liveCards, 'instanceId'), array_column($replayedCards, 'instanceId'));
		foreach (array_keys($liveCards) as $index) {
			foreach (['cardKey', 'printId', 'cardVersion', 'language', 'position', 'tapped', 'rotation', 'faceDown'] as $field) {
				self::assertSame($liveCards[$index][$field] ?? null, $replayedCards[$index][$field] ?? null, $field);
			}
		}
	}

    public function testRuntimeOffPreservesMultiFacePrintedStatsLikeRuntimeGo(): void
    {
        $effect = (new RuntimeOffTokenCreationEffectFactory(new TokenGroupCanonicalizer()))->create(
            'multi-face-game',
            'multi-face-action',
            'p1',
            2,
            2,
            'Daybound Copy',
            [
                'cardKey' => 'token:daybound-copy',
                'cardFaces' => [
                    ['name' => 'Day', 'power' => '2', 'toughness' => '2'],
                    ['name' => 'Night', 'power' => '4', 'toughness' => '4'],
                ],
            ],
            ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
        );

        self::assertSame([
            '0' => ['faceKey' => '0', 'faceIndex' => 0, 'power' => '2', 'toughness' => '2', 'provenance' => 'token_creation'],
            '1' => ['faceKey' => '1', 'faceIndex' => 1, 'power' => '4', 'toughness' => '4', 'provenance' => 'token_creation'],
        ], $effect['tokens'][0]['printedStats']);
        self::assertSame($effect['tokens'][0]['printedStats'], $effect['tokens'][1]['printedStats']);
    }

    /** @return array<string,mixed> */
    private function validGroup(): array
    {
        return [
            'groupId' => 'group-valid',
            'rootInstanceId' => 'token-a',
            'orderedMemberIds' => ['token-a', 'token-b'],
            'revision' => 1,
            'createdByPlayerId' => 'p1',
            'createdAtVersion' => 2,
            'effectVersion' => 1,
        ];
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        return json_decode(
            file_get_contents(dirname(__DIR__).'/Fixtures/token-group-contract-v1.json'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
    }

    /** @return array<string,mixed> */
    private function snapshot(string $playerId): array
    {
        return [
            'version' => 1,
            'ownerId' => $playerId,
            'gamePhase' => 'PLAYING',
            'players' => [
                $playerId => [
                    'user' => ['id' => $playerId, 'displayName' => 'Cross Runtime'],
                    'life' => 40,
                    'status' => 'active',
                    'zones' => [
                        'library' => [], 'hand' => [], 'battlefield' => [],
                        'graveyard' => [], 'exile' => [], 'command' => [],
                    ],
                    'counters' => [],
                    'commanderDamage' => [],
                ],
            ],
            'turn' => ['number' => 1, 'activePlayerId' => $playerId],
            'stack' => [], 'arrows' => [], 'attachments' => [], 'battlefieldStacks' => [], 'tokenGroups' => [],
            'specialEntities' => [], 'counters' => [], 'chat' => [], 'eventLog' => [],
        ];
    }
}
