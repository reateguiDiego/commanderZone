<?php

namespace App\Application\Moderation;

use App\Domain\Game\Game;

/**
 * Turns a would-be terminal game deletion into a private, archived evidence
 * source. Callers remain responsible for runtime shutdown before invoking it.
 */
final readonly class GameModerationRetentionService
{
    public function __construct(private GameModerationEvidenceQueueInterface $queue)
    {
    }

    /**
     * @return bool true when normal game/room disposal must be skipped
     */
    public function retainForEvidenceIfRequired(Game $game): bool
    {
        if (!$game->requiresModerationReview()) {
            return false;
        }

        $game->holdForModerationEvidence();
        $game->room()->archiveForModerationEvidence();
        $this->queue->enqueue($game->id());

        return true;
    }
}
