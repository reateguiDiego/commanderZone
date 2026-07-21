<?php

namespace App\Application\Game\Runtime;

use App\Application\Game\TokenGroup\TokenGroupCanonicalizer;
use App\Application\Game\TokenGroup\TokenGroupContractException;

final readonly class GameplayRuntimePatchAdapter
{
    public function __construct(private TokenGroupCanonicalizer $tokenGroups = new TokenGroupCanonicalizer())
    {
    }
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
            try {
                if ($flattenedOp['op'] === 'token.group.set') {
                    if (!is_array($flattenedOp['group'] ?? null)) {
                        throw new TokenGroupContractException(TokenGroupCanonicalizer::PROJECTION_INCOMPLETE);
                    }
                    $flattenedOp['group'] = $this->tokenGroups->normalizeProjected($flattenedOp['group']);
                } elseif ($flattenedOp['op'] === 'token.group.remove') {
                    if (!is_string($flattenedOp['groupId'] ?? null) || trim($flattenedOp['groupId']) !== $flattenedOp['groupId'] || $flattenedOp['groupId'] === '') {
                        throw new TokenGroupContractException(TokenGroupCanonicalizer::PROJECTION_INCOMPLETE);
                    }
                    if (array_key_exists('revision', $flattenedOp) && (!is_int($flattenedOp['revision']) || $flattenedOp['revision'] < 1)) {
                        throw new TokenGroupContractException(TokenGroupCanonicalizer::PROJECTION_INCOMPLETE);
                    }
                }
            } catch (TokenGroupContractException $exception) {
                throw new GameplayRuntimePatchContractException($exception->errorCode(), previous: $exception);
            }
            $flattened[] = $flattenedOp;
        }

        return $flattened;
    }
}
