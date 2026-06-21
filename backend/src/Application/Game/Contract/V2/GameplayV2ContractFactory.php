<?php

namespace App\Application\Game\Contract\V2;

use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\User\User;

final class GameplayV2ContractFactory
{
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
            'payload' => $command['payload'] ?? null,
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
            'payload' => $message['payload'] ?? null,
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
    public function bootstrap(Game $game, User $viewer, array $projectedSnapshot): BootstrapV2
    {
        $players = [];
        $zones = [];
        $instances = [];
        $zoneCounts = [];
        $staticCards = [];

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
                    $staticCards[$cardRef] ??= $this->staticCard($card);
                    $instances[$instanceId] = $this->instance($card, $instanceId, $cardRef, $zoneId);
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
            ];
        }

        return BootstrapV2::fromArray([
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
            'relations' => [
                'stack' => $this->stackRelations($projectedSnapshot['stack'] ?? [], $staticCards),
                'arrows' => array_values(array_filter($projectedSnapshot['arrows'] ?? [], static fn (mixed $entry): bool => is_array($entry))),
                'attachments' => array_values(array_filter($projectedSnapshot['attachments'] ?? [], static fn (mixed $entry): bool => is_array($entry))),
                'specialEntities' => array_values(array_filter($projectedSnapshot['specialEntities'] ?? [], static fn (mixed $entry): bool => is_array($entry))),
            ],
            'turn' => is_array($projectedSnapshot['turn'] ?? null) ? $projectedSnapshot['turn'] : [],
            'staticCards' => $staticCards,
            'chatCursor' => $this->cursorForEntries($projectedSnapshot['chat'] ?? []),
            'logCursor' => $this->cursorForEntries($projectedSnapshot['eventLog'] ?? []),
        ]);
    }

    /**
     * @param array<string,mixed> $card
     * @return array<string,mixed>
     */
    private function staticCard(array $card): array
    {
        return [
            'cardRef' => $this->cardRef($card, trim((string) ($card['instanceId'] ?? ''))),
            'scryfallId' => $card['scryfallId'] ?? null,
            'name' => $card['name'] ?? null,
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : null,
            'cardFaces' => is_array($card['cardFaces'] ?? null) ? $card['cardFaces'] : [],
            'typeLine' => $card['typeLine'] ?? null,
            'manaCost' => $card['manaCost'] ?? null,
            'colorIdentity' => is_array($card['colorIdentity'] ?? null) ? array_values($card['colorIdentity']) : [],
            'defaultPower' => $card['defaultPower'] ?? null,
            'defaultToughness' => $card['defaultToughness'] ?? null,
            'defaultLoyalty' => $card['defaultLoyalty'] ?? null,
            'defaultDefense' => $card['defaultDefense'] ?? null,
            'hasRulings' => ($card['hasRulings'] ?? false) === true,
        ];
    }

    /**
     * @param array<string,mixed> $card
     * @return array<string,mixed>
     */
    private function instance(array $card, string $instanceId, string $cardRef, string $zoneId): array
    {
        $instance = [
            'instanceId' => $instanceId,
            'cardRef' => $cardRef,
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
    private function stackRelations(mixed $entries, array &$staticCards): array
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
                $staticCards[$cardRef] ??= $this->staticCard($card);
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
