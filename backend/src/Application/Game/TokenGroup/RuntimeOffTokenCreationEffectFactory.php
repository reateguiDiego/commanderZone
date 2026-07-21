<?php

namespace App\Application\Game\TokenGroup;

final class RuntimeOffTokenCreationEffectFactory
{
    public function __construct(private readonly TokenGroupCanonicalizer $tokenGroups = new TokenGroupCanonicalizer())
    {
    }

    /**
     * @param array<string,mixed>                 $card
     * @param array{x:float,y:float,unit:string}  $position
     *
     * @return array{tokens:list<array<string,mixed>>,tokenGroup:?array<string,mixed>,eventPayload:array<string,mixed>}
     */
    public function create(
        string $gameId,
        string $clientActionId,
        string $playerId,
        int $createdAtVersion,
        int $quantity,
        string $name,
        array $card,
        array $position,
    ): array {
        $cardKey = $this->cardKey($card, $name);
        $printId = $this->nonEmptyString($card['printId'] ?? null)
            ?: ($this->nonEmptyString($card['scryfallId'] ?? null) ?: $cardKey);
        $cardVersion = $this->nonEmptyString($card['cardVersion'] ?? null) ?: 'runtime-identity-v1';
        $language = $this->nonEmptyString($card['language'] ?? null) ?: 'en';
        $generic = $card === [];
        $power = $this->compactStat($card['power'] ?? null, $generic ? 1 : null);
        $toughness = $this->compactStat($card['toughness'] ?? null, $generic ? 1 : null);
        $loyalty = $this->compactStat($card['loyalty'] ?? null, null);
        $mutableStats = array_filter([
            'power' => $power,
            'toughness' => $toughness,
            'loyalty' => $loyalty,
        ], static fn (mixed $value): bool => $value !== null);
        $printedStats = $this->printedStats($card, $power, $toughness);
        $tokenMeta = [
            'isCopy' => false,
            'templateCardKey' => $this->nonEmptyString($card['cardKey'] ?? null),
            'templateCardVersion' => $this->nonEmptyString($card['cardVersion'] ?? null),
            'templateScryfallId' => $this->nonEmptyString($card['scryfallId'] ?? null),
            'mutableOverrides' => [
                'power' => $power,
                'toughness' => $toughness,
                'loyalty' => $loyalty,
            ],
            'flags' => [
                'isDungeon' => str_contains(strtolower($this->nonEmptyString($card['typeLine'] ?? null)), 'dungeon'),
                'isEmblem' => str_contains(strtolower($this->nonEmptyString($card['typeLine'] ?? null)), 'emblem'),
            ],
        ];

        $tokens = [];
        $instanceIds = [];
        for ($index = 0; $index < $quantity; $index++) {
            $instanceId = $this->tokenGroups->deterministicInstanceId($clientActionId, $index);
            $instanceIds[] = $instanceId;
            $token = [
                'instanceId' => $instanceId,
                'ownerId' => $playerId,
                'ownerPlayerId' => $playerId,
                'controllerId' => $playerId,
                'controllerPlayerId' => $playerId,
                'name' => $name,
                'cardKey' => $cardKey,
                'printId' => $printId,
                'cardVersion' => $cardVersion,
                'language' => $language,
                'viewerVisibility' => 'public',
                'zone' => 'battlefield',
                'isToken' => true,
                'isTokenCopy' => false,
                'tokenMeta' => $tokenMeta,
                'position' => $position,
                'counters' => [],
                'tapped' => false,
                'rotation' => 0,
                'faceDown' => false,
                'activeFace' => 0,
                'activeFaceIndex' => 0,
                'mutableStats' => $mutableStats,
                'printedStats' => $printedStats,
                // Go encodes an absent nested override map as null in final
                // effects. Replay normalizes it to the canonical empty map in
                // state, while the persisted effect remains cross-runtime exact.
                'manualOverrides' => null,
            ];
            foreach ($mutableStats as $axis => $value) {
                $token[$axis] = $value;
            }
            $tokens[] = $token;
        }

        $tokenGroup = null;
        if ($quantity > 1) {
            $tokenGroup = $this->tokenGroups->normalizeCanonical([
                'groupId' => $this->tokenGroups->deterministicGroupId($gameId, $clientActionId),
                'rootInstanceId' => $instanceIds[0],
                'orderedMemberIds' => $instanceIds,
                'revision' => 1,
                'createdByPlayerId' => $playerId,
                'createdAtVersion' => $createdAtVersion,
                'effectVersion' => TokenGroupCanonicalizer::EFFECT_VERSION,
            ], $instanceIds, $playerId, $createdAtVersion, true);
        }

        $eventPayload = [
            'effectVersion' => TokenGroupCanonicalizer::CREATE_EFFECT_VERSION,
            'actorPlayerId' => $playerId,
            'playerId' => $playerId,
            'instanceIds' => $instanceIds,
            'count' => $quantity,
            'cardKey' => $cardKey,
            'name' => $name,
            'tokens' => $tokens,
            'tokenMeta' => $tokenMeta,
            'staticCards' => $this->staticCards($cardKey, $printId, $cardVersion, $language, $name, $card, $power, $toughness, $loyalty),
        ];
        if ($tokenGroup !== null) {
            $eventPayload['tokenGroup'] = $tokenGroup;
        }

        return ['tokens' => $tokens, 'tokenGroup' => $tokenGroup, 'eventPayload' => $eventPayload];
    }

    /** @param array<string,mixed> $card */
    private function cardKey(array $card, string $name): string
    {
        if (($cardKey = $this->nonEmptyString($card['cardKey'] ?? null)) !== '') {
            return $cardKey;
        }
        if (($scryfallId = $this->nonEmptyString($card['scryfallId'] ?? null)) !== '') {
            return $scryfallId.':token';
        }
        $slug = preg_replace('/[^a-z0-9_-]+/', '', strtolower(trim($name))) ?? '';

        return 'token:'.($slug !== '' ? $slug : 'action');
    }

    /**
     * @param array<string,mixed> $card
     * @return array<string,array<string,mixed>>
     */
    private function staticCards(
        string $cardKey,
        string $printId,
        string $cardVersion,
        string $language,
        string $name,
        array $card,
        mixed $power,
        mixed $toughness,
        mixed $loyalty,
    ): array {
        return [$cardKey => [
            'cardRef' => $cardKey,
            'cardKey' => $cardKey,
            'printId' => $printId,
            'cardVersion' => $cardVersion,
            'language' => $language,
            'viewerVisibility' => 'public',
            'scryfallId' => $this->nonEmptyString($card['scryfallId'] ?? null) ?: null,
            'name' => $name,
            'imageUris' => is_array($card['imageUris'] ?? null) && $card['imageUris'] !== [] ? $card['imageUris'] : null,
            'cardFaces' => is_array($card['cardFaces'] ?? null) ? array_values($card['cardFaces']) : [],
            'typeLine' => $this->nonEmptyString($card['typeLine'] ?? null) ?: null,
            'manaCost' => $this->nonEmptyString($card['manaCost'] ?? null) ?: null,
            'colorIdentity' => is_array($card['colorIdentity'] ?? null) ? array_values($card['colorIdentity']) : [],
            'defaultPower' => $power,
            'defaultToughness' => $toughness,
            'defaultLoyalty' => $loyalty,
            'defaultDefense' => $this->compactStat($card['defense'] ?? null, null),
            'hasRulings' => ($card['hasRulings'] ?? false) === true,
        ]];
    }

    private function nonEmptyString(mixed $value): string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : '';
    }

    private function compactStat(mixed $value, mixed $fallback): mixed
    {
        if (is_string($value)) {
            return trim($value) !== '' ? $value : $fallback;
        }
        if (is_int($value) || is_float($value)) {
            return $value;
        }

        return $value === null ? $fallback : $value;
    }

    /**
     * @param array<string,mixed> $card
     * @return array<string,array<string,mixed>>
     */
    private function printedStats(array $card, mixed $fallbackPower, mixed $fallbackToughness): array
    {
        $faces = is_array($card['cardFaces'] ?? null)
            ? array_values(array_filter($card['cardFaces'], static fn (mixed $face): bool => is_array($face)))
            : [];
        if ($faces === []) {
            return ['0' => [
                'faceKey' => '0',
                'faceIndex' => 0,
                'power' => $fallbackPower,
                'toughness' => $fallbackToughness,
                'provenance' => 'token_creation',
            ]];
        }

        $printed = [];
        foreach ($faces as $index => $face) {
            $key = (string) $index;
            $printed[$key] = [
                'faceKey' => $key,
                'faceIndex' => $index,
                'power' => $this->compactStat($face['power'] ?? null, null),
                'toughness' => $this->compactStat($face['toughness'] ?? null, null),
                'provenance' => 'token_creation',
            ];
        }

        return $printed;
    }
}
