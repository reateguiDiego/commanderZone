<?php

namespace App\Tests\Application;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameDisconnectVoteService;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameDisconnectVoteServiceTest extends TestCase
{
    public function testOpenVoteWhenTargetIsOfflineAndEligible(): void
    {
        [$game, $owner, $target, $voter] = $this->gameWithThreePlayers();
        $service = new GameDisconnectVoteService(new GameCommandHandler());
        $now = new \DateTimeImmutable('2026-01-01T00:00:00+00:00');

        $recorded = $service->openVoteIfEligible($game, $target->id(), [$owner->id(), $voter->id()], $now);

        self::assertNotNull($recorded);
        self::assertSame(GameDisconnectVoteService::EVENT_TYPE, $recorded['event']->toArray()['type']);
        self::assertSame(GameDisconnectVoteService::STATUS_OPEN, $recorded['snapshot']['disconnectVote']['status']);
        self::assertSame($target->id(), $recorded['snapshot']['disconnectVote']['targetPlayerId']);
        self::assertSame('2026-01-01T00:01:00+00:00', $recorded['snapshot']['disconnectVote']['deadlineAt']);
    }

    public function testRecordVoteExpelsTargetOnSimpleMajority(): void
    {
        [$game, $owner, $target, $voter] = $this->gameWithThreePlayers();
        $service = new GameDisconnectVoteService(new GameCommandHandler());
        $openAt = new \DateTimeImmutable('2026-01-01T00:00:00+00:00');
        $service->openVoteIfEligible($game, $target->id(), [$owner->id(), $voter->id()], $openAt);

        $recorded = $service->recordVote(
            $game,
            $owner,
            $target->id(),
            GameDisconnectVoteService::VOTE_EXPEL,
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:00:10+00:00'),
        );
        $recorded = $service->recordVote(
            $game,
            $voter,
            $target->id(),
            GameDisconnectVoteService::VOTE_EXPEL,
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:00:11+00:00'),
        );

        self::assertSame(GameDisconnectVoteService::STATUS_RESOLVED_EXPEL, $recorded['snapshot']['disconnectVote']['status']);
        self::assertSame('conceded', $recorded['snapshot']['players'][$target->id()]['status']);
        self::assertFalse($game->room()->hasPlayer($target));
    }

    public function testRecordVoteExpelsTargetAndReassignsMonarchWhenTargetWasMonarch(): void
    {
        [$game, $owner, $target, $voter] = $this->gameWithThreePlayers();
        $snapshot = $game->snapshot();
        $snapshot['specialEntities'] = [[
            'id' => 'monarch-1',
            'template' => 'monarch',
            'scope' => 'global',
            'ownerPlayerId' => $target->id(),
            'card' => null,
            'state' => [],
            'createdAt' => '2026-06-16T00:00:00+00:00',
        ]];
        $game->replaceSnapshot($snapshot);
        $service = new GameDisconnectVoteService(new GameCommandHandler());
        $openAt = new \DateTimeImmutable('2026-01-01T00:00:00+00:00');
        $service->openVoteIfEligible($game, $target->id(), [$owner->id(), $voter->id()], $openAt);

        $service->recordVote(
            $game,
            $owner,
            $target->id(),
            GameDisconnectVoteService::VOTE_EXPEL,
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:00:10+00:00'),
        );
        $recorded = $service->recordVote(
            $game,
            $voter,
            $target->id(),
            GameDisconnectVoteService::VOTE_EXPEL,
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:00:11+00:00'),
        );

        self::assertSame($owner->id(), $recorded['snapshot']['specialEntities'][0]['ownerPlayerId']);
    }

    public function testResolveOnTimeoutDefaultsToWaitAndStartsCooldown(): void
    {
        [$game, $owner, $target, $voter] = $this->gameWithThreePlayers();
        $service = new GameDisconnectVoteService(new GameCommandHandler());
        $service->openVoteIfEligible(
            $game,
            $target->id(),
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:00:00+00:00'),
        );

        $resolved = $service->resolveOnTimeout(
            $game,
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:01:01+00:00'),
        );

        self::assertNotNull($resolved);
        self::assertSame(GameDisconnectVoteService::STATUS_RESOLVED_WAIT, $resolved['snapshot']['disconnectVote']['status']);
        self::assertSame('2026-01-01T00:06:01+00:00', $resolved['snapshot']['disconnectVote']['cooldownUntil']);
    }

    public function testCancelOnReconnectClosesOpenVote(): void
    {
        [$game, $owner, $target, $voter] = $this->gameWithThreePlayers();
        $service = new GameDisconnectVoteService(new GameCommandHandler());
        $service->openVoteIfEligible(
            $game,
            $target->id(),
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:00:00+00:00'),
        );

        $cancelled = $service->cancelOnReconnect(
            $game,
            $target->id(),
            new \DateTimeImmutable('2026-01-01T00:00:20+00:00'),
        );

        self::assertNotNull($cancelled);
        self::assertSame(GameDisconnectVoteService::STATUS_CANCELLED, $cancelled['snapshot']['disconnectVote']['status']);
        self::assertNull($cancelled['snapshot']['disconnectVote']['deadlineAt']);
    }

    public function testCooldownBlocksImmediateReopenAndAllowsReopenAfterFiveMinutes(): void
    {
        [$game, $owner, $target, $voter] = $this->gameWithThreePlayers();
        $service = new GameDisconnectVoteService(new GameCommandHandler());

        $service->openVoteIfEligible(
            $game,
            $target->id(),
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:00:00+00:00'),
        );
        $service->resolveOnTimeout(
            $game,
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:01:00+00:00'),
        );

        $blocked = $service->openVoteIfEligible(
            $game,
            $target->id(),
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:05:00+00:00'),
        );
        self::assertNull($blocked);

        $reopened = $service->openVoteIfEligible(
            $game,
            $target->id(),
            [$owner->id(), $voter->id()],
            new \DateTimeImmutable('2026-01-01T00:06:01+00:00'),
        );
        self::assertNotNull($reopened);
        self::assertSame(GameDisconnectVoteService::STATUS_OPEN, $reopened['snapshot']['disconnectVote']['status']);
    }

    /**
     * @return array{Game, User, User, User}
     */
    private function gameWithThreePlayers(): array
    {
        $owner = new User('owner@example.test', 'Owner');
        $target = new User('target@example.test', 'Target');
        $voter = new User('voter@example.test', 'Voter');
        $room = new Room($owner);
        $room->addPlayer(new RoomPlayer($room, $owner));
        $room->addPlayer(new RoomPlayer($room, $target));
        $room->addPlayer(new RoomPlayer($room, $voter));

        $snapshot = [
            'version' => 1,
            'ownerId' => $owner->id(),
            'players' => [
                $owner->id() => $this->player($owner),
                $target->id() => $this->player($target),
                $voter->id() => $this->player($voter),
            ],
            'turn' => ['activePlayerId' => $owner->id(), 'phase' => 'main-1', 'number' => 1],
            'timer' => ['mode' => 'none', 'status' => 'idle', 'durationSeconds' => null, 'remainingSeconds' => null],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
            'updatedAt' => '2026-01-01T00:00:00+00:00',
        ];

        return [new Game($room, $snapshot), $owner, $target, $voter];
    }

    /**
     * @return array<string,mixed>
     */
    private function player(User $user): array
    {
        return [
            'user' => $user->toArray(),
            'status' => 'active',
            'concededAt' => null,
            'life' => 40,
            'zones' => [
                'library' => [],
                'hand' => [],
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ],
            'zoneCounts' => [
                'library' => 0,
                'hand' => 0,
                'battlefield' => 0,
                'graveyard' => 0,
                'exile' => 0,
                'command' => 0,
            ],
            'commanderDamage' => [],
            'counters' => [],
            'backgroundName' => 'G_3',
            'sleevesName' => 'default',
        ];
    }
}
