<?php

namespace App\Application\Game;

final class GameLibraryOps
{
    public const ORIENTATION_KEY = 'libraryOrientation';
    public const ORIENTATION_TAIL_TOP = 'tail_top';
    public const VISIBILITY_EPOCH_KEY = 'libraryVisibilityEpoch';
    public const CARD_VISIBILITY_EPOCH_KEY = 'libraryVisibilityEpoch';

    /**
     * @param array<string,mixed> $player
     */
    public function usesTailTop(array $player): bool
    {
        return ($player[self::ORIENTATION_KEY] ?? null) === self::ORIENTATION_TAIL_TOP;
    }

    /**
     * @param array<string,mixed> $player
     */
    public function ensurePlayer(array &$player): void
    {
        $player['zones']['library'] = is_array($player['zones']['library'] ?? null)
            ? array_values(array_filter($player['zones']['library'], static fn (mixed $card): bool => is_array($card)))
            : [];

        if (!$this->usesTailTop($player)) {
            $player['zones']['library'] = array_reverse($player['zones']['library']);
            $player[self::ORIENTATION_KEY] = self::ORIENTATION_TAIL_TOP;
        }

        $player[self::VISIBILITY_EPOCH_KEY] = max(1, (int) ($player[self::VISIBILITY_EPOCH_KEY] ?? 1));
        $player['revealedLibraryTo'] = is_array($player['revealedLibraryTo'] ?? null)
            ? array_values($player['revealedLibraryTo'])
            : [];
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return list<array<string,mixed>>
     */
    public function projectionOrderCards(array $player, ?int $count = null): array
    {
        $cards = is_array($player['zones']['library'] ?? null)
            ? array_values(array_filter($player['zones']['library'], static fn (mixed $card): bool => is_array($card)))
            : [];
        if ($this->usesTailTop($player)) {
            $cards = array_reverse($cards);
        }

        return $count === null ? $cards : array_slice($cards, 0, max(0, $count));
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return array<string,mixed>|null
     */
    public function topCard(array $player): ?array
    {
        $cards = $this->projectionOrderCards($player, 1);

        return is_array($cards[0] ?? null) ? $cards[0] : null;
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return list<array<string,mixed>>
     */
    public function peekTop(array $player, int $count): array
    {
        return $this->projectionOrderCards($player, $count);
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return array<string,mixed>|null
     */
    public function drawOne(array &$player): ?array
    {
        $this->ensurePlayer($player);
        $library =& $player['zones']['library'];
        $card = array_pop($library);

        return is_array($card) ? $this->detachFromLibrary($card) : null;
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return list<array<string,mixed>>
     */
    public function drawMany(array &$player, int $count): array
    {
        $this->ensurePlayer($player);
        $count = max(0, min($count, count($player['zones']['library'])));
        if ($count === 0) {
            return [];
        }

        $removed = array_splice($player['zones']['library'], -$count);

        return array_values(array_map(
            fn (array $card): array => $this->detachFromLibrary($card),
            array_reverse($removed),
        ));
    }

    /**
     * @param array<string,mixed> $player
     * @param array<string,mixed> $card
     */
    public function putOnTop(array &$player, array $card): int
    {
        $this->ensurePlayer($player);
        $player['zones']['library'][] = $this->attachToLibrary($card);

        return count($player['zones']['library']) - 1;
    }

    /**
     * @param array<string,mixed> $player
     * @param array<string,mixed> $card
     */
    public function putOnBottom(array &$player, array $card): int
    {
        $this->ensurePlayer($player);
        array_splice($player['zones']['library'], 0, 0, [$this->attachToLibrary($card)]);

        return 0;
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return array<string,mixed>|null
     */
    public function removeAt(array &$player, int $index): ?array
    {
        $this->ensurePlayer($player);
        if ($index < 0 || $index >= count($player['zones']['library'])) {
            return null;
        }

        $removed = array_splice($player['zones']['library'], $index, 1);
        $card = $removed[0] ?? null;

        return is_array($card) ? $this->detachFromLibrary($card) : null;
    }

    /**
     * @param array<string,mixed> $player
     * @param list<string>        $orderedTopIds
     */
    public function reorderTop(array &$player, array $orderedTopIds): void
    {
        $this->ensurePlayer($player);
        $orderedTopIds = array_values(array_filter(
            array_map(static fn (mixed $id): string => is_string($id) ? trim($id) : '', $orderedTopIds),
            static fn (string $id): bool => $id !== '',
        ));
        $count = count($orderedTopIds);
        if ($count === 0 || count($player['zones']['library']) < $count) {
            throw new \InvalidArgumentException('Can only reorder the currently viewed top library cards.');
        }

        $topCards = array_reverse(array_slice($player['zones']['library'], -$count));
        $topById = [];
        foreach ($topCards as $card) {
            $instanceId = (string) ($card['instanceId'] ?? '');
            if ($instanceId !== '') {
                $topById[$instanceId] = $card;
            }
        }

        $sortedCurrentIds = array_keys($topById);
        $sortedRequestedIds = $orderedTopIds;
        sort($sortedCurrentIds);
        sort($sortedRequestedIds);
        if ($sortedCurrentIds !== $sortedRequestedIds) {
            throw new \InvalidArgumentException('Can only reorder the currently viewed top library cards.');
        }

        $replacement = array_values(array_map(
            static fn (string $instanceId): array => $topById[$instanceId],
            array_reverse($orderedTopIds),
        ));
        array_splice($player['zones']['library'], -$count, $count, $replacement);
    }

    /**
     * @param array<string,mixed> $player
     * @param callable(list<array<string,mixed>>):list<array<string,mixed>> $shuffle
     */
    public function shuffle(array &$player, callable $shuffle): void
    {
        $this->ensurePlayer($player);
        $player['zones']['library'] = array_values($shuffle($player['zones']['library']));
        $this->clearReveals($player);
    }

    /**
     * @param array<string,mixed> $player
     * @param list<string>        $targets
     */
    public function revealTop(array &$player, int $count, array $targets): int
    {
        $this->ensurePlayer($player);
        $this->clearReveals($player);
        $epoch = (int) $player[self::VISIBILITY_EPOCH_KEY];
        $revealed = 0;

        for ($index = count($player['zones']['library']) - 1; $index >= 0 && $revealed < $count; --$index) {
            if (!is_array($player['zones']['library'][$index] ?? null)) {
                continue;
            }

            $player['zones']['library'][$index]['faceDown'] = false;
            $player['zones']['library'][$index]['revealedTo'] = $targets;
            $player['zones']['library'][$index][self::CARD_VISIBILITY_EPOCH_KEY] = $epoch;
            ++$revealed;
        }

        return $revealed;
    }

    /**
     * @param array<string,mixed> $player
     * @param list<string>        $targets
     */
    public function revealAll(array &$player, array $targets): void
    {
        $this->ensurePlayer($player);
        $this->clearReveals($player);
        $player['revealedLibraryTo'] = array_values($targets);
    }

    /**
     * @param array<string,mixed> $player
     */
    public function clearReveals(array &$player): void
    {
        $this->ensurePlayer($player);
        $player[self::VISIBILITY_EPOCH_KEY] = ((int) $player[self::VISIBILITY_EPOCH_KEY]) + 1;
        $player['revealedLibraryTo'] = [];
    }

    /**
     * @param array<string,mixed> $player
     * @param array<string,mixed> $card
     */
    public function isCardVisibleTo(array $player, array $card, string $viewerId): bool
    {
        $targets = is_array($player['revealedLibraryTo'] ?? null) ? $player['revealedLibraryTo'] : [];
        if (in_array('all', $targets, true) || in_array($viewerId, $targets, true)) {
            return true;
        }

        $cardEpoch = (int) ($card[self::CARD_VISIBILITY_EPOCH_KEY] ?? 0);
        $playerEpoch = max(1, (int) ($player[self::VISIBILITY_EPOCH_KEY] ?? 1));
        if ($cardEpoch !== $playerEpoch) {
            return false;
        }

        $revealedTo = is_array($card['revealedTo'] ?? null) ? $card['revealedTo'] : [];

        return in_array('all', $revealedTo, true) || in_array($viewerId, $revealedTo, true);
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array<string,mixed>
     */
    private function attachToLibrary(array $card): array
    {
        unset($card[self::CARD_VISIBILITY_EPOCH_KEY]);

        return $card;
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array<string,mixed>
     */
    private function detachFromLibrary(array $card): array
    {
        unset($card[self::CARD_VISIBILITY_EPOCH_KEY]);

        return $card;
    }
}
