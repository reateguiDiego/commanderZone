<?php

namespace App\Application\Game;

use App\Application\Game\Runtime\GameRuntimeClosingFence;
use App\Application\Game\Runtime\GameRuntimeStopQueue;
use App\Application\Game\Lifecycle\AllDisconnectedGracePolicy;
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
        private GameRuntimeClosingFence $closingFence,
        private GameRuntimeStopQueue $runtimeStopQueue,
        private AllDisconnectedGracePolicy $allDisconnectedGrace,
    ) {
    }

    /** @return list<array{type:string, game:Game, roomId:string}> */
    public function sweep(\DateTimeImmutable $now, int $limit = 100): array
    {
        $results = [];
        for ($index = 0; $index < max(1, $limit); ++$index) {
            $result = $this->sweepNextDueGame($now);
            if ($result === null) {
                break;
            }
            $results[] = $result;
        }

        return $results;
    }

    /** @return array{type:string, game:Game, roomId:string}|null */
    private function sweepNextDueGame(\DateTimeImmutable $now): ?array
    {
        $this->entityManager->beginTransaction();
        try {
            // The due index is the lifecycle queue. Locking its next item
            // makes independent workers cooperative without a central timer.
            $gameId = $this->entityManager->getConnection()->fetchOne(<<<'SQL'
SELECT id
FROM game
WHERE next_lifecycle_at IS NOT NULL
  AND next_lifecycle_at <= :now
ORDER BY next_lifecycle_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
SQL, ['now' => $now->format('Y-m-d H:i:s')]);
            if (!is_string($gameId)) {
                $this->entityManager->commit();
                return null;
            }

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

                if ($game->allDisconnectedHibernateRequestedAt() === null) {
                    $expiresAt = $this->allDisconnectedGrace->expiresAt($game->allDisconnectedSince());
                    if ($expiresAt > $now && $game->scheduleAllDisconnectedHibernation($now, $expiresAt)) {
                        $this->runtimeStopQueue->enqueueHibernate($gameId);
                        $this->entityManager->flush();
                        $this->entityManager->commit();
                        $this->entityManager->clear();

                        return ['type' => 'runtime_hibernation_scheduled', 'game' => $game, 'roomId' => $room->id()];
                    }
                }

                // Commit the durable fence before any delete. Go checks it in
                // both lease and persistence SQL, so no runtime can append
                // while the subsequent post-commit stop is routed.
                $roomId = $room->id();
                $this->closingFence->claim($gameId);
                $this->runtimeStopQueue->enqueueStop($gameId);
                $this->deleteRuntimeArtifacts($gameId);
                $room->detachGame();
                // Room owns the nullable game FK. Persist the detach before
                // scheduling the game removal, otherwise Doctrine may issue
                // DELETE game before UPDATE room.game_id = NULL.
                $this->entityManager->flush();
                $this->entityManager->remove($game);
                $this->entityManager->remove($room);
                $this->entityManager->flush();
                $this->entityManager->commit();
                $this->entityManager->clear();

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
            $this->runtimeStopQueue->enqueueStop($gameId);
            $this->deleteRuntimeArtifacts($gameId);
            if (count($eligible) >= Room::MIN_PLAYERS && $this->rematch->allRemainingRoomPlayersHaveVoted($room, $game)) {
                $room->returnToWaitingForRematch($this->rematch->rematchOwner($room, $eligible), $eligible);
                // See the deletion branch above: Room is the owning side of
                // the one-to-one game relation and must be flushed first.
                $this->entityManager->flush();
                $this->entityManager->remove($game);
                $type = 'room_ready';
            } else {
                $room->detachGame();
                // See the deletion branch above.
                $this->entityManager->flush();
                $this->entityManager->remove($game);
                $this->entityManager->remove($room);
                $type = 'room_deleted';
            }
            $this->entityManager->flush();
            $this->entityManager->commit();
            $this->entityManager->clear();

            return ['type' => $type, 'game' => $game, 'roomId' => $roomId];
        } catch (\Throwable $exception) {
            if ($this->entityManager->getConnection()->isTransactionActive()) {
                $this->entityManager->rollback();
            }
            throw $exception;
        }
    }

    /**
     * Game events are removed through the Game aggregate, but compact runtime
     * snapshots are intentionally not part of that aggregate. Delete them in
     * the same transaction as the terminal lifecycle transition so an expired
     * game never leaves a recoverable runtime snapshot behind.
     */
    private function deleteRuntimeArtifacts(string $gameId): void
    {
        $this->entityManager->getConnection()->executeStatement(
            'DELETE FROM game_snapshot_compact WHERE game_id = :gameId',
            ['gameId' => $gameId],
        );
    }
}
