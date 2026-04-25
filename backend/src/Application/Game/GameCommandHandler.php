<?php

namespace App\Application\Game;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\User\User;

class GameCommandHandler
{
    public function apply(Game $game, string $type, array $payload, User $actor): GameEvent
    {
        $snapshot = $game->snapshot();

        match ($type) {
            'chat.message' => $this->applyChatMessage($snapshot, $payload, $actor),
            'life.changed' => $this->applyLifeChanged($snapshot, $payload),
            'commander.damage.changed' => $this->applyCommanderDamageChanged($snapshot, $payload),
            'counter.changed' => $this->applyCounterChanged($snapshot, $payload),
            'card.moved' => $this->applyCardMoved($snapshot, $payload),
            'card.tapped' => $this->applyCardTapped($snapshot, $payload),
            'turn.changed' => $this->applyTurnChanged($snapshot, $payload),
            'zone.changed' => $this->applyZoneChanged($snapshot, $payload),
            default => null,
        };

        $game->replaceSnapshot($snapshot);
        $event = new GameEvent($game, $type, $payload, $actor);
        $game->addEvent($event);

        return $event;
    }

    private function applyChatMessage(array &$snapshot, array $payload, User $actor): void
    {
        $message = trim((string) ($payload['message'] ?? ''));
        if ($message === '') {
            return;
        }

        $snapshot['chat'][] = [
            'userId' => $actor->id(),
            'displayName' => $actor->displayName(),
            'message' => $message,
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
        $snapshot['chat'] = array_slice($snapshot['chat'], -100);
    }

    private function applyLifeChanged(array &$snapshot, array $payload): void
    {
        $playerId = (string) ($payload['playerId'] ?? '');
        if (!isset($snapshot['players'][$playerId])) {
            return;
        }

        if (isset($payload['life'])) {
            $snapshot['players'][$playerId]['life'] = (int) $payload['life'];
            return;
        }

        $snapshot['players'][$playerId]['life'] += (int) ($payload['delta'] ?? 0);
    }

    private function applyCommanderDamageChanged(array &$snapshot, array $payload): void
    {
        $targetPlayerId = (string) ($payload['targetPlayerId'] ?? '');
        $sourcePlayerId = (string) ($payload['sourcePlayerId'] ?? '');
        if (!isset($snapshot['players'][$targetPlayerId]) || $sourcePlayerId === '') {
            return;
        }

        $snapshot['players'][$targetPlayerId]['commanderDamage'][$sourcePlayerId] = (int) ($payload['damage'] ?? 0);
    }

    private function applyCounterChanged(array &$snapshot, array $payload): void
    {
        $scope = (string) ($payload['scope'] ?? 'global');
        $key = (string) ($payload['key'] ?? '');
        if ($key === '') {
            return;
        }

        $snapshot['counters'][$scope][$key] = (int) ($payload['value'] ?? 0);
    }

    private function applyCardMoved(array &$snapshot, array $payload): void
    {
        $playerId = (string) ($payload['playerId'] ?? '');
        $fromZone = (string) ($payload['fromZone'] ?? '');
        $toZone = (string) ($payload['toZone'] ?? '');
        $instanceId = (string) ($payload['instanceId'] ?? '');

        if (!isset($snapshot['players'][$playerId]['zones'][$fromZone], $snapshot['players'][$playerId]['zones'][$toZone]) || $instanceId === '') {
            return;
        }

        $card = null;
        foreach ($snapshot['players'][$playerId]['zones'][$fromZone] as $index => $candidate) {
            if (($candidate['instanceId'] ?? null) === $instanceId) {
                $card = $candidate;
                array_splice($snapshot['players'][$playerId]['zones'][$fromZone], $index, 1);
                break;
            }
        }

        if ($card === null) {
            $card = $payload['card'] ?? null;
        }

        if (is_array($card)) {
            $snapshot['players'][$playerId]['zones'][$toZone][] = $card;
        }
    }

    private function applyCardTapped(array &$snapshot, array $payload): void
    {
        $playerId = (string) ($payload['playerId'] ?? '');
        $instanceId = (string) ($payload['instanceId'] ?? '');

        if (!isset($snapshot['players'][$playerId]) || $instanceId === '') {
            return;
        }

        foreach ($snapshot['players'][$playerId]['zones'] as &$zone) {
            foreach ($zone as &$card) {
                if (($card['instanceId'] ?? null) === $instanceId) {
                    $card['tapped'] = (bool) ($payload['tapped'] ?? true);
                    return;
                }
            }
        }
    }

    private function applyTurnChanged(array &$snapshot, array $payload): void
    {
        $snapshot['turn'] = array_replace($snapshot['turn'] ?? [], array_intersect_key($payload, array_flip(['activePlayerId', 'phase', 'number'])));
    }

    private function applyZoneChanged(array &$snapshot, array $payload): void
    {
        $playerId = (string) ($payload['playerId'] ?? '');
        $zone = (string) ($payload['zone'] ?? '');
        if (!isset($snapshot['players'][$playerId]['zones'][$zone]) || !isset($payload['cards']) || !is_array($payload['cards'])) {
            return;
        }

        $snapshot['players'][$playerId]['zones'][$zone] = $payload['cards'];
    }
}
