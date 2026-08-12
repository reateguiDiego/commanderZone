<?php

namespace App\Application\Game;

use App\Application\Game\Runtime\GameRuntimeLifecycleControlClient;
use App\Application\Game\Runtime\GameRuntimeClosingFence;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Processes only indexed, due lifecycle rows. It owns no timer and never reads
 * game_event history; gameplay stays entirely outside this control-plane loop.
 */
final readonly class GameRematchLifecycleSweeper
{
    public function __construct(
        private EntityManagerInterface $entityManager,
        private GameRematchService $rematch,
        private GameRuntimeLifecycleControlClient $runtimeControl,
        private GameRuntimeClosingFence $closingFence,
    ) {
    }

    /** @return list<array{type:string, game:Game, roomId:string}> */
    public function sweep(\DateTimeImmutable $now, int $limit = 100): array
    {
        $ids = $this->entityManager->createQueryBuilder()
            ->select('game.id')
            ->from(Game::class, 'game')
            ->where('game.nextLifecycleAt IS NOT NULL')
            ->andWhere('game.nextLifecycleAt <= :now')
            ->setParameter('now', $now)
            ->orderBy('game.nextLifecycleAt', 'ASC')
            ->setMaxResults(max(1, $limit))
            ->getQuery()
            ->getSingleColumnResult();

        $results = [];
        foreach ($ids as $id) {
            if (!is_string($id)) {
                continue;
            }
            $result = $this->sweepGame($id, $now);
            if ($result !== null) {
                $results[] = $result;
            }
        }

        return $results;
    }

    /** @return array{type:string, game:Game, roomId:string}|null */
    private function sweepGame(string $gameId, \DateTimeImmutable $now): ?array
    {
        $runtimeStopRequired = false;
        $this->entityManager->beginTransaction();
        try {
            $game = $this->entityManager->find(Game::class, $gameId, LockMode::PESSIMISTIC_WRITE);
            if (!$game instanceof Game || $game->nextLifecycleAt() === null || $game->nextLifecycleAt() > $now) {
                $this->entityManager->commit();
                return null;
            }
            $room = $game->room();
            $this->entityManager->lock($room, LockMode::PESSIMISTIC_WRITE);
            if ($game->status() !== Game::STATUS_FINISHED) {
                if ($game->allDisconnectedSince() === null) {
                    $this->entityManager->commit();
                    return null;
                }

                // Commit the durable fence before any delete. Go checks it in
                // both lease and persistence SQL, so no runtime can append
                // while the subsequent post-commit stop is routed.
                $roomId = $room->id();
                $this->closingFence->claim($gameId);
                $runtimeStopRequired = true;
                $room->detachGame();
                $this->entityManager->remove($game);
                $this->entityManager->remove($room);
                $this->entityManager->flush();
                $this->entityManager->commit();
                if ($runtimeStopRequired) {
                    $this->runtimeControl->stop($game);
                }

                return ['type' => 'room_deleted', 'game' => $game, 'roomId' => $roomId];
            }

            foreach ($room->players()->toArray() as $player) {
                if (!$player instanceof RoomPlayer) {
                    continue;
                }
                $vote = $game->rematchState()['votes'][$player->user()->id()]['vote'] ?? null;
                if ($vote === null) {
                    $this->rematch->recordVote($game, $player->user(), GameRematchService::VOTE_LEAVE);
                    $room->removeUser($player->user());
                }
            }

            $roomId = $room->id();
            $eligible = $this->rematch->eligiblePlayAgainPlayerIds($room, $game);
            $this->closingFence->claim($gameId);
            $runtimeStopRequired = true;
            if (count($eligible) >= Room::MIN_PLAYERS && $this->rematch->allRemainingRoomPlayersHaveVoted($room, $game)) {
                $room->returnToWaitingForRematch($this->rematch->rematchOwner($room, $eligible), $eligible);
                $this->entityManager->remove($game);
                $type = 'room_ready';
            } else {
                $room->detachGame();
                $this->entityManager->remove($game);
                $this->entityManager->remove($room);
                $type = 'room_deleted';
            }
            $this->entityManager->flush();
            $this->entityManager->commit();
            if ($runtimeStopRequired) {
                $this->runtimeControl->stop($game);
            }

            return ['type' => $type, 'game' => $game, 'roomId' => $roomId];
        } catch (\Throwable $exception) {
            if ($this->entityManager->getConnection()->isTransactionActive()) {
                $this->entityManager->rollback();
            }
            throw $exception;
        }
    }
}
