<?php

namespace App\Application\Game\Compact;

use App\Application\Game\TokenGroup\TokenGroupCanonicalizer;
use App\Application\Game\TokenGroup\TokenGroupContractException;

final class CompactGameStateInvariantChecker
{
    public function __construct(private readonly TokenGroupCanonicalizer $tokenGroups = new TokenGroupCanonicalizer())
    {
    }
    /**
     * @param array<string,mixed> $compactState
     *
     * @return list<string>
     */
    public function check(array $compactState): array
    {
        $issues = [];
        $players = is_array($compactState['players'] ?? null) ? $compactState['players'] : [];
        $instances = is_array($compactState['instances'] ?? null) ? $compactState['instances'] : [];
        $zones = is_array($compactState['zones'] ?? null) ? $compactState['zones'] : [];
        $loc = is_array($compactState['loc'] ?? null) ? $compactState['loc'] : [];
        $relations = is_array($compactState['relations'] ?? null) ? $compactState['relations'] : [];

        $zoneRefs = [];
        foreach ($zones as $playerId => $playerZones) {
            if (!is_array($playerZones)) {
                $issues[] = sprintf('zones.%s must be an array.', (string) $playerId);
                continue;
            }

            foreach (['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] as $zone) {
                $instanceIds = $playerZones[$zone] ?? [];
                if (!is_array($instanceIds)) {
                    $issues[] = sprintf('zones.%s.%s must be an array.', (string) $playerId, $zone);
                    continue;
                }

                foreach (array_values($instanceIds) as $index => $instanceId) {
                    if (!is_string($instanceId) || trim($instanceId) === '') {
                        $issues[] = sprintf('zones.%s.%s[%d] must be a non-empty instanceId.', (string) $playerId, $zone, $index);
                        continue;
                    }

                    if (!isset($instances[$instanceId])) {
                        $issues[] = sprintf('zones.%s.%s[%d] references missing instance %s.', (string) $playerId, $zone, $index, $instanceId);
                        continue;
                    }

                    if (isset($zoneRefs[$instanceId])) {
                        $issues[] = sprintf('instance %s appears more than once across zones.', $instanceId);
                    }
                    $zoneRefs[$instanceId] = ['playerId' => (string) $playerId, 'zone' => $zone, 'index' => $index];

                    $controllerId = (string) ($instances[$instanceId]['controllerId'] ?? '');
                    if ($controllerId === '' || !isset($players[$controllerId])) {
                        $issues[] = sprintf('instance %s has invalid controllerId %s.', $instanceId, $controllerId);
                    }
                }
            }
        }

        foreach ($loc as $instanceId => $location) {
            if (!isset($zoneRefs[$instanceId])) {
                if (($location['zone'] ?? null) !== 'stack') {
                    $issues[] = sprintf('loc.%s has no matching zone reference.', (string) $instanceId);
                }
                continue;
            }

            if (!is_array($location)) {
                $issues[] = sprintf('loc.%s must be an array.', (string) $instanceId);
                continue;
            }

            $expected = $zoneRefs[$instanceId];
            if (($location['playerId'] ?? null) !== $expected['playerId']
                || ($location['zone'] ?? null) !== $expected['zone']
                || (int) ($location['index'] ?? -1) !== $expected['index']) {
                $issues[] = sprintf('loc.%s does not match zones map.', (string) $instanceId);
            }
        }

        foreach ($zoneRefs as $instanceId => $location) {
            if (!isset($loc[$instanceId])) {
                $issues[] = sprintf('instance %s is missing from loc.', $instanceId);
            }
        }

        foreach ($instances as $instanceId => $instance) {
            if (!is_array($instance)) {
                $issues[] = sprintf('instances.%s must be an array.', (string) $instanceId);
                continue;
            }

            if (($instance['isToken'] ?? false) === true) {
                $zone = (string) ($loc[$instanceId]['zone'] ?? $instance['zone'] ?? '');
                if ($zone !== '' && $zone !== 'battlefield' && $zone !== 'stack') {
                    $issues[] = sprintf('token %s exists outside battlefield in %s.', (string) $instanceId, $zone);
                }
            }
        }

        foreach (is_array($relations['attachments'] ?? null) ? $relations['attachments'] : [] as $attachmentId => $attachment) {
            $equipmentInstanceId = (string) ($attachment['equipmentInstanceId'] ?? '');
            $attachedToInstanceId = (string) ($attachment['attachedToInstanceId'] ?? '');
            foreach ([$equipmentInstanceId, $attachedToInstanceId] as $instanceId) {
                if ($instanceId === '') {
                    continue;
                }
                if (($loc[$instanceId]['zone'] ?? null) !== 'battlefield') {
                    $issues[] = sprintf('attachment %s references non-battlefield instance %s.', (string) $attachmentId, $instanceId);
                }
            }
        }

        $stackMemberships = [];
        foreach (is_array($relations['battlefieldStacks'] ?? null) ? $relations['battlefieldStacks'] : [] as $stackId => $stack) {
            if (!is_array($stack)) {
                $issues[] = sprintf('battlefield stack %s must be an array.', (string) $stackId);
                continue;
            }
            $members = is_array($stack['orderedMemberIds'] ?? null) ? array_values($stack['orderedMemberIds']) : [];
            $root = is_string($stack['rootInstanceId'] ?? null) ? trim($stack['rootInstanceId']) : '';
            if (count($members) < 2 || $root === '' || !in_array($root, $members, true)) {
                $issues[] = sprintf('battlefield stack %s has invalid root or member count.', (string) $stackId);
            }
            if (count($members) !== count(array_unique(array_filter($members, 'is_string')))) {
                $issues[] = sprintf('battlefield stack %s contains duplicate members.', (string) $stackId);
            }
            foreach ($members as $memberId) {
                if (!is_string($memberId) || trim($memberId) === '') {
                    $issues[] = sprintf('battlefield stack %s contains invalid member.', (string) $stackId);
                    continue;
                }
                if (($loc[$memberId]['zone'] ?? null) !== 'battlefield') {
                    $issues[] = sprintf('battlefield stack %s references non-battlefield instance %s.', (string) $stackId, $memberId);
                }
                if (isset($stackMemberships[$memberId]) && $stackMemberships[$memberId] !== (string) $stackId) {
                    $issues[] = sprintf('instance %s belongs to multiple battlefield stacks.', $memberId);
                }
                $stackMemberships[$memberId] = (string) $stackId;
            }
        }

        foreach (is_array($relations['arrows'] ?? null) ? $relations['arrows'] : [] as $arrowId => $arrow) {
            $fromInstanceId = (string) ($arrow['fromInstanceId'] ?? '');
            $toInstanceId = (string) ($arrow['toInstanceId'] ?? '');
            foreach ([$fromInstanceId, $toInstanceId] as $instanceId) {
                if ($instanceId === '') {
                    continue;
                }
                if (($loc[$instanceId]['zone'] ?? null) !== 'battlefield') {
                    $issues[] = sprintf('arrow %s references non-battlefield instance %s.', (string) $arrowId, $instanceId);
                }
            }
        }

        $tokenGroupMemberships = [];
        foreach (is_array($relations['tokenGroups'] ?? null) ? $relations['tokenGroups'] : [] as $groupId => $group) {
            if (!is_array($group)) {
                $issues[] = sprintf('token group %s must be an array.', (string) $groupId);
                continue;
            }
            try {
                $canonical = $this->tokenGroups->normalizeCanonical($group);
            } catch (TokenGroupContractException $exception) {
                $issues[] = sprintf('token group %s failed canonical contract: %s.', (string) $groupId, $exception->errorCode());
                continue;
            }
            $members = $canonical['orderedMemberIds'];
            $root = $canonical['rootInstanceId'];
            if ($canonical['groupId'] !== (string) $groupId) {
                $issues[] = sprintf('token group %s map key does not match canonical groupId.', (string) $groupId);
            }
            $rootPosition = is_array($instances[$root]['position'] ?? null) ? $instances[$root]['position'] : null;
            $rootFingerprint = is_array($instances[$root] ?? null) ? $this->tokenGroups->fingerprintCard(
                $instances[$root],
                is_array($loc[$root] ?? null) ? ($loc[$root]['zone'] ?? null) : null,
                $instances[$root]['visibleToMask'] ?? null,
            ) : null;
            if ($rootPosition === null
                || ($rootPosition['unit'] ?? null) !== 'ratio'
                || !is_numeric($rootPosition['x'] ?? null)
                || !is_numeric($rootPosition['y'] ?? null)) {
                $issues[] = sprintf('token group %s root has no canonical ratio position.', (string) $groupId);
            }
            foreach ($members as $memberId) {
                if (!is_string($memberId) || trim($memberId) === '') {
                    $issues[] = sprintf('token group %s contains invalid member.', (string) $groupId);
                    continue;
                }
                if (($loc[$memberId]['zone'] ?? null) !== 'battlefield'
                    || ($instances[$memberId]['isToken'] ?? false) !== true) {
                    $issues[] = sprintf('token group %s references invalid token member %s.', (string) $groupId, $memberId);
                }
                if (is_array($instances[$memberId] ?? null)) {
                    if ($rootFingerprint !== $this->tokenGroups->fingerprintCard(
                        $instances[$memberId],
                        is_array($loc[$memberId] ?? null) ? ($loc[$memberId]['zone'] ?? null) : null,
                        $instances[$memberId]['visibleToMask'] ?? null,
                    )) {
                        $issues[] = sprintf('token group %s contains incompatible member %s.', (string) $groupId, $memberId);
                    }
                    if (($instances[$memberId]['position'] ?? null) !== $rootPosition) {
                        $issues[] = sprintf('token group %s member %s position differs from root.', (string) $groupId, $memberId);
                    }
                }
                if (isset($tokenGroupMemberships[$memberId]) && $tokenGroupMemberships[$memberId] !== (string) $groupId) {
                    $issues[] = sprintf('instance %s belongs to multiple token groups.', $memberId);
                }
                if (isset($stackMemberships[$memberId])) {
                    $issues[] = sprintf('instance %s belongs to both a token group and a battlefield stack.', $memberId);
                }
                foreach (is_array($relations['attachments'] ?? null) ? $relations['attachments'] : [] as $attachment) {
                    if (is_array($attachment) && in_array($memberId, [$attachment['equipmentInstanceId'] ?? null, $attachment['attachedToInstanceId'] ?? null], true)) {
                        $issues[] = sprintf('token group member %s participates in an attachment.', $memberId);
                    }
                }
                foreach (is_array($relations['arrows'] ?? null) ? $relations['arrows'] : [] as $arrow) {
                    if (is_array($arrow) && in_array($memberId, [$arrow['fromInstanceId'] ?? null, $arrow['toInstanceId'] ?? null], true)) {
                        $issues[] = sprintf('token group member %s participates in an arrow.', $memberId);
                    }
                }
                $tokenGroupMemberships[$memberId] = (string) $groupId;
            }
        }

        $relationIndexes = is_array($relations['indexes'] ?? null) ? $relations['indexes'] : [];
        $issues = [
            ...$issues,
            ...$this->checkRelationIndex($relationIndexes['attachmentsByEquipment'] ?? null, $relations['attachments'] ?? null, 'equipmentInstanceId', 'attachmentsByEquipment'),
            ...$this->checkRelationIndex($relationIndexes['attachmentsByTarget'] ?? null, $relations['attachments'] ?? null, 'attachedToInstanceId', 'attachmentsByTarget'),
            ...$this->checkStackMemberIndex($relationIndexes['battlefieldStacksByMember'] ?? null, $relations['battlefieldStacks'] ?? null),
            ...$this->checkTokenGroupMemberIndex($relationIndexes['tokenGroupByMember'] ?? null, $relations['tokenGroups'] ?? null),
            ...$this->checkRelationIndex($relationIndexes['arrowsBySource'] ?? null, $relations['arrows'] ?? null, 'fromInstanceId', 'arrowsBySource'),
            ...$this->checkRelationIndex($relationIndexes['arrowsByTarget'] ?? null, $relations['arrows'] ?? null, 'toInstanceId', 'arrowsByTarget'),
        ];

        return array_values(array_unique($issues));
    }

    /**
     * @param array<string,mixed> $projectedSnapshot
     *
     * @return list<string>
     */
    public function checkProjectionPrivacy(array $projectedSnapshot, string $viewerId): array
    {
        $issues = [];
        $players = is_array($projectedSnapshot['players'] ?? null) ? $projectedSnapshot['players'] : [];

        foreach ($players as $playerId => $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null) || (string) $playerId === $viewerId) {
                continue;
            }

            foreach (['hand', 'library'] as $zone) {
                foreach (is_array($player['zones'][$zone] ?? null) ? $player['zones'][$zone] : [] as $index => $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    if (array_key_exists('cardKey', $card)) {
                        $issues[] = sprintf('viewer %s can see cardKey for %s %s[%d].', $viewerId, (string) $playerId, $zone, $index);
                    }

                    $isHidden = ($card['hidden'] ?? false) === true || (($card['name'] ?? null) === 'Hidden card');
                    if ($isHidden) {
                        foreach (['oracleText', 'imageUris', 'cardFaces'] as $sensitiveKey) {
                            if (array_key_exists($sensitiveKey, $card)) {
                                $issues[] = sprintf('viewer %s can see %s for hidden %s %s[%d].', $viewerId, $sensitiveKey, (string) $playerId, $zone, $index);
                            }
                        }
                    }
                }
            }
        }

        return array_values(array_unique($issues));
    }

    /**
     * @param mixed $index
     * @param mixed $relations
     *
     * @return list<string>
     */
    private function checkRelationIndex(mixed $index, mixed $relations, string $field, string $label): array
    {
        if (!is_array($index) || !is_array($relations)) {
            return [];
        }

        $issues = [];
        foreach ($index as $instanceId => $relationIds) {
            if (!is_string($instanceId) || !is_array($relationIds)) {
                $issues[] = sprintf('relations.indexes.%s has invalid entry.', $label);
                continue;
            }

            foreach ($relationIds as $relationId) {
                if (!is_string($relationId) || !isset($relations[$relationId]) || !is_array($relations[$relationId])) {
                    $issues[] = sprintf('relations.indexes.%s.%s references missing relation %s.', $label, $instanceId, (string) $relationId);
                    continue;
                }
                if ((string) ($relations[$relationId][$field] ?? '') !== $instanceId) {
                    $issues[] = sprintf('relations.indexes.%s.%s is inconsistent for relation %s.', $label, $instanceId, $relationId);
                }
            }
        }

        return $issues;
    }

    /** @return list<string> */
    private function checkStackMemberIndex(mixed $index, mixed $relations): array
    {
        if (!is_array($index) || !is_array($relations)) {
            return [];
        }
        $issues = [];
        foreach ($index as $instanceId => $stackIds) {
            if (!is_string($instanceId) || !is_array($stackIds)) {
                $issues[] = 'relations.indexes.battlefieldStacksByMember has invalid entry.';
                continue;
            }
            foreach ($stackIds as $stackId) {
                $members = is_string($stackId) && is_array($relations[$stackId]['orderedMemberIds'] ?? null)
                    ? $relations[$stackId]['orderedMemberIds']
                    : [];
                if (!in_array($instanceId, $members, true)) {
                    $issues[] = sprintf('relations.indexes.battlefieldStacksByMember.%s references inconsistent stack %s.', $instanceId, (string) $stackId);
                }
            }
        }

        return $issues;
    }

    /** @return list<string> */
    private function checkTokenGroupMemberIndex(mixed $index, mixed $relations): array
    {
        if (!is_array($index) || !is_array($relations)) {
            return [];
        }
        $issues = [];
        foreach ($index as $instanceId => $groupId) {
            $members = is_string($groupId) && is_array($relations[$groupId]['orderedMemberIds'] ?? null)
                ? $relations[$groupId]['orderedMemberIds']
                : [];
            if (!is_string($instanceId) || !in_array($instanceId, $members, true)) {
                $issues[] = sprintf('relations.indexes.tokenGroupByMember.%s references inconsistent group %s.', (string) $instanceId, (string) $groupId);
            }
        }

        return $issues;
    }

}
