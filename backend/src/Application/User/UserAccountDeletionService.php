<?php

namespace App\Application\User;

use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameRematchService;
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
        private readonly GameCommandHandler $gameCommandHandler,
        private readonly GameRematchService $gameRematch,
    ) {
    }

    public function delete(User $user, EntityManagerInterface $entityManager): UserAccountDeletionResult
    {
        $gameEvents = [];
        $changedRooms = [];
        $deletedRoomIds = [];

        try {
            $entityManager->beginTransaction();

            foreach ($this->roomsForUser($user, $entityManager) as $room) {
                $roomResult = $this->removeUserFromRoom($room, $user, $entityManager);
                $gameEvents = [...$gameEvents, ...$roomResult->gameEvents];
                $changedRooms = [...$changedRooms, ...$roomResult->changedRooms];
                $deletedRoomIds = [...$deletedRoomIds, ...$roomResult->deletedRoomIds];
            }
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

        return new UserAccountDeletionResult(
            $this->uniqueGameEvents($gameEvents),
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

    private function removeUserFromRoom(Room $room, User $user, EntityManagerInterface $entityManager): UserAccountDeletionResult
    {
        $gameEvents = [];
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

            return new UserAccountDeletionResult([], [], $deletedRoomIds);
        }

        if ($isRoomPlayer && $startedRoom && $game instanceof Game && $hasOtherRoomPlayers && $this->gameHasSnapshotPlayer($game, $user)) {
            if ($this->gameCanConcedeLeavingPlayer($game, $user)) {
                $gameConcedeEvent = $this->gameCommandHandler->apply($game, 'game.concede', [], $user);
                $entityManager->persist($gameConcedeEvent);
                $gameEvents[] = ['game' => $game, 'event' => $gameConcedeEvent];
            }

            if ($this->gameCanRecordLeaveVote($game, $user)) {
                $recorded = $this->gameRematch->recordVote($game, $user, GameRematchService::VOTE_LEAVE);
                $entityManager->persist($recorded['event']);
                $gameEvents[] = ['game' => $game, 'event' => $recorded['event']];
            }
        }

        if ($isRoomPlayer) {
            $room->removeUser($user);
        }

        if (!$hasOtherRoomPlayers) {
            $deletedRoomIds[] = $room->id();
            $this->removeRoomWithGame($room, $entityManager);

            return new UserAccountDeletionResult($gameEvents, [], $deletedRoomIds);
        }

        if ($isRoomOwner) {
            $newOwner = $this->firstOtherRoomPlayerUser($room, $user, $entityManager);
            if ($newOwner instanceof User) {
                $room->transferOwnership($newOwner);
            }
        }

        $room->appendWaitingLog(sprintf('%s left the room.', $this->userDisplayName($user)));
        $changedRooms[] = $room;

        return new UserAccountDeletionResult($gameEvents, $changedRooms, $deletedRoomIds);
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

        return is_array($player) && ($player['status'] ?? 'active') !== 'conceded';
    }

    private function gameCanRecordLeaveVote(Game $game, User $user): bool
    {
        $player = $game->snapshot()['players'][$user->id()] ?? null;
        if (!is_array($player)) {
            return false;
        }

        $vote = $game->snapshot()['rematch']['votes'][$user->id()]['vote'] ?? null;

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
