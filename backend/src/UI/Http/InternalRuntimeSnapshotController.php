<?php

namespace App\UI\Http;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\GameEventStoreV2;
use App\Domain\Game\Game;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Supplies a compact, authoritative recovery point to the Go runtime.
 *
 * This is deliberately an internal, HMAC-authenticated endpoint. It is not
 * used in normal gameplay: the runtime calls it only after a locally stored
 * compact snapshot fails checksum validation.
 */
final class InternalRuntimeSnapshotController extends ApiController
{
    #[Route('/internal/runtime/games/{id}/compact-snapshot', methods: ['GET'])]
    public function __invoke(
        string $id,
        Request $request,
        EntityManagerInterface $entityManager,
        CompactGameCardStateMapper $compactStateMapper,
        #[Autowire('%game_runtime_ticket_secret%')]
        string $secret,
        ?GameplayV2Flags $flagsV2 = null,
        ?GameEventStoreV2 $eventStoreV2 = null,
    ): JsonResponse {
        $signature = trim((string) $request->headers->get('X-CommanderZone-Signature', ''));
        $signedRequest = sprintf("%s\n%s", $request->getMethod(), $request->getPathInfo());
        if ($signature === '' || !hash_equals(hash_hmac('sha256', $signedRequest, $secret), $signature)) {
            return $this->fail('Invalid runtime snapshot signature.', 401);
        }

        $game = $entityManager->getRepository(Game::class)->find($id);
        if (!$game instanceof Game) {
            return $this->fail('Game not found.', 404);
        }
        if (($flagsV2?->eventEnabled() ?? false) && $eventStoreV2?->enabled() === true) {
            // hydrateGame validates the stored compact copy and falls back to
            // the aggregate snapshot plus events if it is no longer valid.
            $eventStoreV2->hydrateGame($game);
        }

        $snapshot = $compactStateMapper->compactSnapshot($game->snapshot(), $game->id(), $game->status());
        // Static card data belongs to Symfony's aggregate, never to the Go
        // runtime recovery cache.
        unset($snapshot['cardCatalog']);
        $payload = json_encode($snapshot, JSON_THROW_ON_ERROR);

        return $this->json([
            'gameId' => $game->id(),
            'version' => max(1, (int) ($snapshot['version'] ?? 1)),
            'snapshot' => $snapshot,
            'checksum' => hash('sha256', $payload),
        ]);
    }
}
