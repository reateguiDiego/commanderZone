<?php

namespace App\Application\Game\TokenGroup;

use App\Application\Game\Compact\PowerToughnessModel;

final class RuntimeOffTokenGroupMutationService
{
    private const EFFECT_VERSION = 1;
    private const MAX_QUANTITY = 20;

    public function __construct(private readonly TokenGroupCanonicalizer $canonicalizer = new TokenGroupCanonicalizer())
    {
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $payload
     * @return array{eventType:string,eventPayload:array<string,mixed>,message:string,log:array<string,mixed>}
     */
    public function apply(
        array &$snapshot,
        string $commandType,
        array $payload,
        string $actorPlayerId,
        string $gameId,
        string $clientActionId,
    ): array {
        $snapshot['tokenGroups'] = $this->canonicalizer->normalizeCollection(
            is_array($snapshot['tokenGroups'] ?? null) ? $snapshot['tokenGroups'] : [],
        );

        return match ($commandType) {
            'token.group.split' => $this->split($snapshot, $payload, $actorPlayerId, $gameId, $clientActionId),
            'token.group.merge' => $this->merge($snapshot, $payload, $actorPlayerId, $gameId, $clientActionId),
            'token.group.remove_members' => $this->removeMembers($snapshot, $payload, $actorPlayerId),
            'token.group.dissolve' => $this->dissolve($snapshot, $payload, $actorPlayerId),
            'token.group.state.set' => $this->setState($snapshot, $payload, $actorPlayerId),
            'token.group.position.set' => $this->setPosition($snapshot, $payload, $actorPlayerId),
            'token.group.move' => $this->move($snapshot, $payload, $actorPlayerId),
            'token.group.counter.changed' => $this->changeCounter($snapshot, $payload, $actorPlayerId),
            'token.group.power_toughness.set' => $this->setPowerToughness($snapshot, $payload, $actorPlayerId),
            'token.group.controller.changed' => $this->changeController($snapshot, $payload, $actorPlayerId),
            default => throw $this->error(TokenGroupCanonicalizer::INVARIANT_FAILED, $commandType),
        };
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function split(array &$snapshot, array $payload, string $actorId, string $gameId, string $actionId): array
    {
        [$index, $group] = $this->group($snapshot, $payload, 'token.group.split', $actorId);
        $quantity = $payload['extractQuantity'] ?? null;
        if (!is_int($quantity) || $quantity < 1 || $quantity >= count($group['orderedMemberIds'])) {
            throw $this->quantityError(TokenGroupCanonicalizer::SPLIT_INVALID, 'token.group.split', $quantity, 1, count($group['orderedMemberIds']) - 1, count($group['orderedMemberIds']));
        }
        $position = $this->position($payload['destinationPosition'] ?? null, 'token.group.split');
        $beforeQuantity = count($group['orderedMemberIds']);
        [$extracted, $remaining] = $this->extract($group, $quantity);
        array_splice($snapshot['tokenGroups'], $index, 1);
        $this->setCardPositions($snapshot, $extracted, $position);
        $resulting = [];
        if (count($remaining) >= 2) {
            $group['orderedMemberIds'] = $remaining;
            if (!in_array($group['rootInstanceId'], $remaining, true)) {
                $group['rootInstanceId'] = $remaining[0];
            }
            ++$group['revision'];
            $resulting[] = $group;
        }
        if (count($extracted) >= 2) {
            $created = $this->canonicalizer->normalizeCanonical([
                'groupId' => $this->canonicalizer->deterministicMutationGroupId($gameId, $actionId, 'split'),
                'rootInstanceId' => $extracted[0], 'orderedMemberIds' => $extracted, 'revision' => 1,
                'createdByPlayerId' => $actorId, 'createdAtVersion' => ((int) ($snapshot['version'] ?? 1)) + 1,
                'effectVersion' => TokenGroupCanonicalizer::EFFECT_VERSION,
            ]);
            $resulting[] = $created;
        }
        $snapshot['tokenGroups'] = [...$snapshot['tokenGroups'], ...$resulting];
        $event = $this->effect($actorId, [$group['groupId']], $resulting, $this->positionEntries($extracted, $position));
        $event += ['extractedInstanceIds' => $extracted, 'beforeQuantity' => $beforeQuantity, 'remainingQuantity' => count($remaining), 'extractedQuantity' => count($extracted)];

        return $this->result('token.group.split', $event, sprintf('Split %d tokens into %d and %d.', $event['beforeQuantity'], count($remaining), count($extracted)), 'gameLog.tokenGroup.split', $event);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function merge(array &$snapshot, array $payload, string $actorId, string $gameId, string $actionId): array
    {
        $groupIds = $this->stringList($payload['sourceGroupIds'] ?? [], 'sourceGroupIds');
        $singleIds = $this->stringList($payload['sourceInstanceIds'] ?? [], 'sourceInstanceIds');
        if (count(array_unique($groupIds, SORT_STRING)) !== count($groupIds) || count(array_unique($singleIds, SORT_STRING)) !== count($singleIds)) {
            throw $this->error(TokenGroupCanonicalizer::MERGE_INVALID, 'token.group.merge');
        }
        $expected = $payload['expectedRevisions'] ?? null;
        if (!is_array($expected)) {
            throw $this->error(TokenGroupCanonicalizer::MERGE_INVALID, 'token.group.merge');
        }
        $groups = [];
        foreach ($groupIds as $groupId) {
            [$index, $group] = $this->groupById($snapshot, $groupId, 'token.group.merge');
            if (!is_int($expected[$groupId] ?? null) || $expected[$groupId] !== $group['revision']) {
                throw $this->stale('token.group.merge', $expected[$groupId] ?? -1, $group['revision'], count($group['orderedMemberIds']));
            }
            $this->authorizeGroup($snapshot, $group, $actorId, 'token.group.merge');
            $groups[] = ['index' => $index, 'group' => $group];
        }
        $targetId = is_string($payload['targetGroupId'] ?? null) ? trim($payload['targetGroupId']) : '';
        $survivor = null;
        if ($targetId !== '') {
            foreach ($groups as $entry) {
                if ($entry['group']['groupId'] === $targetId) { $survivor = $entry['group']; break; }
            }
            if ($survivor === null) { throw $this->error(TokenGroupCanonicalizer::MERGE_INVALID, 'token.group.merge'); }
        } elseif ($groups !== []) {
            usort($groups, static fn (array $a, array $b): int => [$a['group']['createdAtVersion'], $a['group']['groupId']] <=> [$b['group']['createdAtVersion'], $b['group']['groupId']]);
            $survivor = $groups[0]['group'];
        }
        usort($groups, static function (array $a, array $b) use ($survivor): int {
            if ($survivor !== null && $a['group']['groupId'] === $survivor['groupId']) { return -1; }
            if ($survivor !== null && $b['group']['groupId'] === $survivor['groupId']) { return 1; }
            return [$a['group']['createdAtVersion'], $a['group']['groupId']] <=> [$b['group']['createdAtVersion'], $b['group']['groupId']];
        });
        $members = [];
        foreach ($groups as $entry) { $members = [...$members, ...$entry['group']['orderedMemberIds']]; }
        $members = [...$members, ...$singleIds];
        if (count($members) < 2 || count($members) > self::MAX_QUANTITY || count(array_unique($members, SORT_STRING)) !== count($members)) {
            throw $this->quantityError(TokenGroupCanonicalizer::QUANTITY_INVALID, 'token.group.merge', count($members), 2, self::MAX_QUANTITY, count($members));
        }
        $this->authorizeCards($snapshot, $members, $actorId, 'token.group.merge');
        $this->assertNoRelationConflicts($snapshot, $members, 'token.group.merge');
        $this->assertCompatible($snapshot, $members, 'token.group.merge');
        $position = $this->position($payload['destinationPosition'] ?? null, 'token.group.merge');
        $this->setCardPositions($snapshot, $members, $position);
        $removedIds = array_map(static fn (array $entry): string => $entry['group']['groupId'], $groups);
        $snapshot['tokenGroups'] = array_values(array_filter($snapshot['tokenGroups'], static fn (array $group): bool => !in_array($group['groupId'], $removedIds, true)));
        if ($survivor === null) {
            $survivor = [
                'groupId' => $this->canonicalizer->deterministicMutationGroupId($gameId, $actionId, 'merge'),
                'rootInstanceId' => $members[0], 'revision' => 1, 'createdByPlayerId' => $actorId,
                'createdAtVersion' => ((int) ($snapshot['version'] ?? 1)) + 1, 'effectVersion' => TokenGroupCanonicalizer::EFFECT_VERSION,
            ];
        } else {
            ++$survivor['revision'];
        }
        $survivor['orderedMemberIds'] = $members;
        if (!in_array($survivor['rootInstanceId'], $members, true)) { $survivor['rootInstanceId'] = $members[0]; }
        $survivor = $this->canonicalizer->normalizeCanonical($survivor);
        $snapshot['tokenGroups'][] = $survivor;
        $event = $this->effect($actorId, $removedIds, [$survivor], $this->positionEntries($members, $position));
        $event['quantity'] = count($members);

        return $this->result('token.group.merged', $event, sprintf('Merged token groups into %d tokens.', count($members)), 'gameLog.tokenGroup.merged', $event);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function removeMembers(array &$snapshot, array $payload, string $actorId): array
    {
        [$index, $group] = $this->group($snapshot, $payload, 'token.group.remove_members', $actorId);
        $quantity = $payload['quantity'] ?? null;
        if (!is_int($quantity) || $quantity < 1 || $quantity > count($group['orderedMemberIds'])) {
            throw $this->quantityError(TokenGroupCanonicalizer::QUANTITY_INVALID, 'token.group.remove_members', $quantity, 1, count($group['orderedMemberIds']), count($group['orderedMemberIds']));
        }
        [$removed, $remaining] = $this->extract($group, $quantity);
        array_splice($snapshot['tokenGroups'], $index, 1);
        $this->removeCards($snapshot, $removed);
        $resulting = [];
        if (count($remaining) >= 2) {
            $group['orderedMemberIds'] = $remaining;
            if (!in_array($group['rootInstanceId'], $remaining, true)) { $group['rootInstanceId'] = $remaining[0]; }
            ++$group['revision'];
            $resulting[] = $group;
            $snapshot['tokenGroups'][] = $group;
        }
        $event = $this->effect($actorId, [$group['groupId']], $resulting, []);
        $event += ['removedInstanceIds' => $removed, 'removedQuantity' => count($removed), 'remainingQuantity' => count($remaining), 'removalReason' => is_string($payload['removalReason'] ?? null) ? $payload['removalReason'] : 'manual'];

        return $this->result('token.group.members.removed', $event, sprintf('Removed %d tokens.', count($removed)), 'gameLog.tokenGroup.removed', $event);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function dissolve(array &$snapshot, array $payload, string $actorId): array
    {
        [$index, $group] = $this->group($snapshot, $payload, 'token.group.dissolve', $actorId);
        $positions = array_key_exists('positions', $payload)
            ? $this->explicitPositions($payload['positions'], $group['orderedMemberIds'], 'token.group.dissolve')
            : $this->dissolvePositions($snapshot, $group);
        array_splice($snapshot['tokenGroups'], $index, 1);
		$this->setPositionEntries($snapshot, $positions);
        $event = $this->effect($actorId, [$group['groupId']], [], $positions);
        $event['quantity'] = count($group['orderedMemberIds']);

        return $this->result('token.group.dissolved', $event, sprintf('Dissolved a group of %d tokens.', $event['quantity']), 'gameLog.tokenGroup.dissolved', $event);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function setState(array &$snapshot, array $payload, string $actorId): array
    {
        [$index, $group] = $this->group($snapshot, $payload, 'token.group.state.set', $actorId);
        $hasTapped = array_key_exists('tapped', $payload) && is_bool($payload['tapped']);
        $hasFaceDown = array_key_exists('faceDown', $payload) && is_bool($payload['faceDown']);
        if ($hasTapped === $hasFaceDown) { throw $this->error(TokenGroupCanonicalizer::INVARIANT_FAILED, 'token.group.state.set'); }
        $alreadySet = true;
		$cardIndex = $this->battlefieldCardIndex($snapshot);
        foreach ($group['orderedMemberIds'] as $memberId) {
			$entry = $cardIndex[$memberId] ?? null;
			if ($entry === null) { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, 'token.group.state.set', ['invalidIndex' => -1]); }
			$card = $entry[2];
            if ($hasTapped) {
                $expectedRotation = $payload['tapped'] ? 90 : 0;
                $alreadySet = $alreadySet && (bool) ($card['tapped'] ?? false) === $payload['tapped'] && (int) ($card['rotation'] ?? 0) === $expectedRotation;
            } else {
                $alreadySet = $alreadySet && (bool) ($card['faceDown'] ?? false) === $payload['faceDown'];
            }
        }
        if ($alreadySet) { throw $this->error(TokenGroupCanonicalizer::PATCH_CONFLICT, 'token.group.state.set', ['count' => count($group['orderedMemberIds'])]); }
        $states = [];
        foreach ($group['orderedMemberIds'] as $memberId) {
			$entry = $cardIndex[$memberId] ?? null;
			if ($entry === null) { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, 'token.group.state.set', ['invalidIndex' => -1]); }
			[$playerId, $indexInZone, $card] = $entry;
            if ($hasTapped) { $card['tapped'] = $payload['tapped']; $card['rotation'] = $payload['tapped'] ? 90 : 0; }
            else { $card['faceDown'] = $payload['faceDown']; $card['revealedTo'] = $payload['faceDown'] ? [$playerId] : ['all']; }
			$snapshot['players'][$playerId]['zones']['battlefield'][$indexInZone] = $card;
            $states[] = ['instanceId' => $memberId, 'tapped' => (bool) ($card['tapped'] ?? false), 'rotation' => (int) ($card['rotation'] ?? 0), 'faceDown' => (bool) ($card['faceDown'] ?? false), 'visibleToMask' => 0, 'revealedTo' => array_values(is_array($card['revealedTo'] ?? null) ? $card['revealedTo'] : [])];
        }
        ++$group['revision'];
        $snapshot['tokenGroups'][$index] = $group;
        $event = $this->effect($actorId, [$group['groupId']], [$group], []);
        $event += ['instanceStates' => $states, 'quantity' => count($group['orderedMemberIds'])];
        $key = $hasTapped ? 'tapped' : 'faceDown'; $event[$key] = $payload[$key];

        return $this->result('token.group.state.changed', $event, sprintf('Changed state for %d tokens.', $event['quantity']), $hasTapped ? ($payload['tapped'] ? 'gameLog.tokenGroup.tapped' : 'gameLog.tokenGroup.untapped') : ($payload['faceDown'] ? 'gameLog.tokenGroup.faceDown' : 'gameLog.tokenGroup.faceUp'), $event);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function changeCounter(array &$snapshot, array $payload, string $actorId): array
    {
        [$index, $group] = $this->group($snapshot, $payload, 'token.group.counter.changed', $actorId);
        $counter = is_string($payload['counter'] ?? null) ? trim($payload['counter']) : (is_string($payload['key'] ?? null) ? trim($payload['key']) : '');
        if ($counter === '' || (isset($payload['counter'], $payload['key']) && $payload['counter'] !== $payload['key'])) { throw $this->error(TokenGroupCanonicalizer::INVARIANT_FAILED, 'token.group.counter.changed'); }
        $remove = $payload['remove'] ?? false;
        if (!is_bool($remove)) { throw $this->error(TokenGroupCanonicalizer::INVARIANT_FAILED, 'token.group.counter.changed'); }
        $hasValue = array_key_exists('value', $payload) && is_int($payload['value']);
        $hasDelta = array_key_exists('delta', $payload) && is_int($payload['delta']);
        if (($remove && ($hasValue || $hasDelta)) || (!$remove && $hasValue === $hasDelta)) { throw $this->error(TokenGroupCanonicalizer::INVARIANT_FAILED, 'token.group.counter.changed'); }
        [, , $root] = $this->card($snapshot, $group['rootInstanceId']);
        $rootCounters = is_array($root['counters'] ?? null) ? $root['counters'] : [];
        $value = $remove ? 0 : ($hasValue ? $payload['value'] : ((int) ($rootCounters[$counter] ?? 0) + $payload['delta']));
        $states = [];
        foreach ($group['orderedMemberIds'] as $memberId) {
            [$playerId, $cardIndex, $card] = $this->card($snapshot, $memberId);
            $counters = is_array($card['counters'] ?? null) ? $card['counters'] : [];
            if ($remove) { unset($counters[$counter]); } else { $counters[$counter] = $value; }
            $card['counters'] = $counters;
            $snapshot['players'][$playerId]['zones']['battlefield'][$cardIndex] = $card;
            $states[] = $this->state($memberId, $card);
        }
        ++$group['revision']; $snapshot['tokenGroups'][$index] = $group;
        $event = $this->effect($actorId, [$group['groupId']], [$group], []);
        $event += ['instanceStates' => $states, 'counter' => $counter, 'value' => $value, 'remove' => $remove, 'quantity' => count($group['orderedMemberIds'])];
        return $this->result('token.group.counter.changed', $event, sprintf('Changed counters on %d tokens.', $event['quantity']), $remove ? 'gameLog.tokenGroup.countersRemoved' : 'gameLog.tokenGroup.countersChanged', $event);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function setPowerToughness(array &$snapshot, array $payload, string $actorId): array
    {
        [$index, $group] = $this->group($snapshot, $payload, 'token.group.power_toughness.set', $actorId);
        $stats = [];
        foreach (['power', 'toughness'] as $field) { if (array_key_exists($field, $payload)) { $stats[$field] = $payload[$field]; } }
        if ($stats === []) { throw $this->error(TokenGroupCanonicalizer::INVARIANT_FAILED, 'token.group.power_toughness.set'); }
        $states = [];
        foreach ($group['orderedMemberIds'] as $memberId) {
            [$playerId, $cardIndex, $card] = $this->card($snapshot, $memberId);
            $faceIndex = max(0, (int) ($card['activeFaceIndex'] ?? 0));
            $faceKey = (string) $faceIndex;
            $printed = is_array($card['printedStats'] ?? null) ? $card['printedStats'] : PowerToughnessModel::printedStats($card);
            $overrides = is_array($card['manualOverrides'] ?? null) ? $card['manualOverrides'] : [];
            $next = is_array($overrides[$faceKey] ?? null) ? $overrides[$faceKey] : [];
            foreach ($stats as $field => $value) {
                $normalized = PowerToughnessModel::overrideValue($value);
                if ($normalized === null) { unset($next[$field]); } else { $next[$field] = $normalized; }
            }
            if (!array_key_exists('power', $next) && !array_key_exists('toughness', $next)) {
                unset($overrides[$faceKey]);
            } else {
                $next['faceKey'] = $faceKey; $next['faceIndex'] = $faceIndex; $next['provenance'] = 'manual';
                $next['updatedByPlayerId'] = $actorId; $next['updatedAtVersion'] = max(1, (int) ($snapshot['version'] ?? 1)) + 1;
                $overrides[$faceKey] = $next;
            }
            $card['printedStats'] = $printed; $card['manualOverrides'] = $overrides;
            foreach (['power', 'toughness'] as $field) { $card[$field] = PowerToughnessModel::activeAxis($printed, $overrides, $faceIndex, $field); }
            $snapshot['players'][$playerId]['zones']['battlefield'][$cardIndex] = $card;
            $states[] = $this->state($memberId, $card);
        }
        ++$group['revision']; $snapshot['tokenGroups'][$index] = $group;
        $event = $this->effect($actorId, [$group['groupId']], [$group], []);
        $event += ['instanceStates' => $states, 'stats' => $stats, 'quantity' => count($group['orderedMemberIds'])];
        return $this->result('token.group.power_toughness.changed', $event, sprintf('Changed power/toughness for %d tokens.', $event['quantity']), 'gameLog.tokenGroup.powerToughnessChanged', $event);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function changeController(array &$snapshot, array $payload, string $actorId): array
    {
        [$index, $group] = $this->group($snapshot, $payload, 'token.group.controller.changed', $actorId);
        $controllerId = is_string($payload['targetPlayerId'] ?? null) ? trim($payload['targetPlayerId']) : (is_string($payload['controllerId'] ?? null) ? trim($payload['controllerId']) : '');
        if ($controllerId === '' || !isset($snapshot['players'][$controllerId])) { throw $this->error(TokenGroupCanonicalizer::INVARIANT_FAILED, 'token.group.controller.changed'); }
        [, , $root] = $this->card($snapshot, $group['rootInstanceId']);
        if (($root['controllerId'] ?? null) === $controllerId) { throw $this->error(TokenGroupCanonicalizer::PATCH_CONFLICT, 'token.group.controller.changed', ['count' => count($group['orderedMemberIds'])]); }
        $states = [];
        foreach ($group['orderedMemberIds'] as $memberId) {
            [$playerId, $cardIndex, $card] = $this->card($snapshot, $memberId);
            $card['controllerId'] = $controllerId;
            $snapshot['players'][$playerId]['zones']['battlefield'][$cardIndex] = $card;
            $states[] = $this->state($memberId, $card);
        }
        ++$group['revision']; $snapshot['tokenGroups'][$index] = $group;
        $event = $this->effect($actorId, [$group['groupId']], [$group], []);
        $event += ['instanceStates' => $states, 'controllerId' => $controllerId, 'quantity' => count($group['orderedMemberIds'])];
        return $this->result('token.group.controller.changed', $event, sprintf('Changed controller for %d tokens.', $event['quantity']), 'gameLog.tokenGroup.controllerChanged', $event);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function setPosition(array &$snapshot, array $payload, string $actorId): array
    {
        [$index, $group] = $this->group($snapshot, $payload, 'token.group.position.set', $actorId);
        $position = $this->position($payload['position'] ?? null, 'token.group.position.set');
        $this->setCardPositions($snapshot, $group['orderedMemberIds'], $position);
        ++$group['revision']; $snapshot['tokenGroups'][$index] = $group;
        $positions = $this->positionEntries($group['orderedMemberIds'], $position);
        $event = $this->effect($actorId, [$group['groupId']], [$group], $positions); $event['quantity'] = count($group['orderedMemberIds']);

        return $this->result('token.group.position.changed', $event, sprintf('Moved %d tokens.', $event['quantity']), 'gameLog.tokenGroup.moved', $event);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload */
    private function move(array &$snapshot, array $payload, string $actorId): array
    {
        [$index, $group] = $this->group($snapshot, $payload, 'token.group.move', $actorId);
        $toZone = is_string($payload['toZone'] ?? null) ? trim($payload['toZone']) : '';
        if ($toZone === '' || $toZone === 'battlefield') { throw $this->error(TokenGroupCanonicalizer::MERGE_INVALID, 'token.group.move'); }
        array_splice($snapshot['tokenGroups'], $index, 1);
        $this->removeCards($snapshot, $group['orderedMemberIds']);
        $movement = ['playerId' => $actorId, 'fromZone' => 'battlefield', 'toZone' => $toZone, 'instanceIds' => $group['orderedMemberIds'], 'moves' => array_map(static fn (string $id): array => ['instanceId' => $id, 'evaporated' => true], $group['orderedMemberIds'])];
        $event = $this->effect($actorId, [$group['groupId']], [], []); $event += ['quantity' => count($group['orderedMemberIds']), 'movement' => $movement];

        return $this->result('token.group.moved', $event, sprintf('Moved %d tokens.', $event['quantity']), 'gameLog.tokenGroup.zoneMoved', ['count' => $event['quantity'], 'toZone' => $toZone]);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $payload @return array{int,array<string,mixed>} */
    private function group(array $snapshot, array $payload, string $operation, string $actorId): array
    {
        $groupId = is_string($payload['groupId'] ?? null) ? trim($payload['groupId']) : '';
        [$index, $group] = $this->groupById($snapshot, $groupId, $operation);
        $expected = $payload['expectedRevision'] ?? null;
        if (!is_int($expected) || $expected !== $group['revision']) { throw $this->stale($operation, is_int($expected) ? $expected : -1, $group['revision'], count($group['orderedMemberIds'])); }
        $this->authorizeGroup($snapshot, $group, $actorId, $operation);

        return [$index, $group];
    }

    /** @param array<string,mixed> $snapshot @return array{int,array<string,mixed>} */
    private function groupById(array $snapshot, string $groupId, string $operation): array
    {
        foreach ($snapshot['tokenGroups'] as $index => $group) { if ($group['groupId'] === $groupId) { return [$index, $group]; } }
        throw $this->error(TokenGroupCanonicalizer::NOT_FOUND, $operation);
    }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $group */
    private function authorizeGroup(array $snapshot, array $group, string $actorId, string $operation): void { $this->authorizeCards($snapshot, $group['orderedMemberIds'], $actorId, $operation); }
    /** @param array<string,mixed> $snapshot @param list<string> $ids */
    private function authorizeCards(array $snapshot, array $ids, string $actorId, string $operation): void
    {
		$index = $this->battlefieldCardIndex($snapshot);
		foreach ($ids as $id) {
			$entry = $index[$id] ?? null;
			if ($entry === null || (($entry[2]['controllerId'] ?? '') !== $actorId)) { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, $operation, ['count' => count($ids)]); }
		}
    }

    /** @param array<string,mixed> $snapshot @return array{string,int,array<string,mixed>} */
    private function card(array $snapshot, string $instanceId): array
    {
        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            foreach (($player['zones']['battlefield'] ?? []) as $index => $card) {
                if (is_array($card) && ($card['instanceId'] ?? null) === $instanceId) { return [(string) $playerId, $index, $card]; }
            }
        }
        throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, 'card', ['invalidIndex' => -1]);
    }

    /** @param array<string,mixed> $snapshot @param list<string> $ids */
    private function assertCompatible(array $snapshot, array $ids, string $operation): void
    {
        $fingerprint = null;
		$index = $this->battlefieldCardIndex($snapshot);
        foreach ($ids as $id) {
			$entry = $index[$id] ?? null;
			if ($entry === null) { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, $operation, ['count' => count($ids)]); }
			$card = $entry[2];
            if (($card['isToken'] ?? false) !== true) { throw $this->error(TokenGroupCanonicalizer::MERGE_INVALID, $operation); }
            unset($card['instanceId'], $card['position'], $card['x'], $card['y']);
            $current = json_encode($this->canonicalValue($card), JSON_THROW_ON_ERROR);
            if ($fingerprint !== null && $current !== $fingerprint) { throw $this->error(TokenGroupCanonicalizer::MERGE_INVALID, $operation, ['count' => count($ids)]); }
            $fingerprint = $current;
        }
    }

    /** @param array<string,mixed> $snapshot @param list<string> $ids */
    private function assertNoRelationConflicts(array $snapshot, array $ids, string $operation): void
    {
        $members = array_fill_keys($ids, true);
        foreach ($snapshot['arrows'] ?? [] as $arrow) {
            if (is_array($arrow) && (isset($members[(string) ($arrow['fromInstanceId'] ?? '')]) || isset($members[(string) ($arrow['toInstanceId'] ?? '')]))) {
                throw $this->error(TokenGroupCanonicalizer::RELATION_CONFLICT, $operation, ['count' => count($ids)]);
            }
        }
        foreach ($snapshot['attachments'] ?? [] as $attachment) {
            if (is_array($attachment) && (isset($members[(string) ($attachment['equipmentInstanceId'] ?? '')]) || isset($members[(string) ($attachment['attachedToInstanceId'] ?? '')]))) {
                throw $this->error(TokenGroupCanonicalizer::RELATION_CONFLICT, $operation, ['count' => count($ids)]);
            }
        }
        foreach ($snapshot['battlefieldStacks'] ?? [] as $stack) {
            if (!is_array($stack)) { continue; }
            foreach (($stack['orderedMemberIds'] ?? $stack['memberInstanceIds'] ?? []) as $memberId) {
                if (is_string($memberId) && isset($members[$memberId])) {
                    throw $this->error(TokenGroupCanonicalizer::RELATION_CONFLICT, $operation, ['count' => count($ids)]);
                }
            }
        }
    }

    private function canonicalValue(mixed $value): mixed
    {
        if (!is_array($value)) { return $value; }
        if (!array_is_list($value)) { ksort($value, SORT_STRING); }
        foreach ($value as $key => $entry) { $value[$key] = $this->canonicalValue($entry); }
        return $value;
    }

    /** @param array<string,mixed> $snapshot @param list<string> $ids @param array<string,mixed> $position */
    private function setCardPositions(array &$snapshot, array $ids, array $position): void
    {
		$index = $this->battlefieldCardIndex($snapshot);
		foreach ($ids as $id) {
			$entry = $index[$id] ?? null;
			if ($entry === null) { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, 'position', ['invalidIndex' => -1]); }
			[$playerId, $cardIndex, $card] = $entry;
			$card['position'] = $position; $card['x'] = $position['x']; $card['y'] = $position['y'];
			$snapshot['players'][$playerId]['zones']['battlefield'][$cardIndex] = $card;
		}
    }

	/** @param array<string,mixed> $snapshot @return array<string,array{string,int,array<string,mixed>}> */
	private function battlefieldCardIndex(array $snapshot): array
	{
		$index = [];
		foreach ($snapshot['players'] ?? [] as $playerId => $player) {
			foreach (($player['zones']['battlefield'] ?? []) as $cardIndex => $card) {
				if (is_array($card) && is_string($card['instanceId'] ?? null)) { $index[$card['instanceId']] = [(string) $playerId, $cardIndex, $card]; }
			}
		}
		return $index;
	}

	/** @param array<string,mixed> $snapshot @param list<array<string,mixed>> $positions */
	private function setPositionEntries(array &$snapshot, array $positions): void
	{
		$index = $this->battlefieldCardIndex($snapshot);
		foreach ($positions as $entry) {
			$instanceId = (string) ($entry['instanceId'] ?? '');
			$cardEntry = $index[$instanceId] ?? null;
			if ($cardEntry === null) { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, 'token.group.dissolve', ['invalidIndex' => -1]); }
			[$playerId, $cardIndex, $card] = $cardEntry;
			$position = $entry['position'];
			$card['position'] = $position; $card['x'] = $position['x']; $card['y'] = $position['y'];
			$snapshot['players'][$playerId]['zones']['battlefield'][$cardIndex] = $card;
		}
	}

    /** @param array<string,mixed> $snapshot @param list<string> $ids */
    private function removeCards(array &$snapshot, array $ids): void
    {
        $remove = array_fill_keys($ids, true);
        foreach ($snapshot['players'] as &$player) { $player['zones']['battlefield'] = array_values(array_filter($player['zones']['battlefield'] ?? [], static fn (mixed $card): bool => !is_array($card) || !isset($remove[(string) ($card['instanceId'] ?? '')]))); }
        unset($player);
    }

    /** @param array<string,mixed> $group @return array{list<string>,list<string>} */
    private function extract(array $group, int $quantity): array
    {
        $selected = [];
        for ($index = count($group['orderedMemberIds']) - 1; $index >= 0 && count($selected) < $quantity; --$index) { $id = $group['orderedMemberIds'][$index]; if ($id !== $group['rootInstanceId']) { $selected[$id] = true; } }
        if (count($selected) < $quantity) { $selected[$group['rootInstanceId']] = true; }
        $extracted = []; $remaining = [];
        foreach ($group['orderedMemberIds'] as $id) { if (isset($selected[$id])) { $extracted[] = $id; } else { $remaining[] = $id; } }
        return [$extracted, $remaining];
    }

    /** @return array{x:float,y:float,unit:string} */
    private function position(mixed $position, string $operation): array
    {
        if (!is_array($position) || ($position['unit'] ?? null) !== 'ratio' || !is_numeric($position['x'] ?? null) || !is_numeric($position['y'] ?? null)) { throw $this->error(TokenGroupCanonicalizer::INVARIANT_FAILED, $operation); }
        $x = (float) $position['x']; $y = (float) $position['y'];
        if ($x < 0 || $x > 1 || $y < 0 || $y > 1) { throw $this->error(TokenGroupCanonicalizer::INVARIANT_FAILED, $operation); }
        return ['x' => $x, 'y' => $y, 'unit' => 'ratio'];
    }

    /** @param list<string> $ids @param array<string,mixed> $position @return list<array<string,mixed>> */
    private function positionEntries(array $ids, array $position): array { return array_map(static fn (string $id): array => ['instanceId' => $id, 'position' => $position], $ids); }

    /** @param array<string,mixed> $snapshot @param array<string,mixed> $group @return list<array<string,mixed>> */
    private function dissolvePositions(array $snapshot, array $group): array
    {
        [, , $root] = $this->card($snapshot, $group['rootInstanceId']); $rootPosition = $this->position($root['position'] ?? null, 'token.group.dissolve'); $count = count($group['orderedMemberIds']); $result = [];
        foreach ($group['orderedMemberIds'] as $index => $id) { $column = ($index % 5) - (min($count, 5) - 1) / 2; $row = intdiv($index, 5); $result[] = ['instanceId' => $id, 'position' => ['x' => max(0, min(1, $rootPosition['x'] + $column * .035)), 'y' => max(0, min(1, $rootPosition['y'] + $row * .045)), 'unit' => 'ratio']]; }
        return $result;
    }

    /** @param list<string> $members @return list<array<string,mixed>> */
    private function explicitPositions(mixed $raw, array $members, string $operation): array
    {
        if (!is_array($raw) || !array_is_list($raw) || count($raw) !== count($members)) { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, $operation); }
        $result = []; $seen = [];
        foreach ($raw as $entry) { $id = is_array($entry) && is_string($entry['instanceId'] ?? null) ? $entry['instanceId'] : ''; if (!in_array($id, $members, true) || isset($seen[$id])) { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, $operation); } $seen[$id] = true; $result[] = ['instanceId' => $id, 'position' => $this->position($entry['position'] ?? null, $operation)]; }
        return $result;
    }

    /** @param array<string,mixed> $card @return array<string,mixed> */
    private function state(string $instanceId, array $card): array
    {
        return [
            'instanceId' => $instanceId,
            'tapped' => (bool) ($card['tapped'] ?? false),
            'rotation' => (int) ($card['rotation'] ?? 0),
            'faceDown' => (bool) ($card['faceDown'] ?? false),
            'visibleToMask' => 0,
            'revealedTo' => array_values(is_array($card['revealedTo'] ?? null) ? $card['revealedTo'] : []),
            'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
            'mutableStats' => array_filter(['power' => $card['power'] ?? null, 'toughness' => $card['toughness'] ?? null], static fn (mixed $value): bool => $value !== null),
            'manualOverrides' => is_array($card['manualOverrides'] ?? null) ? $card['manualOverrides'] : [],
            'controllerId' => (string) ($card['controllerId'] ?? ''),
        ];
    }

    /** @return list<string> */
    private function stringList(mixed $raw, string $field): array
    {
        if (!is_array($raw) || !array_is_list($raw)) { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, $field); }
        $result = []; foreach ($raw as $value) { if (!is_string($value) || trim($value) === '') { throw $this->error(TokenGroupCanonicalizer::MEMBER_MISMATCH, $field); } $result[] = trim($value); } return $result;
    }

    /** @param list<string> $removed @param list<array<string,mixed>> $groups @param list<array<string,mixed>> $positions @return array<string,mixed> */
    private function effect(string $actorId, array $removed, array $groups, array $positions): array
    {
        $effect = ['effectVersion' => self::EFFECT_VERSION, 'actorPlayerId' => $actorId, 'removedGroupIds' => array_values($removed), 'resultingGroups' => array_values($groups)];
        if ($positions !== []) { $effect['positions'] = $positions; }
        return $effect;
    }

    /** @param array<string,mixed> $event @param array<string,mixed> $params @return array{eventType:string,eventPayload:array<string,mixed>,message:string,log:array<string,mixed>} */
    private function result(string $eventType, array $event, string $message, string $i18nKey, array $params): array { return ['eventType' => $eventType, 'eventPayload' => $event, 'message' => $message, 'log' => ['i18nKey' => $i18nKey, 'i18nParams' => $params]]; }

    /** @param array<string,int|string> $context */
    private function error(string $code, string $operation, array $context = []): TokenGroupContractException { return new TokenGroupContractException($code, ['operation' => $operation, ...$context]); }
    private function stale(string $operation, mixed $expected, int $actual, int $count): TokenGroupContractException { return $this->error(TokenGroupCanonicalizer::STALE, $operation, ['expectedRevision' => is_int($expected) ? $expected : -1, 'actualRevision' => $actual, 'count' => $count]); }
    private function quantityError(string $code, string $operation, mixed $requested, int $min, int $max, int $count): TokenGroupContractException { return $this->error($code, $operation, ['requestedQuantity' => is_int($requested) ? $requested : -1, 'min' => $min, 'max' => $max, 'count' => $count]); }
}
