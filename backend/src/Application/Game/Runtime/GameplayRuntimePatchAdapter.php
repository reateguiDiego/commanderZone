<?php

namespace App\Application\Game\Runtime;

final readonly class GameplayRuntimePatchAdapter
{
    /**
     * @param list<array<string,mixed>> $patches
     *
     * @return list<array<string,mixed>>
     */
    public function normalize(array $patches): array
    {
        $normalized = [];
        foreach ($patches as $patch) {
            $normalized[] = $this->normalizePatch($patch);
        }

        return $normalized;
    }

    /**
     * Runtime Go serializes PatchOp as {op,data}. The browser V2 reducer consumes
     * flat semantic operations, so this boundary is intentionally strict.
     *
     * @param array<string,mixed> $patch
     *
     * @return array<string,mixed>
     */
    public function normalizePatch(array $patch): array
    {
        $gameId = $patch['gameId'] ?? null;
        $version = $patch['version'] ?? null;
        $visibility = $patch['visibility'] ?? 'public';
        if (!is_string($gameId) || $gameId === '') {
            throw new GameplayRuntimePatchContractException('Runtime patch is missing gameId.');
        }
        if (!is_int($version) || $version < 1) {
            throw new GameplayRuntimePatchContractException('Runtime patch is missing version.');
        }
        if (!is_string($visibility) || $visibility === '') {
            throw new GameplayRuntimePatchContractException('Runtime patch is missing visibility.');
        }

        $ops = $this->flattenOps($patch['ops'] ?? []);
        if ($ops === []) {
            throw new GameplayRuntimePatchContractException('Runtime patch has no semantic operations.');
        }

        return [
            ...$patch,
            'visibility' => $visibility,
            'ops' => $ops,
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function flattenOps(mixed $ops): array
    {
        if (!is_array($ops)) {
            throw new GameplayRuntimePatchContractException('Runtime patch ops must be an array.');
        }

        $flattened = [];
        foreach ($ops as $op) {
            if (!is_array($op) || !is_string($op['op'] ?? null) || trim($op['op']) === '') {
                throw new GameplayRuntimePatchContractException('Runtime patch operation is missing op.');
            }
            $data = $op['data'] ?? [];
            if ($data !== null && !is_array($data)) {
                throw new GameplayRuntimePatchContractException('Runtime patch operation data must be an object.');
            }
            unset($op['data']);
            $flattenedOp = [...$op, ...(is_array($data) ? $data : [])];
            if (array_key_exists('data', $flattenedOp)) {
                throw new GameplayRuntimePatchContractException('Runtime patch operation must be flat.');
            }
            $flattened[] = $flattenedOp;
        }

        return $flattened;
    }
}
