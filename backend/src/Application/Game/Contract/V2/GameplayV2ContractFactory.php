<?php

namespace App\Application\Game\Contract\V2;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Localization\LanguageCatalog;
use App\Domain\User\User;

final class GameplayV2ContractFactory
{
    private const RULES_VERSION = 'commanderzone-manual-v1';
    private const CARD_CATALOG_VERSION = 'legacy-snapshot-v1';

    /**
     * @param array<string,mixed> $command
     */
    public function commandFromLegacyPayload(string $gameId, array $command): CommandEnvelopeV2
    {
        return CommandEnvelopeV2::fromArray([
            'gameId' => $gameId,
            'baseVersion' => $command['baseVersion'] ?? null,
            'clientActionId' => $command['clientActionId'] ?? null,
            'type' => $command['type'] ?? null,
            'payload' => array_key_exists('payload', $command) && $command['payload'] !== null ? $command['payload'] : [],
            'sentAt' => $command['sentAt'] ?? null,
            'client' => $command['client'] ?? null,
        ]);
    }

    /**
     * @param array<string,mixed> $message
     */
    public function commandFromWebsocketMessage(array $message): CommandEnvelopeV2
    {
        return CommandEnvelopeV2::fromArray([
            'gameId' => $message['gameId'] ?? null,
            'baseVersion' => $message['baseVersion'] ?? null,
            'clientActionId' => $message['clientActionId'] ?? null,
            'type' => $message['type'] ?? null,
            'payload' => array_key_exists('payload', $message) && $message['payload'] !== null ? $message['payload'] : [],
            'sentAt' => $message['sentAt'] ?? null,
            'client' => $message['client'] ?? null,
        ]);
    }

    /**
     * @param list<array<string,mixed>> $ops
     */
    public function patchForViewer(
        string $gameId,
        int $version,
        string $viewerId,
        array $ops,
        ?string $ackClientActionId = null,
    ): PatchEnvelopeV2 {
        return $this->patchForVisibility(
            $gameId,
            $version,
            sprintf('player:%s', $viewerId),
            $ops,
            $ackClientActionId,
        );
    }

    /**
     * @param list<array<string,mixed>> $ops
     */
    public function patchForVisibility(
        string $gameId,
        int $version,
        string $visibility,
        array $ops,
        ?string $ackClientActionId = null,
    ): PatchEnvelopeV2 {
        return PatchEnvelopeV2::fromArray([
            'gameId' => $gameId,
            'version' => $version,
            'visibility' => $visibility,
            'ops' => $ops,
            'ackClientActionId' => $ackClientActionId,
        ]);
    }

    public function event(Game $game, GameEvent $event, int $version): EventPayloadV2
    {
        $data = $event->toArray();

        return EventPayloadV2::fromArray([
            'gameId' => $game->id(),
            'version' => $version,
            'type' => $data['type'] ?? null,
            'payload' => $data['payload'] ?? null,
            'createdBy' => $data['createdBy'] ?? null,
            'clientActionId' => $data['clientActionId'] ?? null,
            'createdAt' => $data['createdAt'] ?? null,
        ]);
    }

    /**
     * @param array<string,mixed> $projectedSnapshot
     */
    public function bootstrap(Game $game, User $viewer, array $projectedSnapshot, array $knownStaticCatalogKeys = []): BootstrapV2
    {
        $players = [];
        $zones = [];
        $instances = [];
        $zoneCounts = [];
        $staticCards = [];
        $requiredStaticCards = [];
        $knownStaticCatalogKeys = $this->knownStaticCatalogKeySet($knownStaticCatalogKeys);
        $language = LanguageCatalog::normalize($viewer->cardLanguage()) ?? LanguageCatalog::DEFAULT_LANGUAGE;
        $cardCatalog = is_array($projectedSnapshot['cardCatalog'] ?? null) ? $projectedSnapshot['cardCatalog'] : [];

        foreach (($projectedSnapshot['players'] ?? []) as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player)) {
                continue;
            }

            $playerZoneIds = [];
            foreach (($player['zones'] ?? []) as $zoneName => $cards) {
                if (!is_string($zoneName) || !is_array($cards)) {
                    continue;
                }

                $zoneId = sprintf('%s:%s', $playerId, $zoneName);
                $instanceIds = [];
                foreach ($cards as $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $instanceId = trim((string) ($card['instanceId'] ?? ''));
                    if ($instanceId === '') {
                        continue;
                    }

                    $cardRef = $this->cardRef($card, $instanceId);
                    $viewerVisibility = $this->viewerVisibilityForZone($zoneName);
                    $staticCard = $this->staticCard($card, $language, $viewerVisibility, $cardCatalog);
                    if (!$this->isHiddenPlaceholder($card)) {
                        $requiredStaticCards[$cardRef] ??= $staticCard;
                    }
                    $instances[$instanceId] = $this->instance($card, $instanceId, $staticCard, $zoneId);
                    $instanceIds[] = $instanceId;
                }

                $zones[$zoneId] = [
                    'zoneId' => $zoneId,
                    'playerId' => $playerId,
                    'name' => $zoneName,
                    'instanceIds' => $instanceIds,
                ];
                $zoneCounts[$zoneId] = is_int($player['zoneCounts'][$zoneName] ?? null)
                    ? max(0, (int) $player['zoneCounts'][$zoneName])
                    : count($instanceIds);
                $playerZoneIds[] = $zoneId;
            }

            $players[$playerId] = [
                'playerId' => $playerId,
                'user' => is_array($player['user'] ?? null) ? $player['user'] : null,
                'displayName' => $player['user']['displayName'] ?? $playerId,
                'life' => (int) ($player['life'] ?? 0),
                'status' => is_string($player['status'] ?? null) ? $player['status'] : 'active',
                'handCount' => (int) ($player['handCount'] ?? ($player['zoneCounts']['hand'] ?? 0)),
                'zoneIds' => $playerZoneIds,
                'zoneCounts' => is_array($player['zoneCounts'] ?? null) ? $player['zoneCounts'] : [],
                'commanderDamage' => is_array($player['commanderDamage'] ?? null) ? $player['commanderDamage'] : [],
                'counters' => is_array($player['counters'] ?? null) ? $player['counters'] : [],
                'deckName' => is_string($player['deckName'] ?? null) ? $player['deckName'] : null,
                'colorIdentity' => is_array($player['colorIdentity'] ?? null) ? array_values($player['colorIdentity']) : [],
                'backgroundName' => is_string($player['backgroundName'] ?? null) ? $player['backgroundName'] : null,
                'sleevesName' => is_string($player['sleevesName'] ?? null) ? $player['sleevesName'] : null,
            ];
        }

        $staticCards = $this->staticCardsForClient($requiredStaticCards, $knownStaticCatalogKeys);
        $relations = [
            'stack' => $this->stackRelations($projectedSnapshot['stack'] ?? [], $requiredStaticCards, $language),
            'arrows' => array_values(array_filter($projectedSnapshot['arrows'] ?? [], static fn (mixed $entry): bool => is_array($entry))),
            'attachments' => array_values(array_filter($projectedSnapshot['attachments'] ?? [], static fn (mixed $entry): bool => is_array($entry))),
            'specialEntities' => array_values(array_filter($projectedSnapshot['specialEntities'] ?? [], static fn (mixed $entry): bool => is_array($entry))),
        ];

        $payload = [
            'game' => [
                'id' => $game->id(),
                'status' => $game->status(),
                'version' => max(1, (int) ($projectedSnapshot['version'] ?? 1)),
                'viewerId' => $viewer->id(),
                'ownerId' => $projectedSnapshot['ownerId'] ?? null,
                'gamePhase' => $projectedSnapshot['gamePhase'] ?? 'PLAYING',
                'createdAt' => $projectedSnapshot['createdAt'] ?? null,
                'updatedAt' => $projectedSnapshot['updatedAt'] ?? null,
            ],
            'players' => $players,
            'zones' => $zones,
            'instances' => $instances,
            'zoneCounts' => $zoneCounts,
            'sharedCounters' => $this->sharedCounters($projectedSnapshot['counters'] ?? []),
            'relations' => $relations,
            'turn' => is_array($projectedSnapshot['turn'] ?? null) ? $projectedSnapshot['turn'] : [],
            'staticCards' => $staticCards,
            'chatCursor' => $this->cursorForEntries($projectedSnapshot['chat'] ?? []),
            'logCursor' => $this->cursorForEntries($projectedSnapshot['eventLog'] ?? []),
            'rulesVersion' => self::RULES_VERSION,
            'cardCatalogVersion' => self::CARD_CATALOG_VERSION,
        ];
        $payload['payloadBytes'] = $this->jsonBytes($payload);

        return BootstrapV2::fromArray($payload);
    }

    /**
     * @return array<string,array<string,int>>
     */
    private function sharedCounters(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $normalized = [];
        foreach ($value as $scope => $counters) {
            if (!is_string($scope) || !is_array($counters)) {
                continue;
            }

            $normalizedCounters = [];
            foreach ($counters as $key => $count) {
                if (!is_string($key)) {
                    continue;
                }
                $normalizedCounters[$key] = (int) $count;
            }
            $normalized[$scope] = $normalizedCounters;
        }

        return $normalized;
    }

    /**
     * @param array<string,mixed> $card
     * @return array<string,mixed>
     */
    private function staticCard(array $card, string $language, string $viewerVisibility, array $cardCatalog = []): array
    {
        $cardRef = $this->cardRef($card, trim((string) ($card['instanceId'] ?? '')));
        $catalogCard = is_array($cardCatalog[$cardRef] ?? null) ? $cardCatalog[$cardRef] : [];
        $scryfallId = $this->nonEmptyString($card['scryfallId'] ?? null)
            ?? $this->nonEmptyString($catalogCard['scryfallId'] ?? null);
        $printId = $this->printId($card) ?? $scryfallId ?? $cardRef;
        $cardVersion = $this->nonEmptyString($card['cardVersion'] ?? null)
            ?? $this->nonEmptyString($catalogCard['cardVersion'] ?? null)
            ?? $this->cardVersion($card);
        $imageUris = is_array($card['imageUris'] ?? null) && $card['imageUris'] !== []
            ? $card['imageUris']
            : (is_array($catalogCard['imageUris'] ?? null) && $catalogCard['imageUris'] !== [] ? $catalogCard['imageUris'] : null);
        $cardFaces = is_array($card['cardFaces'] ?? null) && $card['cardFaces'] !== []
            ? $card['cardFaces']
            : (is_array($catalogCard['cardFaces'] ?? null) ? $catalogCard['cardFaces'] : []);
        $baseStats = is_array($catalogCard['baseStats'] ?? null) ? $catalogCard['baseStats'] : [];
        $layoutMetadata = is_array($catalogCard['layoutMetadata'] ?? null) ? $catalogCard['layoutMetadata'] : [];

        return [
            'cardRef' => $cardRef,
            'cardKey' => $cardRef,
            'printId' => $printId,
            'cardVersion' => $cardVersion,
            'language' => $language,
            'viewerVisibility' => $viewerVisibility,
            'scryfallId' => $scryfallId,
            'name' => $card['name'] ?? $catalogCard['name'] ?? null,
            'imageUris' => $imageUris,
            'cardFaces' => $cardFaces,
            'typeLine' => $card['typeLine'] ?? $catalogCard['typeLine'] ?? null,
            'manaCost' => $card['manaCost'] ?? $catalogCard['manaCost'] ?? null,
            'colorIdentity' => is_array($card['colorIdentity'] ?? null)
                ? array_values($card['colorIdentity'])
                : (is_array($catalogCard['colorIdentity'] ?? null) ? array_values($catalogCard['colorIdentity']) : []),
            'defaultPower' => $card['defaultPower'] ?? $baseStats['power'] ?? null,
            'defaultToughness' => $card['defaultToughness'] ?? $baseStats['toughness'] ?? null,
            'defaultLoyalty' => $card['defaultLoyalty'] ?? $baseStats['loyalty'] ?? null,
            'defaultDefense' => $card['defaultDefense'] ?? $baseStats['defense'] ?? null,
            'hasRulings' => ($card['hasRulings'] ?? $layoutMetadata['hasRulings'] ?? false) === true,
        ];
    }

    /**
     * @param array<string,mixed> $card
     * @return array<string,mixed>
     */
    private function instance(array $card, string $instanceId, array $staticCard, string $zoneId): array
    {
        $instance = [
            'instanceId' => $instanceId,
            'cardRef' => $staticCard['cardRef'],
            'zoneId' => $zoneId,
            'ownerId' => $card['ownerId'] ?? null,
            'controllerId' => $card['controllerId'] ?? null,
            'hidden' => ($card['hidden'] ?? false) === true,
            'faceDown' => ($card['faceDown'] ?? false) === true,
            'tapped' => ($card['tapped'] ?? false) === true,
            'position' => is_array($card['position'] ?? null) ? $card['position'] : null,
            'rotation' => $card['rotation'] ?? 0,
            'counters' => is_array($card['counters'] ?? null) ? $card['counters'] : [],
            'power' => $card['power'] ?? null,
            'toughness' => $card['toughness'] ?? null,
            'loyalty' => $card['loyalty'] ?? null,
            'defense' => $card['defense'] ?? null,
            'activeFaceIndex' => $card['activeFaceIndex'] ?? null,
            'revealedTo' => is_array($card['revealedTo'] ?? null) ? array_values($card['revealedTo']) : [],
            'isToken' => ($card['isToken'] ?? false) === true,
            'isTokenCopy' => ($card['isTokenCopy'] ?? false) === true,
            'isCommander' => ($card['isCommander'] ?? false) === true,
        ];
        if (!$this->isHiddenPlaceholder($card)) {
            $instance['cardKey'] = $staticCard['cardKey'];
            $instance['printId'] = $staticCard['printId'];
            $instance['cardVersion'] = $staticCard['cardVersion'];
            $instance['language'] = $staticCard['language'];
            $instance['viewerVisibility'] = $staticCard['viewerVisibility'];
        }
        if (is_array($card['tokenMeta'] ?? null) && $card['tokenMeta'] !== []) {
            $instance['tokenMeta'] = $card['tokenMeta'];
        }

        return $instance;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardRef(array $card, string $instanceId): string
    {
        foreach (['cardRef', 'cardKey'] as $field) {
            if (is_string($card[$field] ?? null) && trim((string) $card[$field]) !== '') {
                return trim((string) $card[$field]);
            }
        }

        $templateCardKey = is_string($card['tokenMeta']['templateCardKey'] ?? null)
            ? trim((string) $card['tokenMeta']['templateCardKey'])
            : '';
        if ($templateCardKey !== '') {
            return $templateCardKey;
        }

        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
        if ($scryfallId !== '') {
            $suffix = (($card['isToken'] ?? false) === true || ($card['isTokenCopy'] ?? false) === true)
                ? ':token'
                : ':card';

            return $scryfallId.$suffix;
        }

        return 'instance:'.$instanceId;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardVersion(array $card): string
    {
        if (is_string($card['cardVersion'] ?? null) && trim((string) $card['cardVersion']) !== '') {
            return trim((string) $card['cardVersion']);
        }

        $tokenVersion = is_string($card['tokenMeta']['templateCardVersion'] ?? null)
            ? trim((string) $card['tokenMeta']['templateCardVersion'])
            : '';
        if ($tokenVersion !== '') {
            return $tokenVersion;
        }

        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
        if ($scryfallId !== '') {
            return self::CARD_CATALOG_VERSION;
        }

        return 'hidden-placeholder-v1';
    }

    /**
     * @param array<string,mixed> $card
     */
    private function printId(array $card): ?string
    {
        if (is_string($card['printId'] ?? null) && trim((string) $card['printId']) !== '') {
            return trim((string) $card['printId']);
        }

        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));

        return $scryfallId !== '' ? $scryfallId : null;
    }

    private function nonEmptyString(mixed $value): ?string
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        return trim($value);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isHiddenPlaceholder(array $card): bool
    {
        return ($card['hidden'] ?? false) === true
            && trim((string) ($card['scryfallId'] ?? '')) === '';
    }

    /**
     * @param array<int|string,mixed> $knownStaticCatalogKeys
     * @return array<string,bool>
     */
    private function knownStaticCatalogKeySet(array $knownStaticCatalogKeys): array
    {
        $known = [];
        foreach ($knownStaticCatalogKeys as $value) {
            if (!is_string($value)) {
                continue;
            }
            $value = trim($value);
            if ($value !== '') {
                $known[$value] = true;
            }
        }

        return $known;
    }

    /**
     * @param array<string,array<string,mixed>> $requiredStaticCards
     * @param array<string,bool> $knownStaticCatalogKeys
     * @return array<string,array<string,mixed>>
     */
    private function staticCardsForClient(array $requiredStaticCards, array $knownStaticCatalogKeys): array
    {
        $staticCards = [];
        foreach ($requiredStaticCards as $cardRef => $card) {
            $catalogKey = $this->staticCatalogKey($card);
            if (isset($knownStaticCatalogKeys[$catalogKey])) {
                continue;
            }

            $staticCards[$cardRef] = $card;
        }

        return $staticCards;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function staticCatalogKey(array $card): string
    {
        return implode('|', array_map(
            'rawurlencode',
            [
                (string) ($card['cardKey'] ?? $card['cardRef'] ?? ''),
                (string) ($card['printId'] ?? $card['scryfallId'] ?? ''),
                (string) ($card['cardVersion'] ?? self::CARD_CATALOG_VERSION),
                (string) ($card['language'] ?? LanguageCatalog::DEFAULT_LANGUAGE),
                (string) ($card['viewerVisibility'] ?? 'public'),
            ],
        ));
    }

    private function viewerVisibilityForZone(string $zoneName): string
    {
        return $zoneName === 'hand' || $zoneName === 'library' ? 'private' : 'public';
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function jsonBytes(array $payload): int
    {
        $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return is_string($encoded) ? strlen($encoded) : 0;
    }

    /**
     * @param mixed $entries
     */
    private function cursorForEntries(mixed $entries): ?string
    {
        if (!is_array($entries) || $entries === []) {
            return null;
        }

        $last = $entries[array_key_last($entries)] ?? null;
        if (!is_array($last)) {
            return null;
        }

        $id = trim((string) ($last['id'] ?? ''));
        if ($id !== '') {
            return $id;
        }

        $createdAt = trim((string) ($last['createdAt'] ?? ''));

        return $createdAt !== '' ? $createdAt : null;
    }

    /**
     * @param mixed $entries
     * @param array<string,array<string,mixed>> $staticCards
     *
     * @return list<array<string,mixed>>
     */
    private function stackRelations(mixed $entries, array &$staticCards, string $language): array
    {
        if (!is_array($entries)) {
            return [];
        }

        $stack = [];
        foreach ($entries as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $stackId = trim((string) ($entry['stackId'] ?? $entry['id'] ?? ''));
            $sourceInstanceId = trim((string) ($entry['sourceInstanceId'] ?? $entry['instanceId'] ?? $entry['card']['instanceId'] ?? ''));
            $card = is_array($entry['card'] ?? null) ? $entry['card'] : null;
            $cardRef = null;
            if ($card !== null && $sourceInstanceId !== '') {
                $cardRef = $this->cardRef($card, $sourceInstanceId);
                $staticCards[$cardRef] ??= $this->staticCard($card, $language, 'public');
            }

            $stack[] = array_filter([
                'stackId' => $stackId !== '' ? $stackId : null,
                'id' => $stackId !== '' ? $stackId : null,
                'kind' => $entry['kind'] ?? 'card',
                'sourceInstanceId' => $sourceInstanceId !== '' ? $sourceInstanceId : null,
                'cardRef' => $cardRef,
                'cardKey' => $cardRef,
                'controllerId' => $entry['controllerId'] ?? ($card['controllerId'] ?? null),
                'text' => $entry['text'] ?? null,
                'createdAt' => $entry['createdAt'] ?? null,
            ], static fn (mixed $value): bool => $value !== null && $value !== '');
        }

        return $stack;
    }
}
