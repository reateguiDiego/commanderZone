<?php

namespace App\Application\Game;

final class GameVisibilityIndex
{
    private const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];

    /**
     * @param array<string,mixed> $snapshot
     */
    public function isReady(array $snapshot): bool
    {
        return ($snapshot['visibility']['ready'] ?? false) === true
            && is_array($snapshot['visibility']['viewerBits'] ?? null)
            && is_array($snapshot['visibility']['instances'] ?? null)
            && is_array($snapshot['visibility']['library'] ?? null);
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    public function rebuild(array &$snapshot): void
    {
        $viewerBits = $this->viewerBitsFromSnapshot($snapshot);
        $allPlayersMask = $this->allPlayersMask($viewerBits);
        $groups = ['public' => 'public'];
        $instances = [];
        $library = [];

        foreach (is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [] as $playerId => &$player) {
            if (!is_array($player)) {
                continue;
            }

            $playerId = (string) $playerId;
            foreach (self::ZONES as $zone) {
                if (!is_array($player['zones'][$zone] ?? null)) {
                    continue;
                }
                $zoneCards =& $player['zones'][$zone];

                foreach ($zoneCards as &$card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $card['zone'] = (string) ($card['zone'] ?? $zone);
                    $card['ownerId'] = (string) ($card['ownerId'] ?? $playerId);
                    $card['controllerId'] = (string) ($card['controllerId'] ?? $playerId);

                    $mask = $this->targetsMask(
                        is_array($card['revealedTo'] ?? null) ? $card['revealedTo'] : [],
                        $viewerBits,
                        $allPlayersMask,
                    );
                    $card['visibleToMask'] = $mask;
                    $instanceId = trim((string) ($card['instanceId'] ?? ''));
                    if ($instanceId === '') {
                        continue;
                    }

                    $public = $this->isPublicCard($zone, $card, $mask, $allPlayersMask);
                    $instances[$instanceId] = [
                        'playerId' => $playerId,
                        'zone' => $zone,
                        'ownerId' => (string) $card['ownerId'],
                        'controllerId' => (string) $card['controllerId'],
                        'mask' => $mask,
                        'public' => $public,
                        'faceDown' => ($card['faceDown'] ?? false) === true,
                    ];
                    if ($mask > 0 && $mask !== $allPlayersMask) {
                        $groups['group:'.$mask] = $mask;
                    }
                }
                unset($card);
                unset($zoneCards);
            }

            $revealAllMask = $this->targetsMask(
                is_array($player['revealedLibraryTo'] ?? null) ? $player['revealedLibraryTo'] : [],
                $viewerBits,
                $allPlayersMask,
            );
            $epoch = max(1, (int) ($player[GameLibraryOps::VISIBILITY_EPOCH_KEY] ?? 1));
            $topWindowIds = [];
            $topWindowMasks = [];
            foreach ($this->orderedLibraryCards($player) as $card) {
                if (!is_array($card)) {
                    continue;
                }

                $instanceId = trim((string) ($card['instanceId'] ?? ''));
                if ($instanceId === '') {
                    continue;
                }

                $mask = (int) ($card['visibleToMask'] ?? 0);
                $cardEpoch = (int) ($card[GameLibraryOps::CARD_VISIBILITY_EPOCH_KEY] ?? 0);
                if ($cardEpoch !== $epoch || $mask === 0) {
                    if ($topWindowIds !== []) {
                        break;
                    }
                    continue;
                }

                $topWindowIds[] = $instanceId;
                $topWindowMasks[$instanceId] = $mask;
                if ($mask > 0 && $mask !== $allPlayersMask) {
                    $groups['group:'.$mask] = $mask;
                }
            }

            if ($revealAllMask > 0 && $revealAllMask !== $allPlayersMask) {
                $groups['group:'.$revealAllMask] = $revealAllMask;
            }

            $topCard = $this->topLibraryCard($player);
            $library[$playerId] = [
                'epoch' => $epoch,
                'revealAllMask' => $revealAllMask,
                'topWindowIds' => $topWindowIds,
                'topWindowMasks' => $topWindowMasks,
                'topInstanceId' => is_array($topCard) ? (string) ($topCard['instanceId'] ?? '') : '',
                'playTopRevealed' => ($player['playTopLibraryRevealed'] ?? false) === true,
            ];
        }
        unset($player);

        foreach ($viewerBits as $playerId => $mask) {
            $groups['player:'.$playerId] = $mask;
        }

        $snapshot['visibility'] = [
            'strategy' => 'mask-v1',
            'ready' => true,
            'viewerBits' => $viewerBits,
            'groups' => $groups,
            'instances' => $instances,
            'library' => $library,
        ];
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param list<string> $playerIds
     */
    public function syncPlayers(array &$snapshot, array $playerIds): void
    {
        if ($playerIds === [] || !$this->isReady($snapshot)) {
            $this->rebuild($snapshot);

            return;
        }

        $normalizedIds = array_values(array_unique(array_filter(
            array_map(static fn (mixed $playerId): string => is_string($playerId) ? trim($playerId) : '', $playerIds),
            static fn (string $playerId): bool => $playerId !== '',
        )));
        if ($normalizedIds === []) {
            $this->rebuild($snapshot);

            return;
        }

        $viewerBits = is_array($snapshot['visibility']['viewerBits'] ?? null)
            ? $snapshot['visibility']['viewerBits']
            : $this->viewerBitsFromSnapshot($snapshot);
        $allPlayersMask = $this->allPlayersMask($viewerBits);

        $instances = is_array($snapshot['visibility']['instances'] ?? null) ? $snapshot['visibility']['instances'] : [];
        $library = is_array($snapshot['visibility']['library'] ?? null) ? $snapshot['visibility']['library'] : [];
        foreach ($instances as $instanceId => $entry) {
            if (!is_array($entry)) {
                unset($instances[$instanceId]);
                continue;
            }

            if (in_array((string) ($entry['playerId'] ?? ''), $normalizedIds, true)) {
                unset($instances[$instanceId]);
            }
        }

        foreach ($normalizedIds as $playerId) {
            if (!is_array($snapshot['players'][$playerId] ?? null)) {
                unset($library[$playerId]);
                continue;
            }
            $player =& $snapshot['players'][$playerId];

            foreach (self::ZONES as $zone) {
                if (!is_array($player['zones'][$zone] ?? null)) {
                    continue;
                }
                $zoneCards =& $player['zones'][$zone];

                foreach ($zoneCards as &$card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $mask = $this->targetsMask(
                        is_array($card['revealedTo'] ?? null) ? $card['revealedTo'] : [],
                        $viewerBits,
                        $allPlayersMask,
                    );
                    $card['visibleToMask'] = $mask;
                    $instanceId = trim((string) ($card['instanceId'] ?? ''));
                    if ($instanceId === '') {
                        continue;
                    }

                    $instances[$instanceId] = [
                        'playerId' => $playerId,
                        'zone' => $zone,
                        'ownerId' => (string) ($card['ownerId'] ?? $playerId),
                        'controllerId' => (string) ($card['controllerId'] ?? $playerId),
                        'mask' => $mask,
                        'public' => $this->isPublicCard($zone, $card, $mask, $allPlayersMask),
                        'faceDown' => ($card['faceDown'] ?? false) === true,
                    ];
                }
                unset($card);
                unset($zoneCards);
            }

            $revealAllMask = $this->targetsMask(
                is_array($player['revealedLibraryTo'] ?? null) ? $player['revealedLibraryTo'] : [],
                $viewerBits,
                $allPlayersMask,
            );
            $epoch = max(1, (int) ($player[GameLibraryOps::VISIBILITY_EPOCH_KEY] ?? 1));
            $topWindowIds = [];
            $topWindowMasks = [];
            foreach ($this->orderedLibraryCards($player) as $card) {
                if (!is_array($card)) {
                    continue;
                }

                $instanceId = trim((string) ($card['instanceId'] ?? ''));
                if ($instanceId === '') {
                    continue;
                }

                $mask = (int) ($card['visibleToMask'] ?? 0);
                $cardEpoch = (int) ($card[GameLibraryOps::CARD_VISIBILITY_EPOCH_KEY] ?? 0);
                if ($cardEpoch !== $epoch || $mask === 0) {
                    if ($topWindowIds !== []) {
                        break;
                    }
                    continue;
                }

                $topWindowIds[] = $instanceId;
                $topWindowMasks[$instanceId] = $mask;
            }

            $topCard = $this->topLibraryCard($player);
            $library[$playerId] = [
                'epoch' => $epoch,
                'revealAllMask' => $revealAllMask,
                'topWindowIds' => $topWindowIds,
                'topWindowMasks' => $topWindowMasks,
                'topInstanceId' => is_array($topCard) ? (string) ($topCard['instanceId'] ?? '') : '',
                'playTopRevealed' => ($player['playTopLibraryRevealed'] ?? false) === true,
            ];
            unset($player);
        }

        $snapshot['visibility']['viewerBits'] = $viewerBits;
        $snapshot['visibility']['instances'] = $instances;
        $snapshot['visibility']['library'] = $library;
        $snapshot['visibility']['groups'] = $this->groupsFromVisibility($viewerBits, $allPlayersMask, $instances, $library);
        $snapshot['visibility']['strategy'] = 'mask-v1';
        $snapshot['visibility']['ready'] = true;
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    public function maskForViewer(array $snapshot, string $viewerId): int
    {
        if (!$this->isReady($snapshot)) {
            return 0;
        }

        return max(0, (int) ($snapshot['visibility']['viewerBits'][$viewerId] ?? 0));
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $card
     */
    public function canViewerSeeCardIdentity(
        array $snapshot,
        array $card,
        string $viewerId,
        bool $viewerCanUseOwnHiddenZones = true,
    ): bool {
        $zone = (string) ($card['zone'] ?? '');
        $ownerId = (string) ($card['ownerId'] ?? '');
        $ownerView = $viewerCanUseOwnHiddenZones && $ownerId !== '' && $ownerId === $viewerId;
        if ($ownerView && in_array($zone, ['hand', 'library'], true)) {
            return true;
        }
        if ($ownerView && $zone === 'battlefield' && (($card['faceDown'] ?? false) === true)) {
            return true;
        }

        $instanceId = trim((string) ($card['instanceId'] ?? ''));
        if (!$this->isReady($snapshot) || $instanceId === '') {
            $revealedTo = is_array($card['revealedTo'] ?? null) ? $card['revealedTo'] : [];

            return in_array('all', $revealedTo, true) || in_array($viewerId, $revealedTo, true);
        }

        $entry = $snapshot['visibility']['instances'][$instanceId] ?? null;
        if (!is_array($entry)) {
            return false;
        }
        if (($entry['public'] ?? false) === true) {
            return true;
        }

        $mask = (int) ($entry['mask'] ?? 0);

        return $mask > 0 && (($mask & $this->maskForViewer($snapshot, $viewerId)) !== 0);
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    public function libraryState(array $snapshot, string $playerId): array
    {
        if (!$this->isReady($snapshot)) {
            return [];
        }

        $state = $snapshot['visibility']['library'][$playerId] ?? null;

        return is_array($state) ? $state : [];
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $libraryState
     */
    public function canViewerSeeLibraryCard(array $snapshot, array $libraryState, string $instanceId, string $viewerId): bool
    {
        if (($libraryState['playTopRevealed'] ?? false) === true
            && (string) ($libraryState['topInstanceId'] ?? '') === $instanceId) {
            return true;
        }

        $revealAllMask = (int) ($libraryState['revealAllMask'] ?? 0);
        $viewerMask = $this->maskForViewer($snapshot, $viewerId);
        if ($revealAllMask > 0 && (($revealAllMask & $viewerMask) !== 0)) {
            return true;
        }

        $topWindowMasks = is_array($libraryState['topWindowMasks'] ?? null) ? $libraryState['topWindowMasks'] : [];
        $mask = max(0, (int) ($topWindowMasks[$instanceId] ?? 0));

        return $mask > 0 && (($mask & $viewerMask) !== 0);
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,int>
     */
    private function viewerBitsFromSnapshot(array $snapshot): array
    {
        $viewerBits = [];
        $bit = 1;
        foreach (array_keys(is_array($snapshot['players'] ?? null) ? $snapshot['players'] : []) as $playerId) {
            if (!is_string($playerId)) {
                continue;
            }

            $viewerBits[$playerId] = $bit;
            $bit <<= 1;
        }

        return $viewerBits;
    }

    /**
     * @param array<string,int> $viewerBits
     */
    private function allPlayersMask(array $viewerBits): int
    {
        return array_reduce(
            array_values($viewerBits),
            static fn (int $mask, int $bit): int => $mask | $bit,
            0,
        );
    }

    /**
     * @param list<string> $targets
     * @param array<string,int> $viewerBits
     */
    private function targetsMask(array $targets, array $viewerBits, int $allPlayersMask): int
    {
        if (in_array('all', $targets, true)) {
            return $allPlayersMask;
        }

        $mask = 0;
        foreach ($targets as $target) {
            if (!is_string($target)) {
                continue;
            }

            $mask |= max(0, (int) ($viewerBits[$target] ?? 0));
        }

        return $mask;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isPublicCard(string $zone, array $card, int $mask, int $allPlayersMask): bool
    {
        if ($mask === $allPlayersMask && $allPlayersMask > 0) {
            return true;
        }

        if ($zone === 'battlefield') {
            return ($card['faceDown'] ?? false) !== true;
        }

        return in_array($zone, ['graveyard', 'exile', 'command'], true);
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return list<array<string,mixed>>
     */
    private function orderedLibraryCards(array $player): array
    {
        $cards = is_array($player['zones']['library'] ?? null)
            ? array_values(array_filter($player['zones']['library'], static fn (mixed $card): bool => is_array($card)))
            : [];

        if (($player[GameLibraryOps::ORIENTATION_KEY] ?? null) === GameLibraryOps::ORIENTATION_TAIL_TOP) {
            $cards = array_reverse($cards);
        }

        return $cards;
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return array<string,mixed>|null
     */
    private function topLibraryCard(array $player): ?array
    {
        $cards = $this->orderedLibraryCards($player);

        return is_array($cards[0] ?? null) ? $cards[0] : null;
    }

    /**
     * @param array<string,int> $viewerBits
     * @param array<string,array<string,mixed>> $instances
     * @param array<string,array<string,mixed>> $library
     *
     * @return array<string,int|string>
     */
    private function groupsFromVisibility(array $viewerBits, int $allPlayersMask, array $instances, array $library): array
    {
        $groups = ['public' => 'public'];
        foreach ($viewerBits as $playerId => $mask) {
            $groups['player:'.$playerId] = $mask;
        }

        foreach ($instances as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $mask = max(0, (int) ($entry['mask'] ?? 0));
            if ($mask > 0 && $mask !== $allPlayersMask) {
                $groups['group:'.$mask] = $mask;
            }
        }

        foreach ($library as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $revealAllMask = max(0, (int) ($entry['revealAllMask'] ?? 0));
            if ($revealAllMask > 0 && $revealAllMask !== $allPlayersMask) {
                $groups['group:'.$revealAllMask] = $revealAllMask;
            }
            foreach (is_array($entry['topWindowMasks'] ?? null) ? $entry['topWindowMasks'] : [] as $mask) {
                $mask = max(0, (int) $mask);
                if ($mask > 0 && $mask !== $allPlayersMask) {
                    $groups['group:'.$mask] = $mask;
                }
            }
        }

        return $groups;
    }
}
