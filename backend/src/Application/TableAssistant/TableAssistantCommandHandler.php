<?php

namespace App\Application\TableAssistant;

use App\Domain\TableAssistant\TableAssistantRoom;
use App\Domain\User\User;

class TableAssistantCommandHandler
{
    public function apply(TableAssistantRoom $assistantRoom, string $type, array $payload, User $actor, ?string $clientActionId): bool
    {
        if ($clientActionId !== null && $assistantRoom->hasAppliedAction($clientActionId)) {
            return false;
        }

        if (!$assistantRoom->room()->hasPlayer($actor)) {
            throw new \InvalidArgumentException('Only room participants can apply actions.');
        }

        $state = $assistantRoom->snapshot();

        match ($type) {
            'life.changed' => $this->applyLifeDelta($state, $payload, $actor),
            'life.set' => $this->applyLifeSet($state, $payload, $actor),
            'commander-damage.changed' => $this->applyCommanderDamage($state, $payload, $actor),
            'turn.passed' => $this->applyPassTurn($state, $actor),
            'turn.reverted' => $this->applyRevertTurn($state, $payload, $actor),
            'phase.passed' => $this->applyPassPhase($state, $actor),
            'timer.started' => $this->applyTimerStarted($state, $payload, $actor),
            'timer.paused' => $this->applyTimerPaused($state, $payload, $actor),
            'timer.resumed' => $this->applyTimerResumed($state, $payload, $actor),
            'timer.reset' => $this->applyTimerReset($state, $actor),
            'player.elimination.changed' => $this->applyElimination($state, $payload, $actor),
            'tracker.changed' => $this->applyTracker($state, $payload, $actor),
            'participant.assigned' => $this->applyParticipantAssigned($state, $payload, $actor),
            default => throw new \InvalidArgumentException('Unsupported table assistant action.'),
        };

        $this->appendActionLog($state, $type, $this->participantIdForUser($state, $actor), $clientActionId);
        $assistantRoom->replaceSnapshot($state, $clientActionId);

        return true;
    }

    private function applyLifeDelta(array &$state, array $payload, User $actor): void
    {
        $playerId = $this->requiredString($payload, 'playerId');
        $delta = $this->requiredInteger($payload, 'delta');
        $this->assertCanEditPlayer($state, $actor, $playerId);
        $this->updatePlayer($state, $playerId, fn (array $player): array => $this->withEliminationFromLife([
            ...$player,
            'life' => (int) $player['life'] + $delta,
        ]));
    }

    private function applyLifeSet(array &$state, array $payload, User $actor): void
    {
        $playerId = $this->requiredString($payload, 'playerId');
        $life = $this->requiredInteger($payload, 'life');
        $this->assertCanEditPlayer($state, $actor, $playerId);
        $this->updatePlayer($state, $playerId, fn (array $player): array => $this->withEliminationFromLife([...$player, 'life' => $life]));
    }

    private function applyCommanderDamage(array &$state, array $payload, User $actor): void
    {
        if (($state['settings']['commanderDamageEnabled'] ?? false) !== true) {
            throw new \InvalidArgumentException('Commander damage is disabled.');
        }

        $targetPlayerId = $this->requiredString($payload, 'targetPlayerId');
        $sourcePlayerId = $this->requiredString($payload, 'sourcePlayerId');
        $delta = $this->requiredInteger($payload, 'delta');
        $this->assertCanEditPlayer($state, $actor, $targetPlayerId);

        if ($targetPlayerId === $sourcePlayerId || !isset($state['commanderDamage'][$targetPlayerId])) {
            throw new \InvalidArgumentException('Invalid commander damage target.');
        }

        $current = (int) ($state['commanderDamage'][$targetPlayerId][$sourcePlayerId] ?? 0);
        $state['commanderDamage'][$targetPlayerId][$sourcePlayerId] = max(0, $current + $delta);
    }

    private function applyPassTurn(array &$state, User $actor): void
    {
        if (!$this->canEditGlobal($state, $actor)) {
            throw new \InvalidArgumentException('Only the host can pass turns in this room.');
        }

        $nextPlayerId = $this->nextActivePlayerId($state);
        if ($nextPlayerId === null) {
            throw new \InvalidArgumentException('No players available.');
        }

        $state['turn']['activePlayerId'] = $nextPlayerId;
        $state['turn']['number'] = (int) ($state['turn']['number'] ?? 1) + 1;
        $state['turn']['phaseId'] = ($state['settings']['phasesEnabled'] ?? false) ? TableAssistantStateFactory::PHASES[0] : null;
        $this->resetTimerForBoundary($state);
    }

    private function applyRevertTurn(array &$state, array $payload, User $actor): void
    {
        if (!$this->canEditGlobal($state, $actor)) {
            throw new \InvalidArgumentException('Only the host can revert turns in this room.');
        }

        $activePlayerId = $this->requiredString($payload, 'activePlayerId');
        $turnNumber = $this->requiredInteger($payload, 'number');
        $this->playerIndex($state, $activePlayerId);

        $state['turn']['activePlayerId'] = $activePlayerId;
        $state['turn']['number'] = max(1, $turnNumber);
        $state['turn']['phaseId'] = ($state['settings']['phasesEnabled'] ?? false) ? TableAssistantStateFactory::PHASES[0] : null;
        $this->resetTimerForBoundary($state);
    }

    private function applyPassPhase(array &$state, User $actor): void
    {
        if (!$this->canEditGlobal($state, $actor)) {
            throw new \InvalidArgumentException('Only the host can pass phases in this room.');
        }
        if (($state['settings']['phasesEnabled'] ?? false) !== true || ($state['turn']['phaseId'] ?? null) === null) {
            throw new \InvalidArgumentException('Phases are disabled.');
        }

        $currentIndex = array_search($state['turn']['phaseId'], TableAssistantStateFactory::PHASES, true);
        if ($currentIndex === false) {
            throw new \InvalidArgumentException('Invalid phase.');
        }

        $nextPhase = TableAssistantStateFactory::PHASES[$currentIndex + 1] ?? null;
        if ($nextPhase === null) {
            $this->applyPassTurn($state, $actor);
            return;
        }

        $state['turn']['phaseId'] = $nextPhase;
        $this->resetTimerForBoundary($state);
    }

    private function applyTimerStarted(array &$state, array $payload, User $actor): void
    {
        $this->assertTimerCanChange($state, $actor);
        $durationSeconds = max(1, $this->requiredInteger($payload, 'durationSeconds'));
        $state['timer'] = [
            ...$state['timer'],
            'status' => 'running',
            'durationSeconds' => $durationSeconds,
            'remainingSeconds' => $durationSeconds,
            'startedAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
    }

    private function applyTimerPaused(array &$state, array $payload, User $actor): void
    {
        $this->assertTimerCanChange($state, $actor);
        $state['timer'] = [
            ...$state['timer'],
            'status' => 'paused',
            'remainingSeconds' => max(0, $this->requiredInteger($payload, 'remainingSeconds')),
            'startedAt' => null,
        ];
    }

    private function applyTimerResumed(array &$state, array $payload, User $actor): void
    {
        $this->assertTimerCanChange($state, $actor);
        $state['timer'] = [
            ...$state['timer'],
            'status' => 'running',
            'remainingSeconds' => max(0, $this->requiredInteger($payload, 'remainingSeconds')),
            'startedAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
    }

    private function applyTimerReset(array &$state, User $actor): void
    {
        $this->assertTimerCanChange($state, $actor);
        $this->resetTimerForBoundary($state);
    }

    private function applyElimination(array &$state, array $payload, User $actor): void
    {
        $playerId = $this->requiredString($payload, 'playerId');
        $eliminated = (bool) ($payload['eliminated'] ?? false);
        $this->assertCanEditPlayer($state, $actor, $playerId);
        $this->updatePlayer($state, $playerId, static fn (array $player): array => [...$player, 'eliminated' => $eliminated]);
    }

    private function applyTracker(array &$state, array $payload, User $actor): void
    {
        $trackerId = $this->requiredString($payload, 'trackerId');
        $value = $this->requiredInteger($payload, 'value');
        if (!in_array($trackerId, $state['settings']['activeTrackerIds'] ?? [], true)) {
            throw new \InvalidArgumentException('Tracker is not active.');
        }

        if (in_array($trackerId, TableAssistantStateFactory::PLAYER_TRACKERS, true)) {
            $playerId = $this->requiredString($payload, 'playerId');
            $this->assertCanEditPlayer($state, $actor, $playerId);
            $this->updatePlayer($state, $playerId, static fn (array $player): array => [
                ...$player,
                'trackers' => [...($player['trackers'] ?? []), $trackerId => $value],
            ]);

            return;
        }

        if (!in_array($trackerId, TableAssistantStateFactory::GLOBAL_TRACKERS, true) || !$this->canEditGlobal($state, $actor)) {
            throw new \InvalidArgumentException('Invalid global tracker action.');
        }

        $state['globalTrackers'][$trackerId] = $value;
    }

    private function applyParticipantAssigned(array &$state, array $payload, User $actor): void
    {
        if (!$this->isHost($state, $actor)) {
            throw new \InvalidArgumentException('Only the host can assign participants.');
        }

        $participantId = $this->requiredString($payload, 'participantId');
        $playerId = $this->requiredString($payload, 'playerId');
        $participantIndex = $this->participantIndex($state, $participantId);
        $playerIndex = $this->playerIndex($state, $playerId);
        $assignedUserId = $state['participants'][$participantIndex]['user']['id'] ?? null;

        $state['participants'][$participantIndex]['assignedPlayerId'] = $playerId;

        foreach ($state['players'] as &$player) {
            if (($player['assignedParticipantId'] ?? null) === $participantId) {
                $player['assignedParticipantId'] = null;
                $player['assignedUserId'] = null;
            }
        }
        unset($player);

        $state['players'][$playerIndex]['assignedParticipantId'] = $participantId;
        $state['players'][$playerIndex]['assignedUserId'] = $assignedUserId;
    }

    public function addParticipant(TableAssistantRoom $assistantRoom, User $user, ?string $deviceId): void
    {
        $state = $assistantRoom->snapshot();
        $existingIndex = $this->participantIndexByUserId($state, $user->id());

        if ($existingIndex !== null) {
            $state['participants'][$existingIndex]['connected'] = true;
            $state['participants'][$existingIndex]['deviceId'] = $deviceId;
            $assistantRoom->replaceSnapshot($state);

            return;
        }

        $participantId = 'participant-'.(count($state['participants'] ?? []) + 1);
        $assignedPlayerId = null;

        if (($state['mode'] ?? 'single-device') === 'per-player-device') {
            foreach ($state['players'] ?? [] as $player) {
                if (($player['assignedParticipantId'] ?? null) === null) {
                    $assignedPlayerId = $player['id'];
                    break;
                }
            }
        }

        $state['participants'][] = [
            'id' => $participantId,
            'role' => 'player',
            'user' => $user->toArray(),
            'deviceId' => $deviceId,
            'assignedPlayerId' => $assignedPlayerId,
            'connected' => true,
            'joinedAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];

        if ($assignedPlayerId !== null) {
            foreach ($state['players'] as &$player) {
                if ($player['id'] === $assignedPlayerId) {
                    $player['assignedParticipantId'] = $participantId;
                    $player['assignedUserId'] = $user->id();
                    break;
                }
            }
            unset($player);
        }

        $assistantRoom->replaceSnapshot($state);
    }

    private function assertCanEditPlayer(array $state, User $actor, string $playerId): void
    {
        $this->playerIndex($state, $playerId);
        if ($this->canEditPlayer($state, $actor, $playerId)) {
            return;
        }

        throw new \InvalidArgumentException('You cannot edit this player.');
    }

    private function canEditPlayer(array $state, User $actor, string $playerId): bool
    {
        $participant = $this->participantForUser($state, $actor);
        if ($participant === null || ($participant['role'] ?? null) === 'viewer') {
            return false;
        }

        if (($state['settings']['permissionPolicy']['mode'] ?? 'host-and-owner') === 'everyone' || $this->isHost($state, $actor)) {
            return true;
        }

        return ($participant['assignedPlayerId'] ?? null) === $playerId
            && ($state['settings']['permissionPolicy']['playerCanEditOwnPanel'] ?? false) === true;
    }

    private function canEditGlobal(array $state, User $actor): bool
    {
        return ($state['settings']['permissionPolicy']['mode'] ?? 'host-and-owner') === 'everyone' || $this->isHost($state, $actor);
    }

    private function assertTimerCanChange(array $state, User $actor): void
    {
        if (($state['timer']['mode'] ?? 'none') === 'none') {
            throw new \InvalidArgumentException('Timer is disabled.');
        }
        if (($state['timer']['mode'] ?? 'none') === 'phase' && ($state['settings']['phasesEnabled'] ?? false) !== true) {
            throw new \InvalidArgumentException('Phase timer requires phases.');
        }
        if (!$this->canEditGlobal($state, $actor)) {
            throw new \InvalidArgumentException('Only the host can control the timer.');
        }
    }

    private function resetTimerForBoundary(array &$state): void
    {
        if (($state['timer']['mode'] ?? 'none') === 'none') {
            return;
        }

        $state['timer']['status'] = 'idle';
        $state['timer']['remainingSeconds'] = $state['timer']['durationSeconds'] ?? null;
        $state['timer']['startedAt'] = null;
    }

    private function isHost(array $state, User $actor): bool
    {
        $participant = $this->participantForUser($state, $actor);

        return $participant !== null && ($participant['id'] ?? null) === ($state['hostParticipantId'] ?? null);
    }

    private function participantForUser(array $state, User $user): ?array
    {
        foreach ($state['participants'] ?? [] as $participant) {
            if (($participant['user']['id'] ?? null) === $user->id()) {
                return $participant;
            }
        }

        return null;
    }

    private function participantIdForUser(array $state, User $user): ?string
    {
        return $this->participantForUser($state, $user)['id'] ?? null;
    }

    private function updatePlayer(array &$state, string $playerId, callable $updater): void
    {
        $index = $this->playerIndex($state, $playerId);
        $state['players'][$index] = $updater($state['players'][$index]);
    }

    private function playerIndex(array $state, string $playerId): int
    {
        foreach ($state['players'] ?? [] as $index => $player) {
            if (($player['id'] ?? null) === $playerId) {
                return $index;
            }
        }

        throw new \InvalidArgumentException('Player not found.');
    }

    private function participantIndex(array $state, string $participantId): int
    {
        foreach ($state['participants'] ?? [] as $index => $participant) {
            if (($participant['id'] ?? null) === $participantId) {
                return $index;
            }
        }

        throw new \InvalidArgumentException('Participant not found.');
    }

    private function participantIndexByUserId(array $state, string $userId): ?int
    {
        foreach ($state['participants'] ?? [] as $index => $participant) {
            if (($participant['user']['id'] ?? null) === $userId) {
                return $index;
            }
        }

        return null;
    }

    private function nextActivePlayerId(array $state): ?string
    {
        $players = $state['players'] ?? [];
        usort($players, static fn (array $left, array $right): int => ((int) $left['turnOrder']) <=> ((int) $right['turnOrder']));
        $currentIndex = 0;
        foreach ($players as $index => $player) {
            if (($player['id'] ?? null) === ($state['turn']['activePlayerId'] ?? null)) {
                $currentIndex = $index;
                break;
            }
        }

        for ($offset = 1; $offset <= count($players); $offset++) {
            $candidate = $players[($currentIndex + $offset) % count($players)];
            if (($state['settings']['skipEliminatedPlayers'] ?? false) !== true || !$this->isPlayerEliminated($candidate)) {
                return $candidate['id'];
            }
        }

        return $state['turn']['activePlayerId'] ?? null;
    }

    private function withEliminationFromLife(array $player): array
    {
        return [...$player, 'eliminated' => (int) ($player['life'] ?? 0) <= 0];
    }

    private function isPlayerEliminated(array $player): bool
    {
        return ($player['eliminated'] ?? false) === true || (int) ($player['life'] ?? 0) <= 0;
    }

    private function appendActionLog(array &$state, string $type, ?string $actorParticipantId, ?string $clientActionId): void
    {
        $state['actionLog'][] = [
            'id' => $clientActionId ?? 'action-'.count($state['actionLog'] ?? []),
            'type' => $type,
            'actorParticipantId' => $actorParticipantId,
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
    }

    private function requiredString(array $payload, string $key): string
    {
        $value = $payload[$key] ?? null;
        if (!is_string($value) || trim($value) === '') {
            throw new \InvalidArgumentException(sprintf('%s is required.', $key));
        }

        return trim($value);
    }

    private function requiredInteger(array $payload, string $key): int
    {
        $value = filter_var($payload[$key] ?? null, FILTER_VALIDATE_INT);
        if (!is_int($value)) {
            throw new \InvalidArgumentException(sprintf('%s must be an integer.', $key));
        }

        return $value;
    }
}
