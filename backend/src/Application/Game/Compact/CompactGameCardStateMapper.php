<?php

namespace App\Application\Game\Compact;

final class CompactGameCardStateMapper
{
    public const SNAPSHOT_FORMAT = 'compact-v2';
    private const LEGACY_COMPACT_FORMAT = 'compact-v1';
    private const FORMAT_KEY = 'runtimeFormat';
    private const CATALOG_KEY = 'cardCatalog';
    private const STRUCTURED_KEYS = ['instances', 'zones', 'loc', 'relations', 'stack'];

    public function isCompactSnapshot(array $snapshot): bool
    {
        $format = $snapshot[self::FORMAT_KEY] ?? null;

        return in_array($format, [self::SNAPSHOT_FORMAT, self::LEGACY_COMPACT_FORMAT], true)
            && is_array($snapshot[self::CATALOG_KEY] ?? null);
    }

    public function isStructuredCompactSnapshot(array $snapshot): bool
    {
        if (!$this->isCompactSnapshot($snapshot)) {
            return false;
        }

        foreach (self::STRUCTURED_KEYS as $key) {
            if (!array_key_exists($key, $snapshot)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    public function hydrateSnapshot(array $snapshot): array
    {
        if (!$this->isCompactSnapshot($snapshot)) {
            return $snapshot;
        }

        if (!$this->isStructuredCompactSnapshot($snapshot)) {
            return $this->hydrateLegacyCompactSnapshot($snapshot);
        }

        $catalog = is_array($snapshot[self::CATALOG_KEY] ?? null) ? $snapshot[self::CATALOG_KEY] : [];
        $players = is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [];
        $zones = is_array($snapshot['zones'] ?? null) ? $snapshot['zones'] : [];
        $instances = is_array($snapshot['instances'] ?? null) ? $snapshot['instances'] : [];
        $loc = is_array($snapshot['loc'] ?? null) ? $snapshot['loc'] : [];
        $relations = is_array($snapshot['relations'] ?? null) ? $snapshot['relations'] : [];

        $legacy = $snapshot;
        unset(
            $legacy[self::FORMAT_KEY],
            $legacy[self::CATALOG_KEY],
            $legacy['gameId'],
            $legacy['status'],
            $legacy['instances'],
            $legacy['zones'],
            $legacy['loc'],
            $legacy['visibility'],
            $legacy['relations']
        );
        $legacy['visibility'] = is_array($snapshot['visibility'] ?? null) ? $snapshot['visibility'] : [];

        $legacy['players'] = [];
        foreach ($players as $playerId => $player) {
            if (!is_array($player)) {
                continue;
            }

            $playerZones = [
                'library' => [],
                'hand' => [],
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ];

            foreach ($playerZones as $zone => $_) {
                $playerZones[$zone] = $this->hydrateZone(
                    (string) $playerId,
                    $zone,
                    is_array($zones[$playerId][$zone] ?? null) ? $zones[$playerId][$zone] : [],
                    $instances,
                    $catalog,
                    $loc,
                );
            }

            $legacy['players'][$playerId] = [
                ...$player,
                'zones' => $playerZones,
            ];
        }

        $legacy['stack'] = $this->hydrateStructuredStack(
            is_array($snapshot['stack'] ?? null) ? $snapshot['stack'] : [],
            $instances,
            $catalog,
            $loc,
        );
        $legacy['attachments'] = array_values(is_array($relations['attachments'] ?? null) ? $relations['attachments'] : []);
        $legacy['arrows'] = array_values(is_array($relations['arrows'] ?? null) ? $relations['arrows'] : []);
        $legacy['specialEntities'] = array_values(is_array($relations['helpers'] ?? null) ? $relations['helpers'] : []);

        return $legacy;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    public function compactSnapshot(array $snapshot, ?string $gameId = null, ?string $status = null): array
    {
        if ($this->isCompactSnapshot($snapshot)) {
            $snapshot = $this->hydrateSnapshot($snapshot);
        }

        $catalog = [];
        $instances = [];
        $zones = [];
        $loc = [];
        $players = [];
        $visibilityInstances = is_array($snapshot['visibility']['instances'] ?? null) ? $snapshot['visibility']['instances'] : [];

        foreach (is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [] as $playerId => $player) {
            if (!is_array($player)) {
                continue;
            }

            $players[$playerId] = $player;
            unset($players[$playerId]['zones'], $players[$playerId]['zoneCounts'], $players[$playerId]['handCount']);

            $zones[$playerId] = [
                'library' => [],
                'hand' => [],
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ];

            foreach (['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] as $zone) {
                foreach (is_array($player['zones'][$zone] ?? null) ? $player['zones'][$zone] : [] as $index => $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $runtime = $this->compactCard($card, (string) $playerId, $zone, $catalog);
                    $instanceId = (string) ($runtime['instanceId'] ?? '');
                    if ($instanceId === '') {
                        continue;
                    }
                    if (is_array($visibilityInstances[$instanceId] ?? null)) {
                        $runtime['visibleToMask'] = max(0, (int) ($visibilityInstances[$instanceId]['mask'] ?? 0));
                    }

                    $instances[$instanceId] = $runtime;
                    $zones[$playerId][$zone][] = $instanceId;
                    $loc[$instanceId] = [
                        'playerId' => (string) $playerId,
                        'zone' => $zone,
                        'index' => count($zones[$playerId][$zone]) - 1,
                    ];
                }
            }
        }

        $attachments = $this->indexById(is_array($snapshot['attachments'] ?? null) ? $snapshot['attachments'] : []);
        $arrows = $this->indexById(is_array($snapshot['arrows'] ?? null) ? $snapshot['arrows'] : []);
        $relations = [
            'attachments' => $attachments,
            'arrows' => $arrows,
            'helpers' => $this->indexById(is_array($snapshot['specialEntities'] ?? null) ? $snapshot['specialEntities'] : []),
            'indexes' => [
                'attachmentsByEquipment' => $this->relationIdsByField($attachments, 'equipmentInstanceId'),
                'attachmentsByTarget' => $this->relationIdsByField($attachments, 'attachedToInstanceId'),
                'arrowsBySource' => $this->relationIdsByField($arrows, 'fromInstanceId'),
                'arrowsByTarget' => $this->relationIdsByField($arrows, 'toInstanceId'),
            ],
        ];
        $stack = $this->compactStructuredStack(
            is_array($snapshot['stack'] ?? null) ? $snapshot['stack'] : [],
            $instances,
            $catalog,
            $loc,
        );

        return (new CompactGameState(
            $gameId ?? (is_string($snapshot['gameId'] ?? null) ? $snapshot['gameId'] : null),
            max(1, (int) ($snapshot['version'] ?? 1)),
            is_string($status) && trim($status) !== ''
                ? $status
                : (is_string($snapshot['status'] ?? null) && trim($snapshot['status']) !== '' ? $snapshot['status'] : 'active'),
            $players,
            is_array($snapshot['turn'] ?? null) ? $snapshot['turn'] : [],
            $instances,
            $zones,
            $loc,
            is_array($snapshot['visibility'] ?? null) && $snapshot['visibility'] !== []
                ? $snapshot['visibility']
                : [
                    'strategy' => 'legacy_revealed_to',
                    'ready' => false,
                    'byViewer' => [],
                ],
            $relations,
            $stack,
            $catalog,
            $this->compactExtraFields($snapshot),
        ))->toArray();
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    public function withGameMetadata(array $snapshot, string $gameId, string $status): array
    {
        if (!$this->isCompactSnapshot($snapshot)) {
            return $snapshot;
        }

        if (!$this->isStructuredCompactSnapshot($snapshot)) {
            return $this->compactSnapshot($this->hydrateSnapshot($snapshot), $gameId, $status);
        }

        $snapshot['gameId'] = $gameId;
        $snapshot['status'] = $status;

        return $snapshot;
    }

    /**
     * @param array<string,mixed>                 $card
     * @param array<string,array<string,mixed>>   $catalog
     *
     * @return array<string,mixed>
     */
    private function compactCard(array $card, string $ownerId, string $zone, array &$catalog): array
    {
        $providedCardKey = $this->cardIdentityKey($card);
        if ($providedCardKey !== null && !$this->cardCarriesStaticPayload($card)) {
            return $card;
        }

        $bundle = CardStaticBundle::fromLegacyCard($card);
        $cardKey = $providedCardKey ?? $bundle->cardKey;
        $catalog[$cardKey] = $this->catalogCard($bundle, $card, $cardKey);
        $runtime = CardInstanceRuntime::fromLegacyCard($card, $cardKey, $ownerId, $zone)->toArray();
        if (($runtime['isToken'] ?? false) === true && is_array($runtime['tokenMeta'] ?? null)) {
            $runtime['tokenMeta']['templateCardKey'] ??= $cardKey;
            $runtime['tokenMeta']['templateCardVersion'] ??= $catalog[$cardKey]['cardVersion'] ?? $bundle->cardVersion;
            if (($runtime['tokenMeta']['isCopy'] ?? false) === true && !isset($runtime['tokenMeta']['copiedFromCardKey'])) {
                $runtime['tokenMeta']['copiedFromCardKey'] = $cardKey;
            }
        }

        return $runtime;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardIdentityKey(array $card): ?string
    {
        foreach (['cardKey', 'cardRef'] as $field) {
            if (is_string($card[$field] ?? null) && trim((string) $card[$field]) !== '') {
                return trim((string) $card[$field]);
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardCarriesStaticPayload(array $card): bool
    {
        foreach (['scryfallId', 'name', 'typeLine', 'manaCost', 'oracleText', 'layout'] as $field) {
            if (is_string($card[$field] ?? null) && trim((string) $card[$field]) !== '') {
                return true;
            }
        }

        foreach (['imageUris', 'cardFaces', 'colorIdentity'] as $field) {
            if (is_array($card[$field] ?? null) && $card[$field] !== []) {
                return true;
            }
        }

        foreach (['defaultPower', 'defaultToughness', 'defaultLoyalty', 'defaultDefense', 'hasRulings'] as $field) {
            if (array_key_exists($field, $card)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array<string,mixed>
     */
    private function catalogCard(CardStaticBundle $bundle, array $card, string $cardKey): array
    {
        $catalogCard = $bundle->toArray();
        $catalogCard['cardKey'] = $cardKey;
        if (is_string($card['cardVersion'] ?? null) && trim((string) $card['cardVersion']) !== '') {
            $catalogCard['cardVersion'] = trim((string) $card['cardVersion']);
        }

        return $catalogCard;
    }

    /**
     * @param array<string,mixed>               $card
     * @param array<string,array<string,mixed>> $catalog
     *
     * @return array<string,mixed>
     */
    private function hydrateCard(array $card, array $catalog, string $ownerId, string $zone): array
    {
        $cardKey = is_string($card['cardKey'] ?? null) ? $card['cardKey'] : '';
        if ($cardKey === '' || !isset($catalog[$cardKey]) || !is_array($catalog[$cardKey])) {
            return $card;
        }

        $bundle = CardStaticBundle::fromArray($catalog[$cardKey]);
        $mutableStats = is_array($card['mutableStats'] ?? null) ? $card['mutableStats'] : [];
        $tokenMeta = is_array($card['tokenMeta'] ?? null) ? $card['tokenMeta'] : [];
        $layout = $bundle->layoutMetadata['layout'] ?? null;
        $preserveIdentity = $this->zoneCarriesPublicIdentity((string) ($card['zone'] ?? $zone));

        $hydrated = [
            'instanceId' => (string) ($card['instanceId'] ?? ''),
            'ownerId' => (string) ($card['ownerId'] ?? $ownerId),
            'controllerId' => (string) ($card['controllerId'] ?? $ownerId),
            'scryfallId' => $bundle->scryfallId ?? '',
            'name' => $bundle->name,
            'imageUris' => $bundle->imageUris,
            'cardFaces' => $bundle->cardFaces,
            'hasRulings' => (bool) ($bundle->layoutMetadata['hasRulings'] ?? false),
            'typeLine' => $bundle->typeLine,
            'manaCost' => $bundle->manaCost,
            'oracleText' => $bundle->oracleText,
            'colorIdentity' => $bundle->colorIdentity,
            'power' => $mutableStats['power'] ?? $bundle->baseStats['power'],
            'toughness' => $mutableStats['toughness'] ?? $bundle->baseStats['toughness'],
            'loyalty' => $mutableStats['loyalty'] ?? $bundle->baseStats['loyalty'],
            'defense' => $mutableStats['defense'] ?? $bundle->baseStats['defense'],
            'defaultPower' => $bundle->baseStats['power'],
            'defaultToughness' => $bundle->baseStats['toughness'],
            'defaultLoyalty' => $bundle->baseStats['loyalty'],
            'defaultDefense' => $bundle->baseStats['defense'],
            'tapped' => (bool) ($card['tapped'] ?? false),
            'faceDown' => (bool) ($card['faceDown'] ?? false),
            'activeFaceIndex' => max(0, (int) ($card['activeFace'] ?? 0)),
            'revealedTo' => is_array($card['visibleTo'] ?? null) ? array_values($card['visibleTo']) : [],
            'visibleToMask' => max(0, (int) ($card['visibleToMask'] ?? 0)),
            'position' => is_array($card['position'] ?? null) ? $card['position'] : null,
            'rotation' => max(0, (int) ($card['rotation'] ?? 0)),
            'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
            'zone' => (string) ($card['zone'] ?? $zone),
            'isToken' => (bool) ($card['isToken'] ?? false),
            'isTokenCopy' => (bool) ($tokenMeta['isCopy'] ?? false),
            'isCommander' => (bool) ($card['isCommander'] ?? $zone === 'command'),
        ];
        if ($tokenMeta !== []) {
            $hydrated['tokenMeta'] = $tokenMeta;
        }
        if ($preserveIdentity) {
            $hydrated['cardVersion'] = $bundle->cardVersion;
        }

        if (is_string($layout) && trim($layout) !== '') {
            $hydrated['layout'] = $layout;
        }
        if (array_key_exists('saga', $mutableStats)) {
            $hydrated['saga'] = $mutableStats['saga'];
        }
        if (is_array($card['dungeonMarker'] ?? null)) {
            $hydrated['dungeonMarker'] = $card['dungeonMarker'];
        }

        return $hydrated;
    }

    private function zoneCarriesPublicIdentity(string $zone): bool
    {
        return !in_array($zone, ['hand', 'library'], true);
    }

    /**
     * @param array<string,mixed>               $snapshot
     *
     * @return array<string,mixed>
     */
    private function hydrateLegacyCompactSnapshot(array $snapshot): array
    {
        $catalog = is_array($snapshot[self::CATALOG_KEY] ?? null) ? $snapshot[self::CATALOG_KEY] : [];
        unset($snapshot[self::FORMAT_KEY], $snapshot[self::CATALOG_KEY]);

        if (isset($snapshot['players']) && is_array($snapshot['players'])) {
            foreach ($snapshot['players'] as $playerId => &$player) {
                if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                    continue;
                }

                foreach ($player['zones'] as $zone => &$cards) {
                    if (!is_array($cards)) {
                        continue;
                    }

                    foreach ($cards as $index => $card) {
                        if (is_array($card)) {
                            $cards[$index] = $this->hydrateCard($card, $catalog, (string) $playerId, (string) $zone);
                        }
                    }
                }
                unset($cards);
            }
            unset($player);
        }

        if (isset($snapshot['stack']) && is_array($snapshot['stack'])) {
            foreach ($snapshot['stack'] as $index => $item) {
                if (is_array($item)) {
                    $snapshot['stack'][$index] = $this->hydrateLegacyStackItem($item, $catalog);
                }
            }
        }

        return $snapshot;
    }

    /**
     * @param list<string> $instanceIds
     * @param array<string,array<string,mixed>> $instances
     * @param array<string,array<string,mixed>> $catalog
     * @param array<string,array{playerId:string,zone:string,index:int}> $loc
     *
     * @return list<array<string,mixed>>
     */
    private function hydrateZone(string $playerId, string $zone, array $instanceIds, array $instances, array $catalog, array $loc): array
    {
        $cards = [];
        foreach ($instanceIds as $instanceId) {
            if (!is_string($instanceId) || !isset($instances[$instanceId]) || !is_array($instances[$instanceId])) {
                continue;
            }

            $location = is_array($loc[$instanceId] ?? null) ? $loc[$instanceId] : [];
            $cards[] = $this->hydrateCard(
                $instances[$instanceId],
                $catalog,
                (string) ($location['playerId'] ?? $playerId),
                (string) ($location['zone'] ?? $zone),
            );
        }

        return $cards;
    }

    /**
     * @param list<array<string,mixed>> $items
     * @param array<string,array<string,mixed>> $instances
     * @param array<string,array<string,mixed>> $catalog
     * @param array<string,array{playerId:string,zone:string,index:int}> $loc
     *
     * @return list<array<string,mixed>>
     */
    private function hydrateStructuredStack(array $items, array $instances, array $catalog, array $loc): array
    {
        $hydrated = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            if (($item['kind'] ?? null) !== 'card') {
                $hydrated[] = $item;
                continue;
            }

            $instanceId = is_string($item['sourceInstanceId'] ?? null)
                ? $item['sourceInstanceId']
                : (is_string($item['instanceId'] ?? null) ? $item['instanceId'] : '');
            if ($instanceId === '' || !isset($instances[$instanceId]) || !is_array($instances[$instanceId])) {
                $hydrated[] = $item;
                continue;
            }

            $location = is_array($loc[$instanceId] ?? null) ? $loc[$instanceId] : [];
            $card = $this->hydrateCard(
                $instances[$instanceId],
                $catalog,
                (string) ($location['playerId'] ?? ($instances[$instanceId]['ownerId'] ?? '')),
                (string) ($location['zone'] ?? ($instances[$instanceId]['zone'] ?? '')),
            );
            $hydrated[] = [
                ...$item,
                'id' => $item['stackId'] ?? $item['id'] ?? null,
                'stackId' => $item['stackId'] ?? $item['id'] ?? null,
                'sourceInstanceId' => $instanceId,
                'instanceId' => $instanceId,
                'controllerId' => $item['controllerId'] ?? ($card['controllerId'] ?? null),
                'cardKey' => $item['cardKey'] ?? ($instances[$instanceId]['cardKey'] ?? null),
                'card' => $card,
            ];
        }

        return $hydrated;
    }

    /**
     * @param list<array<string,mixed>> $items
     * @param array<string,array<string,mixed>> $instances
     * @param array<string,array<string,mixed>> $catalog
     * @param array<string,array{playerId:string,zone:string,index:int}> $loc
     *
     * @return list<array<string,mixed>>
     */
    private function compactStructuredStack(array $items, array &$instances, array &$catalog, array &$loc): array
    {
        $stack = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            if (($item['kind'] ?? null) !== 'card') {
                $stack[] = $item;
                continue;
            }

            $card = is_array($item['card'] ?? null) ? $item['card'] : null;
            $instanceId = is_string($item['sourceInstanceId'] ?? null)
                ? $item['sourceInstanceId']
                : (is_string($item['instanceId'] ?? null) ? $item['instanceId'] : '');
            $cardKey = is_string($item['cardKey'] ?? null) ? $item['cardKey'] : '';
            $controllerId = is_string($item['controllerId'] ?? null) ? $item['controllerId'] : '';
            if ($card !== null) {
                $runtime = $this->compactCard(
                    $card,
                    (string) ($card['ownerId'] ?? ''),
                    (string) ($card['zone'] ?? ''),
                    $catalog,
                );
                $instanceId = (string) ($runtime['instanceId'] ?? $instanceId);
                $cardKey = (string) ($runtime['cardKey'] ?? $cardKey);
                $controllerId = (string) ($runtime['controllerId'] ?? $controllerId);
                if ($instanceId !== '' && !isset($instances[$instanceId])) {
                    $instances[$instanceId] = $runtime;
                    $loc[$instanceId] = [
                        'playerId' => (string) ($runtime['ownerId'] ?? ''),
                        'zone' => 'stack',
                        'index' => 0,
                    ];
                }
            }

            $stack[] = [
                'stackId' => $item['stackId'] ?? $item['id'] ?? null,
                'id' => $item['id'] ?? null,
                'kind' => 'card',
                'sourceInstanceId' => $instanceId,
                'instanceId' => $instanceId,
                'cardKey' => $cardKey !== '' ? $cardKey : null,
                'controllerId' => $controllerId !== '' ? $controllerId : null,
                'text' => is_string($item['text'] ?? null) && trim((string) $item['text']) !== ''
                    ? trim((string) $item['text'])
                    : null,
                'createdAt' => $item['createdAt'] ?? null,
            ];
        }

        return $stack;
    }

    /**
     * @param array<string,mixed>               $item
     * @param array<string,array<string,mixed>> $catalog
     *
     * @return array<string,mixed>
     */
    private function hydrateLegacyStackItem(array $item, array $catalog): array
    {
        if (($item['kind'] ?? null) !== 'card' || !is_array($item['card'] ?? null)) {
            return $item;
        }

        $item['card'] = $this->hydrateCard($item['card'], $catalog, (string) ($item['card']['ownerId'] ?? ''), (string) ($item['card']['zone'] ?? ''));

        return $item;
    }

    /**
     * @param list<array<string,mixed>> $items
     *
     * @return array<string,array<string,mixed>>
     */
    private function indexById(array $items): array
    {
        $indexed = [];
        foreach ($items as $index => $item) {
            if (!is_array($item)) {
                continue;
            }

            $id = is_string($item['id'] ?? null) && trim($item['id']) !== ''
                ? $item['id']
                : sprintf('index-%d', $index);
            $indexed[$id] = $item;
        }

        return $indexed;
    }

    /**
     * @param array<string,array<string,mixed>> $relations
     *
     * @return array<string,list<string>>
     */
    private function relationIdsByField(array $relations, string $field): array
    {
        $indexed = [];
        foreach ($relations as $id => $relation) {
            if (!is_array($relation)) {
                continue;
            }

            $instanceId = is_string($relation[$field] ?? null) ? trim((string) $relation[$field]) : '';
            if ($instanceId === '') {
                continue;
            }

            $indexed[$instanceId] ??= [];
            $indexed[$instanceId][] = (string) $id;
        }

        return $indexed;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function compactExtraFields(array $snapshot): array
    {
        $extra = [
            'ownerId' => $snapshot['ownerId'] ?? '',
            'gamePhase' => $snapshot['gamePhase'] ?? 'PLAYING',
            'mulligan' => is_array($snapshot['mulligan'] ?? null) ? $snapshot['mulligan'] : [],
            'timer' => is_array($snapshot['timer'] ?? null) ? $snapshot['timer'] : [],
            'createdAt' => $snapshot['createdAt'] ?? null,
            'updatedAt' => $snapshot['updatedAt'] ?? null,
        ];
        if (array_key_exists('chat', $snapshot)) {
            $extra['chat'] = is_array($snapshot['chat'] ?? null) ? $snapshot['chat'] : [];
        }
        if (array_key_exists('eventLog', $snapshot)) {
            $extra['eventLog'] = is_array($snapshot['eventLog'] ?? null) ? $snapshot['eventLog'] : [];
        }

        return $extra;
    }
}
