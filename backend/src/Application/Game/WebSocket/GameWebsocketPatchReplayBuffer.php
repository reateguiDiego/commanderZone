<?php

namespace App\Application\Game\WebSocket;

final class GameWebsocketPatchReplayBuffer
{
    private const MAX_PATCHES_PER_USER = 100;
    private const TTL_SECONDS = 120;

    /**
     * @var array<string,array<string,array<int,array{message:array<string,mixed>, storedAt:int}>>>
     */
    private array $patchesByGameAndUser = [];

    public function rememberResult(string $gameId, GameWebsocketCommandResult $result, ?int $now = null): void
    {
        $now ??= time();
        $this->prune($now);

        foreach ($result->messagesByUserId() as $userId => $message) {
            if (!$this->isReplayablePatch($message)) {
                continue;
            }

            $version = (int) $message['version'];
            $this->patchesByGameAndUser[$gameId][$userId][$version] = [
                'message' => $message,
                'storedAt' => $now,
            ];
            ksort($this->patchesByGameAndUser[$gameId][$userId]);
            while (count($this->patchesByGameAndUser[$gameId][$userId]) > self::MAX_PATCHES_PER_USER) {
                array_shift($this->patchesByGameAndUser[$gameId][$userId]);
            }
        }
    }

    /**
     * @return list<array<string,mixed>>|null
     */
    public function replay(string $gameId, string $userId, int $lastSeenVersion, int $currentVersion, ?int $now = null): ?array
    {
        $now ??= time();
        $this->prune($now);

        if ($lastSeenVersion >= $currentVersion) {
            return [];
        }

        $patches = $this->patchesByGameAndUser[$gameId][$userId] ?? [];
        $messages = [];
        for ($version = $lastSeenVersion + 1; $version <= $currentVersion; ++$version) {
            if (!isset($patches[$version])) {
                return null;
            }

            $messages[] = $patches[$version]['message'];
        }

        return $messages;
    }

    /**
     * @param array<string,mixed> $message
     */
    private function isReplayablePatch(array $message): bool
    {
        if (($message['kind'] ?? null) !== 'game_patch' || !is_int($message['version'] ?? null)) {
            return false;
        }

        $encoded = json_encode($message);
        if (!is_string($encoded)) {
            return false;
        }

        return !str_contains($encoded, '"snapshot"')
            && !str_contains($encoded, '"players"')
            && !str_contains($encoded, '"zones"');
    }

    private function prune(int $now): void
    {
        foreach ($this->patchesByGameAndUser as $gameId => $patchesByUser) {
            foreach ($patchesByUser as $userId => $patches) {
                foreach ($patches as $version => $entry) {
                    if ($entry['storedAt'] + self::TTL_SECONDS < $now) {
                        unset($this->patchesByGameAndUser[$gameId][$userId][$version]);
                    }
                }

                if (($this->patchesByGameAndUser[$gameId][$userId] ?? []) === []) {
                    unset($this->patchesByGameAndUser[$gameId][$userId]);
                }
            }

            if (($this->patchesByGameAndUser[$gameId] ?? []) === []) {
                unset($this->patchesByGameAndUser[$gameId]);
            }
        }
    }
}
