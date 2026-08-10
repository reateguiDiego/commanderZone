<?php

namespace App\Application\User;

use App\Application\Game\GameRematchService;
use App\Application\Game\Runtime\GameRuntimeGatewayException;
use App\Application\Game\Runtime\GameRuntimeLifecycleCommandService;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckFolder;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomInvite;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;

class UserAccountDeletionService
{
    public function __construct(
        private readonly GameRematchService $gameRematch,
        private readonly GameRuntimeLifecycleCommandService $runtimeLifecycle,
    ) {
    }

    public function delete(User $user, EntityManagerInterface $entityManager): UserAccountDeletionResult
    {
        $rooms = $this->roomsForUser($user, $entityManager);
        $this->concedeRuntimeGamesBeforeRemoval($rooms, $user, $entityManager);

        try {
            $entityManager->beginTransaction();

            $roomRemovalResult = $this->removeFromRoomsInOpenTransaction($rooms, $user, $entityManager);
            $entityManager->flush();

            $this->deleteOwnedDecks($user, $entityManager);
            $this->deleteOwnedDeckFolders($user, $entityManager);
            $this->clearGameEventCreators($user, $entityManager);

            $user->markOffline();
            $entityManager->remove($user);
            $entityManager->flush();
            $entityManager->commit();
        } catch (\Throwable $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            throw $exception;
        }

        return $roomRemovalResult;
    }

    public function removeFromRooms(User $user, EntityManagerInterface $entityManager): UserAccountDeletionResult
    {
        $rooms = $this->roomsForUser($user, $entityManager);
        $this->concedeRuntimeGamesBeforeRemoval($rooms, $user, $entityManager);

        try {
            $entityManager->beginTransaction();
            $result = $this->removeFromRoomsInOpenTransaction($rooms, $user, $entityManager);
            $entityManager->flush();
            $entityManager->commit();
        } catch (\Throwable $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            throw $exception;
        }

        return $result;
    }

    /**
     * @param list<Room> $rooms
     */
    private function removeFromRoomsInOpenTransaction(array $rooms, User $user, EntityManagerInterface $entityManager): UserAccountDeletionResult
    {
        $gameEvents = [];
        $controlPlaneEvents = [];
        $changedRooms = [];
        $deletedRoomIds = [];

        foreach ($rooms as $room) {
            $roomResult = $this->removeUserFromRoom($room, $user, $entityManager);
            $gameEvents = [...$gameEvents, ...$roomResult->gameEvents];
            $controlPlaneEvents = [...$controlPlaneEvents, ...$roomResult->controlPlaneEvents];
            $changedRooms = [...$changedRooms, ...$roomResult->changedRooms];
            $deletedRoomIds = [...$deletedRoomIds, ...$roomResult->deletedRoomIds];
        }

        return new UserAccountDeletionResult(
            $this->uniqueGameEvents($gameEvents),
            $this->uniqueControlPlaneEvents($controlPlaneEvents),
            $this->uniqueRooms($changedRooms),
            array_values(array_unique($deletedRoomIds)),
        );
    }

    /**
     * @return list<Room>
     */
    private function roomsForUser(User $user, EntityManagerInterface $entityManager): array
    {
        $rooms = $entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->leftJoin('room.players', 'player')
            ->where('room.owner = :user')
            ->orWhere('player.user = :user')
            ->setParameter('user', $user)
            ->getQuery()
            ->getResult();

        return array_values(array_filter($rooms, static fn (mixed $room): bool => $room instanceof Room));
    }

    /**
     * @param list<Room> $rooms
     */
    private function concedeRuntimeGamesBeforeRemoval(array $rooms, User $user, EntityManagerInterface $entityManager): void
    {
        foreach ($rooms as $room) {
            $game = $room->game();
            $startedRoom = $room->status() === Room::STATUS_STARTED || $game instanceof Game;
            if (
                !$room->hasPlayer($user)
                || !$startedRoom
                || !$game instanceof Game
                || !$this->roomHasOtherPlayers($room, $user, $entityManager)
                || !$this->gameHasSnapshotPlayer($game, $user)
                || !$this->gameCanConcedeLeavingPlayer($game, $user)
            ) {
                continue;
            }

            if (!$this->runtimeLifecycle->isRuntimePrimary('game.concede')) {
                throw new GameRuntimeGatewayException('The gameplay runtime is required to concede an active player before leaving.');
            }

            // Keep the Go write outside the account-deletion transaction and
            // game-row lock. A repeated deletion request reuses the action id.
            $this->runtimeLifecycle->concedeForLeave($game, $user, 'account_deletion');
        }
    }

    private function removeUserFromRoom(Room $room, User $user, EntityManagerInterface $entityManager): UserAccountDeletionResult
    {
        $gameEvents = [];
        $controlPlaneEvents = [];
        $changedRooms = [];
        $deletedRoomIds = [];

        $game = $room->game();
        if ($game instanceof Game) {
            $entityManager->lock($game, LockMode::PESSIMISTIC_WRITE);
        }

        $startedRoom = $room->status() === Room::STATUS_STARTED || $game instanceof Game;
        $isRoomOwner = $room->owner()->id() === $user->id();
        $isRoomPlayer = $room->hasPlayer($user);
        $hasOtherRoomPlayers = $this->roomHasOtherPlayers($room, $user, $entityManager);

        if ($isRoomOwner && !$startedRoom) {
            $deletedRoomIds[] = $room->id();
            $this->removeRoomWithGame($room, $entityManager);

            return new UserAccountDeletionResult([], [], [], $deletedRoomIds);
        }

        if ($isRoomPlayer && $startedRoom && $game instanceof Game && $hasOtherRoomPlayers && $this->gameHasSnapshotPlayer($game, $user)) {
            if ($this->gameCanRecordLeaveVote($game, $user)) {
                $recorded = $this->gameRematch->recordVote($game, $user, GameRematchService::VOTE_LEAVE);
                $controlPlaneEvents[] = ['game' => $game, 'event' => $recorded['event']];
            }
        }

        if ($isRoomPlayer) {
            $room->removeUser($user);
        }

        if (!$hasOtherRoomPlayers) {
            $deletedRoomIds[] = $room->id();
            $this->removeRoomWithGame($room, $entityManager);

            return new UserAccountDeletionResult($gameEvents, $controlPlaneEvents, [], $deletedRoomIds);
        }

        if ($isRoomOwner) {
            $newOwner = $this->firstOtherRoomPlayerUser($room, $user, $entityManager);
            if ($newOwner instanceof User) {
                $room->transferOwnership($newOwner);
            }
        }

        $room->appendWaitingLog(sprintf('%s left the room.', $this->userDisplayName($user)));
        $changedRooms[] = $room;

        return new UserAccountDeletionResult($gameEvents, $controlPlaneEvents, $changedRooms, $deletedRoomIds);
    }

    private function deleteOwnedDecks(User $user, EntityManagerInterface $entityManager): void
    {
        foreach ($entityManager->getRepository(Deck::class)->findBy(['owner' => $user]) as $deck) {
            if ($deck instanceof Deck) {
                $entityManager->remove($deck);
            }
        }
        $entityManager->flush();
    }

    private function deleteOwnedDeckFolders(User $user, EntityManagerInterface $entityManager): void
    {
        foreach ($entityManager->getRepository(DeckFolder::class)->findBy(['owner' => $user]) as $folder) {
            if ($folder instanceof DeckFolder) {
                $entityManager->remove($folder);
            }
        }
        $entityManager->flush();
    }

    private function clearGameEventCreators(User $user, EntityManagerInterface $entityManager): void
    {
        $entityManager->createQueryBuilder()
            ->update(GameEvent::class, 'event')
            ->set('event.createdBy', ':null')
            ->where('event.createdBy = :user')
            ->setParameter('null', null)
            ->setParameter('user', $user)
            ->getQuery()
            ->execute();
    }

    private function removeRoomWithGame(Room $room, EntityManagerInterface $entityManager): void
    {
        foreach ($entityManager->getRepository(RoomInvite::class)->findBy(['room' => $room]) as $invite) {
            if ($invite instanceof RoomInvite) {
                $entityManager->remove($invite);
            }
        }

        $game = $room->game();
        if ($game instanceof Game) {
            $room->detachGame();
            $entityManager->flush();
            $entityManager->remove($game);
            $entityManager->flush();
        }

        $entityManager->remove($room);
    }

    private function gameCanConcedeLeavingPlayer(Game $game, User $user): bool
    {
        if ($game->status() !== Game::STATUS_ACTIVE) {
            return false;
        }

        $player = $game->snapshot()['players'][$user->id()] ?? null;

        $lifecyclePlayer = $game->lifecycleState()['players'][$user->id()] ?? null;
        if (is_array($lifecyclePlayer) && ($lifecyclePlayer['status'] ?? null) === 'conceded') {
            return false;
        }

        return is_array($player) && ($player['status'] ?? null) === 'active';
    }

    private function gameCanRecordLeaveVote(Game $game, User $user): bool
    {
        $player = $game->snapshot()['players'][$user->id()] ?? null;
        if (!is_array($player)) {
            return false;
        }

        $vote = $game->rematchState()['votes'][$user->id()]['vote'] ?? null;

        return $vote !== GameRematchService::VOTE_LEAVE;
    }

    private function gameHasSnapshotPlayer(Game $game, User $user): bool
    {
        return is_array($game->snapshot()['players'][$user->id()] ?? null);
    }

    private function roomHasOtherPlayers(Room $room, User $user, EntityManagerInterface $entityManager): bool
    {
        return $this->firstOtherRoomPlayerUser($room, $user, $entityManager) instanceof User;
    }

    private function firstOtherRoomPlayerUser(Room $room, User $user, EntityManagerInterface $entityManager): ?User
    {
        $player = $entityManager->getRepository(RoomPlayer::class)->createQueryBuilder('player')
            ->where('player.room = :room')
            ->andWhere('player.user != :user')
            ->setParameter('room', $room)
            ->setParameter('user', $user)
            ->orderBy('player.joinedAt', 'ASC')
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult();

        return $player instanceof RoomPlayer ? $player->user() : null;
    }

    private function userDisplayName(User $user): string
    {
        $name = trim($user->displayName());

        return $name !== '' ? $name : 'A player';
    }

    /**
     * @param list<array{game: Game, event: GameEvent}> $gameEvents
     *
     * @return list<array{game: Game, event: GameEvent}>
     */
    private function uniqueGameEvents(array $gameEvents): array
    {
        $unique = [];
        foreach ($gameEvents as $entry) {
            $unique[$entry['event']->toArray()['id']] = $entry;
        }

        return array_values($unique);
    }

    /**
     * @param list<array{game: Game, event: array<string,mixed>}> $events
     * @return list<array{game: Game, event: array<string,mixed>}>
     */
    private function uniqueControlPlaneEvents(array $events): array
    {
        $unique = [];
        foreach ($events as $entry) {
            $eventId = is_string($entry['event']['id'] ?? null) ? $entry['event']['id'] : null;
            if ($eventId !== null) {
                $unique[$eventId] = $entry;
            }
        }

        return array_values($unique);
    }

    /**
     * @param list<Room> $rooms
     *
     * @return list<Room>
     */
    private function uniqueRooms(array $rooms): array
    {
        $unique = [];
        foreach ($rooms as $room) {
            $unique[$room->id()] = $room;
        }

        return array_values($unique);
    }
}
