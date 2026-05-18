<?php

namespace App\Application\Game;

use App\Domain\Game\Game;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;

class GameProjectionService
{
    private const HIDDEN_ZONES = ['library', 'hand'];

    public function __construct(private readonly GameCommandHandler $normalizer)
    {
    }

    public function project(Game $game, User $viewer): array
    {
        $snapshot = $this->normalizer->normalizeSnapshot($game->snapshot());

        return $this->projectSnapshot($this->withCurrentPlayerUsers($game, $snapshot), $viewer, $game->room()->hasPlayer($viewer));
    }

    public function projectSnapshot(array $snapshot, User $viewer, bool $viewerCanUseOwnHiddenZones = true): array
    {
        $viewerId = $viewer->id();

        if (!isset($snapshot['players']) || !is_array($snapshot['players'])) {
            return $snapshot;
        }

        $snapshot['chat'] = array_values(array_filter(
            is_array($snapshot['chat'] ?? null) ? $snapshot['chat'] : [],
            fn (mixed $message): bool => is_array($message) && $this->canViewChatMessage($message, $viewerId),
        ));

        foreach ($snapshot['players'] as $playerId => &$player) {
            $zoneCounts = [];
            if (!isset($player['zones']) || !is_array($player['zones'])) {
                $player['zones'] = [];
            }

            foreach ($player['zones'] as $zone => &$cards) {
                $zoneCounts[$zone] = count($cards);
                $isOwnHiddenZone = $viewerCanUseOwnHiddenZones && $playerId === $viewerId;
                if ((string) $zone === 'hand' && !$isOwnHiddenZone) {
                    $cards = $this->projectOpponentHand($cards, $viewerId, (string) $playerId);
                } elseif ((string) $zone === 'library' && !$isOwnHiddenZone) {
                    $cards = $this->projectOpponentLibrary(
                        $cards,
                        $viewerId,
                        (string) $playerId,
                        ($player['playTopLibraryRevealed'] ?? false) === true,
                    );
                } elseif ($this->zoneIsHidden((string) $zone) && !$isOwnHiddenZone) {
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

    public function projectZone(array $cards, string $ownerId, string $zone, User $viewer, bool $playTopLibraryRevealed = false): array
    {
        $viewerId = $viewer->id();
        if ($ownerId !== $viewerId && $this->zoneIsHidden($zone)) {
            if ($zone === 'hand') {
                return $this->projectOpponentHand($cards, $viewerId, $ownerId);
            }
            if ($zone === 'library') {
                return $this->projectOpponentLibraryZone($cards, $viewerId, $ownerId, $playTopLibraryRevealed);
            }

            $cards = array_values(array_filter($cards, fn (array $card): bool => $this->isVisibleCard($card, $viewerId)));
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

    private function canViewChatMessage(array $message, string $viewerId): bool
    {
        $targetPlayerId = $message['targetPlayerId'] ?? null;
        if (!is_string($targetPlayerId) || $targetPlayerId === '' || $targetPlayerId === 'all') {
            return true;
        }

        return $targetPlayerId === $viewerId || ($message['userId'] ?? null) === $viewerId;
    }

    private function isVisibleCard(array $card, string $viewerId): bool
    {
        $revealedTo = $card['revealedTo'] ?? [];
        if (!is_array($revealedTo)) {
            return false;
        }

        return in_array('all', $revealedTo, true) || in_array($viewerId, $revealedTo, true);
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function projectOpponentHand(array $cards, string $viewerId, string $ownerId): array
    {
        $cards = array_values($cards);
        $handSize = count($cards);
        if ($handSize === 0) {
            return [];
        }

        $visibleCards = array_values(array_filter(
            $cards,
            fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
        ));
        $projected = array_map(
            fn (int $index): array => $this->hiddenOpponentHandCard($ownerId, $index),
            range(0, $handSize - 1),
        );

        if ($visibleCards === []) {
            return $projected;
        }

        $startIndex = max(0, (int) floor(($handSize - count($visibleCards)) / 2));
        foreach ($visibleCards as $offset => $card) {
            $projected[$startIndex + $offset] = $this->projectCard($card, $viewerId, false);
        }

        return array_values($projected);
    }

    /**
     * @return array<string,mixed>
     */
    private function hiddenOpponentHandCard(string $ownerId, int $index): array
    {
        return [
            'instanceId' => sprintf('%s-hidden-hand-%d', $ownerId, $index),
            'ownerId' => $ownerId,
            'controllerId' => $ownerId,
            'name' => 'Hidden card',
            'hidden' => true,
            'tapped' => false,
            'faceDown' => true,
            'zone' => 'hand',
        ];
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function projectOpponentLibrary(array $cards, string $viewerId, string $ownerId, bool $playTopRevealed = false): array
    {
        $cards = array_values($cards);
        if ($cards === []) {
            return [];
        }

        $topCard = $cards[0];
        if ($playTopRevealed || $this->isVisibleCard($topCard, $viewerId)) {
            $topCard['faceDown'] = false;
            if ($playTopRevealed && !$this->isVisibleCard($topCard, $viewerId)) {
                $topCard['revealedTo'] = ['all'];
            }

            return [$this->projectCard($topCard, $viewerId, false)];
        }

        $topRevealedTo = $topCard['revealedTo'] ?? [];
        if (is_array($topRevealedTo) && $topRevealedTo !== []) {
            return [$this->hiddenOpponentLibraryTopCard($ownerId)];
        }

        return [];
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function projectOpponentLibraryZone(array $cards, string $viewerId, string $ownerId, bool $playTopRevealed = false): array
    {
        $visibleCards = array_values(array_filter(
            $cards,
            fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
        ));

        if (count($visibleCards) > 1) {
            return array_values(array_map(
                fn (array $card): array => $this->projectCard($this->faceUpLibraryCard($card), $viewerId, false),
                $visibleCards,
            ));
        }

        return $this->projectOpponentLibrary($cards, $viewerId, $ownerId, $playTopRevealed);
    }

    /**
     * @return array<string,mixed>
     */
    private function faceUpLibraryCard(array $card): array
    {
        $card['faceDown'] = false;

        return $card;
    }

    /**
     * @return array<string,mixed>
     */
    private function hiddenOpponentLibraryTopCard(string $ownerId): array
    {
        return [
            'instanceId' => sprintf('%s-hidden-library-top', $ownerId),
            'ownerId' => $ownerId,
            'controllerId' => $ownerId,
            'name' => 'Hidden card',
            'hidden' => true,
            'tapped' => false,
            'faceDown' => true,
            'zone' => 'library',
        ];
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

        unset($card['basePower'], $card['baseToughness'], $card['baseLoyalty']);

        return $card;
    }

    private function withCurrentPlayerUsers(Game $game, array $snapshot): array
    {
        foreach ($game->room()->orderedPlayers() as $roomPlayer) {
            if (!$roomPlayer instanceof RoomPlayer) {
                continue;
            }

            $userId = $roomPlayer->user()->id();
            if (isset($snapshot['players'][$userId]) && is_array($snapshot['players'][$userId])) {
                $snapshot['players'][$userId]['user'] = $roomPlayer->user()->toArray();
                $snapshot['players'][$userId]['deckName'] = $roomPlayer->deck()?->name();
            }
        }

        return $snapshot;
    }
}
