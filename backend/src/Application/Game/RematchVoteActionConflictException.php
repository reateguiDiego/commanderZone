<?php

namespace App\Application\Game;

/**
 * The client attempted to replace a rematch vote from an obsolete control
 * plane state. Callers must apply the returned control-plane projection and
 * never retry this action automatically.
 */
final class RematchVoteActionConflictException extends \RuntimeException
{
}
