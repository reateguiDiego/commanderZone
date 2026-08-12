<?php

namespace App\UI\Http;

use App\Application\Game\Lifecycle\GameLifecycleHandoff;
use App\Application\Game\Lifecycle\GameLifecycleProjector;
use App\Application\Game\GameRematchService;
use App\Application\Room\RoomLifecycleMembershipService;
use App\Domain\Game\Game;
use App\Infrastructure\Realtime\GameEventPublisher;
use App\Infrastructure\Realtime\RoomEventPublisher;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

final class InternalGameLifecycleController extends ApiController
{
    #[Route('/internal/runtime/lifecycle', methods: ['POST'])]
    public function __invoke(
        Request $request,
        EntityManagerInterface $entityManager,
        GameLifecycleProjector $projector,
        GameEventPublisher $publisher,
        RoomEventPublisher $roomPublisher,
        GameRematchService $rematch,
        RoomLifecycleMembershipService $roomLifecycle,
        #[Autowire('%game_runtime_ticket_secret%')]
        string $secret,
    ): JsonResponse {
        $body = $request->getContent();
        $signature = trim((string) $request->headers->get('X-CommanderZone-Signature', ''));
        if ($signature === '' || !hash_equals(hash_hmac('sha256', $body, $secret), $signature)) {
            return $this->fail('Invalid runtime lifecycle signature.', 401);
        }

        try {
            $handoff = GameLifecycleHandoff::fromArray($this->payload($request));
        } catch (\InvalidArgumentException $exception) {
            return $this->fail($exception->getMessage(), 422);
        }

        $roomChanged = false;
        $entityManager->beginTransaction();
        try {
            $game = $entityManager->find(Game::class, $handoff->gameId, LockMode::PESSIMISTIC_WRITE);
            if (!$game instanceof Game) {
                $entityManager->rollback();

                return $this->fail('Game not found.', 404);
            }
            // Lifecycle and manual leave both acquire game then room. This
            // serializes expel/leave membership consequences without a
            // distributed gameplay lock.
            $entityManager->lock($game->room(), LockMode::PESSIMISTIC_WRITE);
            $result = $projector->apply($game, $handoff);
            if ($result === GameLifecycleProjector::APPLIED && $this->isAutomaticLeave($handoff)) {
                $playerId = (string) $handoff->playerId;
                $room = $game->room();
                foreach ($room->players() as $roomPlayer) {
                    if ($roomPlayer->user()->id() !== $playerId) {
                        continue;
                    }
                    $expelledPlayer = $roomPlayer->user();
                    if (($game->rematchState()['votes'][$expelledPlayer->id()]['vote'] ?? null) !== GameRematchService::VOTE_LEAVE) {
                        // Record while the user is still a RoomPlayer: the
                        // vote is a control-plane fact that accompanies the
                        // automatic leave, never a gameplay event.
                        $rematch->recordVote($game, $expelledPlayer, GameRematchService::VOTE_LEAVE);
                    }
                    $roomLifecycle->removeExpelledPlayer($game, $playerId);
                    $roomChanged = true;
                    break;
                }
                // Never delete from a handoff while its actor may still be
                // returning from the command that produced it. The indexed
                // sweeper owns stop-confirmed deletion ordering.
            }
            $entityManager->flush();
            $entityManager->commit();
        } catch (\Throwable $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }
            throw $exception;
        }

        if ($result === GameLifecycleProjector::APPLIED) {
            $publisher->publishControlPlane($game, [
                'id' => $handoff->eventId,
                'type' => $handoff->type,
                'payload' => array_filter([
                    'playerId' => $handoff->playerId,
                    'playerReason' => $handoff->playerReason,
                    'winnerPlayerId' => $handoff->winnerPlayerId,
                    'finishReason' => $handoff->finishReason,
                    'occurredAt' => $handoff->occurredAt->format(DATE_ATOM),
                ], static fn (mixed $value): bool => $value !== null && $value !== ''),
                'version' => $handoff->version,
                'clientActionId' => $handoff->clientActionId,
                'createdBy' => null,
                'createdAt' => $handoff->occurredAt->format(DATE_ATOM),
            ]);
        }
        if ($roomChanged) {
            $roomPublisher->publish($game->room(), 'room.player.left');
        }

        return $this->json([
            'result' => $result,
            'game' => [
                'id' => $game->id(),
                'status' => $game->status(),
                'winnerPlayerId' => $game->winnerPlayerId(),
                'finishedAt' => $game->finishedAt()?->format(DATE_ATOM),
                'finishReason' => $game->finishReason(),
                'nextLifecycleAt' => $game->nextLifecycleAt()?->format(DATE_ATOM),
                'controlPlaneRevision' => $game->controlPlaneRevision(),
            ],
        ]);
    }

    private function isAutomaticLeave(GameLifecycleHandoff $handoff): bool
    {
        return $handoff->type === GameLifecycleHandoff::PLAYER_EXPELLED
            || ($handoff->type === GameLifecycleHandoff::GAME_FINISHED && $handoff->playerReason === 'expelled' && $handoff->playerId !== null);
    }
}
