<?php

namespace App\Application\Game;

use App\Domain\Game\Game;
use App\Domain\User\User;

class GameProjectionService
{
    private const HIDDEN_ZONES = ['library', 'hand'];

    public function __construct(private readonly GameCommandHandler $normalizer)
    {
    }

    public function project(Game $game, User $viewer): array
    {
        return $this->projectSnapshot($this->normalizer->normalizeSnapshot($game->snapshot()), $viewer);
    }

    public function projectSnapshot(array $snapshot, User $viewer): array
    {
        $viewerId = $viewer->id();

        if (!isset($snapshot['players']) || !is_array($snapshot['players'])) {
            return $snapshot;
        }

        foreach ($snapshot['players'] as $playerId => &$player) {
            $zoneCounts = [];
            if (!isset($player['zones']) || !is_array($player['zones'])) {
                $player['zones'] = [];
            }

            foreach ($player['zones'] as $zone => &$cards) {
                $zoneCounts[$zone] = count($cards);
                if ($this->zoneIsHidden((string) $zone) && $playerId !== $viewerId) {
                    $cards = array_values(array_filter(
                        $cards,
                        fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
                    ));
                } else {
                    $cards = array_values(array_map(
                        fn (array $card): array => $this->projectCard($card, $viewerId, $playerId === $viewerId),
                        $cards,
                    ));
                }
            }
            unset($cards);
            $player['zoneCounts'] = $zoneCounts;
        }
        unset($player);

        return $snapshot;
    }

    public function projectZone(array $cards, string $ownerId, string $zone, User $viewer): array
    {
        $viewerId = $viewer->id();
        if ($ownerId !== $viewerId && $this->zoneIsHidden($zone)) {
            $cards = array_values(array_filter(
                $cards,
                fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
            ));
        }

        return array_values(array_map(
            fn (array $card): array => $this->projectCard($card, $viewerId, $ownerId === $viewerId),
            $cards,
        ));
    }

    private function zoneIsHidden(string $zone): bool
    {
        return in_array($zone, self::HIDDEN_ZONES, true);
    }

    private function isVisibleCard(array $card, string $viewerId): bool
    {
        $revealedTo = $card['revealedTo'] ?? [];
        if (!is_array($revealedTo)) {
            return false;
        }

        return in_array('all', $revealedTo, true) || in_array($viewerId, $revealedTo, true);
    }

    private function projectCard(array $card, string $viewerId, bool $ownerView): array
    {
        if (($card['faceDown'] ?? false) === true && !$ownerView && !$this->isVisibleCard($card, $viewerId)) {
            return [
                'instanceId' => $card['instanceId'],
                'ownerId' => $card['ownerId'] ?? null,
                'controllerId' => $card['controllerId'] ?? null,
                'name' => 'Face-down card',
                'hidden' => true,
                'tapped' => (bool) ($card['tapped'] ?? false),
                'faceDown' => true,
                'position' => $card['position'] ?? ['x' => 0, 'y' => 0],
                'rotation' => $card['rotation'] ?? 0,
                'counters' => $card['counters'] ?? [],
                'zone' => $card['zone'] ?? null,
            ];
        }

        return $card;
    }
}
