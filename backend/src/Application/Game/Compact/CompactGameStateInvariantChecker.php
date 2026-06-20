<?php

namespace App\Application\Game\Compact;

final class CompactGameStateInvariantChecker
{
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
}
