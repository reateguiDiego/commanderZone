<?php

namespace App\Application\Game\Compact;

final class CompactGameCardStateMapper
{
    public const SNAPSHOT_FORMAT = 'compact-v1';
    private const FORMAT_KEY = 'runtimeFormat';
    private const CATALOG_KEY = 'cardCatalog';

    public function isCompactSnapshot(array $snapshot): bool
    {
        return ($snapshot[self::FORMAT_KEY] ?? null) === self::SNAPSHOT_FORMAT
            && is_array($snapshot[self::CATALOG_KEY] ?? null);
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
                    $snapshot['stack'][$index] = $this->hydrateStackItem($item, $catalog);
                }
            }
        }

        return $snapshot;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    public function compactSnapshot(array $snapshot): array
    {
        if ($this->isCompactSnapshot($snapshot)) {
            $snapshot = $this->hydrateSnapshot($snapshot);
        }

        $catalog = [];

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
                            $cards[$index] = $this->compactCard($card, (string) $playerId, (string) $zone, $catalog);
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
                    $snapshot['stack'][$index] = $this->compactStackItem($item, $catalog);
                }
            }
        }

        $snapshot[self::FORMAT_KEY] = self::SNAPSHOT_FORMAT;
        $snapshot[self::CATALOG_KEY] = $catalog;

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
        if (isset($card['cardKey']) && is_string($card['cardKey']) && trim($card['cardKey']) !== '') {
            return $card;
        }

        $bundle = CardStaticBundle::fromLegacyCard($card);
        $catalog[$bundle->cardKey] = $bundle->toArray();

        return CardInstanceRuntime::fromLegacyCard($card, $bundle->cardKey, $ownerId, $zone)->toArray();
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
            'position' => is_array($card['position'] ?? null) ? $card['position'] : ['x' => 0, 'y' => 0],
            'rotation' => max(0, (int) ($card['rotation'] ?? 0)),
            'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
            'zone' => (string) ($card['zone'] ?? $zone),
            'isToken' => (bool) ($card['isToken'] ?? false),
            'isTokenCopy' => (bool) ($tokenMeta['isCopy'] ?? false),
            'isCommander' => (bool) ($card['isCommander'] ?? $zone === 'command'),
        ];

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

    /**
     * @param array<string,mixed>               $item
     * @param array<string,array<string,mixed>> $catalog
     *
     * @return array<string,mixed>
     */
    private function hydrateStackItem(array $item, array $catalog): array
    {
        if (($item['kind'] ?? null) !== 'card' || !is_array($item['card'] ?? null)) {
            return $item;
        }

        $item['card'] = $this->hydrateCard($item['card'], $catalog, (string) ($item['card']['ownerId'] ?? ''), (string) ($item['card']['zone'] ?? ''));

        return $item;
    }

    /**
     * @param array<string,mixed>                 $item
     * @param array<string,array<string,mixed>>   $catalog
     *
     * @return array<string,mixed>
     */
    private function compactStackItem(array $item, array &$catalog): array
    {
        if (($item['kind'] ?? null) !== 'card' || !is_array($item['card'] ?? null)) {
            return $item;
        }

        $card = $item['card'];
        $item['card'] = $this->compactCard(
            $card,
            (string) ($card['ownerId'] ?? ''),
            (string) ($card['zone'] ?? ''),
            $catalog,
        );

        return $item;
    }
}
