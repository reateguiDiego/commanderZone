<?php

namespace App\Application\Game\TokenGroup;

final class TokenGroupCanonicalizer
{
    public const EFFECT_VERSION = 1;
    public const LEGACY_CREATE_EFFECT_VERSION = 1;
    public const CREATE_EFFECT_VERSION = 2;
    public const GROUP_ID_DISCRIMINATOR = 'token-group-v1';

    public const INVARIANT_FAILED = 'TOKEN_GROUP_INVARIANT_FAILED';
    public const MEMBER_MISMATCH = 'TOKEN_GROUP_MEMBER_MISMATCH';
    public const DUPLICATE_MEMBER = 'TOKEN_GROUP_DUPLICATE_MEMBER';
    public const ROOT_INVALID = 'TOKEN_GROUP_ROOT_INVALID';
    public const RELATION_CONFLICT = 'TOKEN_GROUP_RELATION_CONFLICT';
    public const EFFECT_VERSION_UNSUPPORTED = 'TOKEN_GROUP_EFFECT_VERSION_UNSUPPORTED';
    public const PROJECTION_INCOMPLETE = 'TOKEN_GROUP_PROJECTION_INCOMPLETE';
    public const PATCH_CONFLICT = 'TOKEN_GROUP_PATCH_CONFLICT';

    private const CANONICAL_FIELDS = [
        'groupId',
        'rootInstanceId',
        'orderedMemberIds',
        'revision',
        'createdByPlayerId',
        'createdAtVersion',
        'effectVersion',
    ];

    private const FORBIDDEN_ALIASES = [
        'quantity',
        'members',
        'memberIds',
        'cards',
        'rootId',
        'version',
        'id',
    ];

    /**
     * @param array<string,mixed> $payload
     * @param list<string>|null    $expectedMemberIds
     *
     * @return array{groupId:string,rootInstanceId:string,orderedMemberIds:list<string>,revision:int,createdByPlayerId:string,createdAtVersion:int,effectVersion:int}
     */
    public function normalizeCanonical(
        array $payload,
        ?array $expectedMemberIds = null,
        ?string $expectedCreatedByPlayerId = null,
        ?int $expectedCreatedAtVersion = null,
        bool $requireRootFirst = false,
    ): array {
        foreach (self::FORBIDDEN_ALIASES as $field) {
            if (array_key_exists($field, $payload)) {
                throw $this->error(self::INVARIANT_FAILED, ['invalidIndex' => -1]);
            }
        }
        if (array_diff(array_keys($payload), self::CANONICAL_FIELDS) !== []) {
            throw $this->error(self::INVARIANT_FAILED, ['invalidIndex' => -1]);
        }
        foreach (self::CANONICAL_FIELDS as $field) {
            if (!array_key_exists($field, $payload) || $payload[$field] === null) {
                throw $this->error(self::INVARIANT_FAILED, ['invalidIndex' => -1]);
            }
        }

        $groupId = $this->strictIdentifier($payload['groupId']);
        $root = $this->strictIdentifier($payload['rootInstanceId']);
        $createdBy = $this->strictIdentifier($payload['createdByPlayerId']);
        $members = $this->strictMemberIds($payload['orderedMemberIds']);
        if (count($members) < 2) {
            throw $this->error(self::MEMBER_MISMATCH, ['count' => count($members), 'invalidIndex' => -1]);
        }
        if (!in_array($root, $members, true) || ($requireRootFirst && $members[0] !== $root)) {
            throw $this->error(self::ROOT_INVALID, ['count' => count($members), 'invalidIndex' => -1]);
        }
        if ($expectedMemberIds !== null && $members !== $expectedMemberIds) {
            throw $this->error(self::MEMBER_MISMATCH, ['count' => count($members), 'invalidIndex' => -1]);
        }
        if ($expectedCreatedByPlayerId !== null && $createdBy !== $expectedCreatedByPlayerId) {
            throw $this->error(self::MEMBER_MISMATCH, ['count' => count($members), 'invalidIndex' => -1]);
        }

        $revision = $payload['revision'];
        $createdAtVersion = $payload['createdAtVersion'];
        $effectVersion = $payload['effectVersion'];
        if (!is_int($revision) || $revision < 1 || !is_int($createdAtVersion) || $createdAtVersion < 1) {
            throw $this->error(self::INVARIANT_FAILED, ['count' => count($members), 'invalidIndex' => -1]);
        }
        if ($expectedCreatedAtVersion !== null && $createdAtVersion !== $expectedCreatedAtVersion) {
            throw $this->error(self::INVARIANT_FAILED, ['count' => count($members), 'revision' => $revision, 'invalidIndex' => -1]);
        }
        if (!is_int($effectVersion) || $effectVersion !== self::EFFECT_VERSION) {
            throw $this->error(self::EFFECT_VERSION_UNSUPPORTED, [
                'count' => count($members),
                'revision' => $revision,
                'effectVersion' => is_int($effectVersion) ? $effectVersion : -1,
            ]);
        }

        return [
            'groupId' => $groupId,
            'rootInstanceId' => $root,
            'orderedMemberIds' => $members,
            'revision' => $revision,
            'createdByPlayerId' => $createdBy,
            'createdAtVersion' => $createdAtVersion,
            'effectVersion' => $effectVersion,
        ];
    }

    /**
     * @param array<array-key,mixed> $groups
     * @return list<array{groupId:string,rootInstanceId:string,orderedMemberIds:list<string>,revision:int,createdByPlayerId:string,createdAtVersion:int,effectVersion:int}>
     */
    public function normalizeCollection(array $groups): array
    {
        $normalized = [];
        $groupIds = [];
        $memberIds = [];
        foreach ($groups as $group) {
            if (!is_array($group)) {
                throw $this->error(self::INVARIANT_FAILED, ['invalidIndex' => count($normalized)]);
            }
            $canonical = $this->normalizeCanonical($group);
            if (isset($groupIds[$canonical['groupId']])) {
                throw $this->error(self::INVARIANT_FAILED, ['count' => count($canonical['orderedMemberIds']), 'invalidIndex' => count($normalized)]);
            }
            $groupIds[$canonical['groupId']] = true;
            foreach ($canonical['orderedMemberIds'] as $index => $memberId) {
                if (isset($memberIds[$memberId])) {
                    throw $this->error(self::DUPLICATE_MEMBER, ['count' => count($canonical['orderedMemberIds']), 'invalidIndex' => $index]);
                }
                $memberIds[$memberId] = true;
            }
            $normalized[] = $canonical;
        }

        return $normalized;
    }

    /**
     * Validate a new final-effect event without reinterpreting it as a command.
     * Legacy events are reported as legacy and are never assigned a group.
     *
     * @param array<string,mixed> $payload
     * @return array{legacy:bool,count:int,instanceIds:list<string>,tokens:list<array<string,mixed>>,tokenGroup:?array<string,mixed>}
     */
    public function validateTokenCreatedEffect(array $payload, int $eventVersion, string $playerId): array
    {
        if (!array_key_exists('effectVersion', $payload)) {
            $legacyTokens = is_array($payload['tokens'] ?? null) && array_is_list($payload['tokens']);
            $looksLikeUnversionedFinalEffects = $legacyTokens && $payload['tokens'] !== []
                && array_reduce(
                    $payload['tokens'],
                    fn (bool $valid, mixed $token): bool => $valid && is_array($token) && $this->validFinalToken($token),
                    true,
                );
            if ($looksLikeUnversionedFinalEffects
                || (array_key_exists('tokenGroup', $payload) && $payload['tokenGroup'] !== null)) {
                throw $this->error(self::EFFECT_VERSION_UNSUPPORTED, ['effectVersion' => -1]);
            }

            return ['legacy' => true, 'count' => 0, 'instanceIds' => [], 'tokens' => [], 'tokenGroup' => null];
        }
        if (!is_int($payload['effectVersion']) || !in_array($payload['effectVersion'], [self::LEGACY_CREATE_EFFECT_VERSION, self::CREATE_EFFECT_VERSION], true)) {
            throw $this->error(self::EFFECT_VERSION_UNSUPPORTED, [
                'effectVersion' => is_int($payload['effectVersion']) ? $payload['effectVersion'] : -1,
            ]);
        }
        if (!is_int($payload['count'] ?? null) || $payload['count'] < 1 || $payload['count'] > 20) {
            throw $this->error(self::MEMBER_MISMATCH, ['count' => is_int($payload['count'] ?? null) ? $payload['count'] : -1]);
        }
        $count = $payload['count'];
        $instanceIds = $this->strictMemberIds($payload['instanceIds'] ?? null, false);
        $tokens = $payload['tokens'] ?? null;
        if (!is_array($tokens) || !array_is_list($tokens) || count($tokens) !== $count || count($instanceIds) !== $count) {
            throw $this->error(self::MEMBER_MISMATCH, ['count' => $count, 'invalidIndex' => -1]);
        }
        $tokenIds = [];
        foreach ($tokens as $index => $token) {
            if (!is_array($token) || !$this->validFinalToken($token)) {
                throw $this->error(self::MEMBER_MISMATCH, ['count' => $count, 'invalidIndex' => $index]);
            }
            $tokenIds[] = $token['instanceId'];
        }
        if ($tokenIds !== $instanceIds) {
            throw $this->error(self::MEMBER_MISMATCH, ['count' => $count, 'invalidIndex' => -1]);
        }

        $rawGroup = $payload['tokenGroup'] ?? null;
        if ($count === 1) {
            if ($rawGroup !== null) {
                throw $this->error(self::MEMBER_MISMATCH, ['count' => 1, 'invalidIndex' => 0]);
            }
            $group = null;
        } else {
            if (!is_array($rawGroup) && $payload['effectVersion'] === self::CREATE_EFFECT_VERSION) {
                throw $this->error(self::MEMBER_MISMATCH, ['count' => $count, 'invalidIndex' => -1]);
            }
            $group = is_array($rawGroup)
                ? $this->normalizeCanonical($rawGroup, $instanceIds, $playerId, $eventVersion, true)
                : null;
        }

        return [
            'legacy' => $payload['effectVersion'] === self::LEGACY_CREATE_EFFECT_VERSION && $group === null,
            'count' => $count,
            'instanceIds' => $instanceIds,
            'tokens' => $tokens,
            'tokenGroup' => $group,
        ];
    }

    public function deterministicGroupId(string $gameId, string $clientActionId): string
    {
        return 'token-group-'.substr(hash('sha256', trim($gameId)."\0".trim($clientActionId)."\0".self::GROUP_ID_DISCRIMINATOR), 0, 24);
    }

    public function deterministicInstanceId(string $clientActionId, int $index): string
    {
        $safeActionId = preg_replace('/[^a-z0-9_-]+/', '', strtolower(trim($clientActionId))) ?? '';

        return sprintf('token-%s-%d', $safeActionId !== '' ? $safeActionId : 'action', $index);
    }

    public function opaqueGroupId(string $viewerId, string $opaqueRootRef): string
    {
        return 'token-group-view-'.substr(hash('sha256', trim($viewerId).'|'.trim($opaqueRootRef)), 0, 24);
    }

    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    public function normalizeProjected(array $payload): array
    {
        $allowed = ['groupId', 'rootRef', 'memberRefs', 'quantity', 'revision', 'position', 'faceDown', 'tapped', 'rotation', 'effectVersion'];
        if (array_diff(array_keys($payload), $allowed) !== []) {
            throw $this->error(self::PROJECTION_INCOMPLETE, ['invalidIndex' => -1]);
        }
        foreach (['groupId', 'rootRef', 'quantity', 'revision', 'position', 'effectVersion'] as $field) {
            if (!array_key_exists($field, $payload) || $payload[$field] === null) {
                throw $this->error(self::PROJECTION_INCOMPLETE, ['invalidIndex' => -1]);
            }
        }
        $groupId = $this->strictIdentifier($payload['groupId']);
        $rootRef = $this->strictIdentifier($payload['rootRef']);
        if (!is_int($payload['quantity']) || $payload['quantity'] < 2
            || !is_int($payload['revision']) || $payload['revision'] < 1
            || !is_int($payload['effectVersion']) || $payload['effectVersion'] !== self::EFFECT_VERSION
            || !$this->validRatioPosition($payload['position'])) {
            throw $this->error(self::PROJECTION_INCOMPLETE, [
                'count' => is_int($payload['quantity']) ? $payload['quantity'] : -1,
                'revision' => is_int($payload['revision']) ? $payload['revision'] : -1,
                'effectVersion' => is_int($payload['effectVersion']) ? $payload['effectVersion'] : -1,
            ]);
        }
        $normalized = [
            'groupId' => $groupId,
            'rootRef' => $rootRef,
            'quantity' => $payload['quantity'],
            'revision' => $payload['revision'],
            'position' => [
                'x' => (float) $payload['position']['x'],
                'y' => (float) $payload['position']['y'],
                'unit' => 'ratio',
            ],
        ];
        if (array_key_exists('memberRefs', $payload)) {
            if ($payload['memberRefs'] === null) {
                throw $this->error(self::PROJECTION_INCOMPLETE, ['count' => $payload['quantity'], 'invalidIndex' => -1]);
            }
            $memberRefs = $this->strictMemberIds($payload['memberRefs'], false);
            if (count($memberRefs) !== $payload['quantity'] || !in_array($rootRef, $memberRefs, true)) {
                throw $this->error(self::PROJECTION_INCOMPLETE, ['count' => $payload['quantity'], 'invalidIndex' => -1]);
            }
            $normalized['memberRefs'] = $memberRefs;
        }
        foreach (['faceDown', 'tapped'] as $field) {
            if (array_key_exists($field, $payload)) {
                if (!is_bool($payload[$field])) {
                    throw $this->error(self::PROJECTION_INCOMPLETE, ['count' => $payload['quantity'], 'invalidIndex' => -1]);
                }
                $normalized[$field] = $payload[$field];
            }
        }
        if (array_key_exists('rotation', $payload)) {
            if (!is_int($payload['rotation'])) {
                throw $this->error(self::PROJECTION_INCOMPLETE, ['count' => $payload['quantity'], 'invalidIndex' => -1]);
            }
            $normalized['rotation'] = $payload['rotation'];
        }
        $normalized['effectVersion'] = $payload['effectVersion'];

        return $normalized;
    }

    /** @param array<string,mixed> $card */
    public function fingerprintCard(array $card, ?string $zone = null, mixed $visibleToMask = null): string
    {
        $value = [
            'cardKey' => $card['cardKey'] ?? null,
            'printId' => $card['printId'] ?? null,
            'cardVersion' => $card['cardVersion'] ?? null,
            'language' => $card['language'] ?? null,
            'ownerId' => $card['ownerId'] ?? null,
            'controllerId' => $card['controllerId'] ?? null,
            'zone' => $zone ?? $card['zone'] ?? null,
            'isCommander' => $card['isCommander'] ?? false,
            'isToken' => $card['isToken'] ?? false,
            'tokenMeta' => $card['tokenMeta'] ?? [],
            'tapped' => $card['tapped'] ?? false,
            'rotation' => $card['rotation'] ?? 0,
            'counters' => $card['counters'] ?? [],
            'mutableStats' => $card['mutableStats'] ?? [],
            'printedStats' => $card['printedStats'] ?? [],
            'manualOverrides' => $card['manualOverrides'] ?? [],
            'faceDown' => $card['faceDown'] ?? false,
            'activeFace' => $card['activeFace'] ?? $card['activeFaceIndex'] ?? 0,
            'visibleToMask' => $visibleToMask ?? $card['visibleToMask'] ?? null,
        ];
        $this->sortRecursive($value);

        return hash('sha256', json_encode($value, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION));
    }

    private function strictIdentifier(mixed $value): string
    {
        if (!is_string($value) || $value === '' || trim($value) !== $value) {
            throw $this->error(self::INVARIANT_FAILED, ['invalidIndex' => -1]);
        }

        return $value;
    }

    private function validRatioPosition(mixed $position): bool
    {
        return is_array($position)
            && ($position['unit'] ?? null) === 'ratio'
            && (is_int($position['x'] ?? null) || is_float($position['x'] ?? null))
            && (is_int($position['y'] ?? null) || is_float($position['y'] ?? null))
            && $position['x'] >= 0 && $position['x'] <= 1
            && $position['y'] >= 0 && $position['y'] <= 1;
    }

    /** @return list<string> */
    private function strictMemberIds(mixed $value, bool $minimumTwo = true): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw $this->error(self::MEMBER_MISMATCH, ['invalidIndex' => -1]);
        }
        $members = [];
        foreach ($value as $index => $memberId) {
            if (!is_string($memberId) || $memberId === '' || trim($memberId) !== $memberId) {
                throw $this->error(self::MEMBER_MISMATCH, ['count' => count($value), 'invalidIndex' => $index]);
            }
            if (isset($members[$memberId])) {
                throw $this->error(self::DUPLICATE_MEMBER, ['count' => count($value), 'invalidIndex' => $index]);
            }
            $members[$memberId] = true;
        }
        if ($minimumTwo && count($members) < 2) {
            throw $this->error(self::MEMBER_MISMATCH, ['count' => count($members), 'invalidIndex' => -1]);
        }

        return array_keys($members);
    }

    /** @param array<string,mixed> $token */
    private function validFinalToken(array $token): bool
    {
        foreach ([
            'instanceId', 'cardKey', 'printId', 'cardVersion', 'language', 'tokenMeta',
            'ownerPlayerId', 'controllerPlayerId', 'zone', 'position', 'counters', 'tapped',
            'rotation', 'faceDown', 'activeFace', 'mutableStats', 'printedStats', 'manualOverrides',
        ] as $field) {
            if (!array_key_exists($field, $token)) {
                return false;
            }
        }

        return is_string($token['instanceId']) && trim($token['instanceId']) === $token['instanceId'] && $token['instanceId'] !== ''
            && is_string($token['cardKey']) && $token['cardKey'] !== ''
            && is_string($token['printId']) && $token['printId'] !== ''
            && is_string($token['cardVersion']) && $token['cardVersion'] !== ''
            && is_string($token['language']) && $token['language'] !== ''
            && is_array($token['tokenMeta']) && is_array($token['position']) && is_array($token['counters'])
            && is_bool($token['tapped']) && is_int($token['rotation']) && is_bool($token['faceDown'])
            && is_int($token['activeFace']) && is_array($token['mutableStats'])
            && is_array($token['printedStats'])
            && ($token['manualOverrides'] === null || is_array($token['manualOverrides']))
            && $token['zone'] === 'battlefield';
    }

    /** @param array<array-key,mixed> $value */
    private function sortRecursive(array &$value): void
    {
        foreach ($value as &$item) {
            if (is_array($item)) {
                $this->sortRecursive($item);
            }
        }
        unset($item);
        if (!array_is_list($value)) {
            ksort($value);
        }
    }

    /** @param array<string,int|string> $context */
    private function error(string $code, array $context = []): TokenGroupContractException
    {
        return new TokenGroupContractException($code, $context);
    }
}
