<?php

namespace App\Application\Game\Runtime;

use App\Application\Game\GameLibraryOps;

final readonly class LegacyMulliganRuntimeStateMapper
{
    private const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    public function map(array $snapshot, string $gameId): array
    {
        $state = [
            'gameId' => $gameId,
            'version' => max(1, (int) ($snapshot['version'] ?? 1)),
            'status' => 'playing',
            'phase' => is_string($snapshot['gamePhase'] ?? null) ? $snapshot['gamePhase'] : 'MULLIGAN',
            'players' => [],
            'turn' => $this->objectMap($snapshot['turn'] ?? []),
            'instances' => [],
            'zones' => [],
            'loc' => [],
            'visibility' => [
                'instanceMasks' => $this->emptyObject(),
                'libraryEpochByOwner' => $this->emptyObject(),
                'topRevealWindows' => $this->emptyObject(),
            ],
            'relations' => [
                'attachments' => $this->emptyObject(),
                'arrows' => $this->emptyObject(),
                'helpers' => $this->emptyObject(),
                'indexes' => [
                    'bySource' => $this->emptyObject(),
                    'byTarget' => $this->emptyObject(),
                ],
            ],
            'stack' => [],
            'mulligan' => $this->mulliganState($snapshot),
        ];

        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            if (!is_array($player)) {
                continue;
            }
            $playerId = (string) $playerId;
            $state['players'][$playerId] = [
                'life' => $player['life'] ?? 40,
                'user' => is_array($player['user'] ?? null) ? $player['user'] : [],
            ];
            $state['zones'][$playerId] = $this->playerZones($player);

            foreach (self::ZONES as $zone) {
                $cards = $this->zoneCards($player, $zone);
                foreach ($cards as $index => $card) {
                    $instanceId = is_string($card['instanceId'] ?? null) ? trim($card['instanceId']) : '';
                    if ($instanceId === '') {
                        continue;
                    }
                    $state['instances'][$instanceId] = $this->instance($card, $playerId, $zone);
                    $state['loc'][$instanceId] = [
                        'playerId' => $playerId,
                        'zone' => $zone,
                        'index' => $index,
                        'controllerId' => is_string($card['controllerId'] ?? null) ? $card['controllerId'] : $playerId,
                    ];
                }
            }
        }

        return $state;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,mixed>
     */
    private function mulliganState(array $snapshot): array
    {
        $global = is_array($snapshot['mulligan'] ?? null) ? $snapshot['mulligan'] : [];
        $players = [];
        $ready = [];
        foreach ($snapshot['players'] ?? [] as $playerId => $player) {
            if (!is_array($player)) {
                continue;
            }
            $mulligan = is_array($player['mulligan'] ?? null) ? $player['mulligan'] : [];
            $status = is_string($mulligan['status'] ?? null) ? $mulligan['status'] : 'DECIDING';
            $players[(string) $playerId] = [
                'status' => $status,
                'mulliganCount' => max(0, (int) ($mulligan['mulligansTaken'] ?? 0)),
                'effectiveMulligans' => max(0, (int) ($mulligan['effectiveMulligans'] ?? 0)),
                'currentHandSize' => count($this->zoneCards($player, 'hand')),
                'cardsToBottom' => max(0, (int) ($mulligan['bottomSelectionCount'] ?? 0)),
                'bottomPending' => ($mulligan['needsBottomSelection'] ?? false) === true,
                'scryPending' => ($mulligan['needsScryAfterKeep'] ?? false) === true || $status === 'SCRYING',
                'bottomOrderMode' => is_string($mulligan['bottomOrderMode'] ?? null) ? $mulligan['bottomOrderMode'] : 'NONE',
                'scryMode' => ($global['rule'] ?? null) === 'VANCOUVER' ? 'VANCOUVER' : 'NONE',
                'scryCardInstanceId' => is_string($mulligan['scryCardInstanceId'] ?? null) ? $mulligan['scryCardInstanceId'] : '',
            ];
            if ($status === 'READY' || ($mulligan['ready'] ?? false) === true) {
                $ready[(string) $playerId] = true;
            }
        }

        return [
            'rule' => is_string($global['rule'] ?? null) ? $global['rule'] : 'LONDON',
            'firstMulliganFree' => ($global['firstMulliganFree'] ?? false) === true,
            'playerStatus' => $players,
            'readyPlayers' => $this->boolMap($ready),
            'completed' => ($snapshot['gamePhase'] ?? null) === 'PLAYING',
            'bottomOrderMode' => 'PLAYER_CHOSEN_ORDER',
            'scryMode' => ($global['rule'] ?? null) === 'VANCOUVER' ? 'VANCOUVER' : 'NONE',
        ];
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return array<string,list<string>>
     */
    private function playerZones(array $player): array
    {
        $zones = [];
        foreach (self::ZONES as $zone) {
            $zones[$zone] = array_values(array_filter(array_map(
                static fn (array $card): string => is_string($card['instanceId'] ?? null) ? $card['instanceId'] : '',
                $this->zoneCards($player, $zone),
            )));
        }

        return $zones;
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return list<array<string,mixed>>
     */
    private function zoneCards(array $player, string $zone): array
    {
        if ($zone === 'library') {
            $cards = (new GameLibraryOps())->projectionOrderCards($player);

            return array_reverse($cards);
        }

        return array_values(array_filter(
            is_array($player['zones'][$zone] ?? null) ? $player['zones'][$zone] : [],
            static fn (mixed $card): bool => is_array($card),
        ));
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array<string,mixed>
     */
    private function instance(array $card, string $playerId, string $zone): array
    {
        $ownerId = is_string($card['ownerId'] ?? null) ? $card['ownerId'] : $playerId;

        return [
            'instanceId' => (string) ($card['instanceId'] ?? ''),
            'cardKey' => is_string($card['cardKey'] ?? null) ? $card['cardKey'] : '',
            'ownerId' => $ownerId,
            'controllerId' => is_string($card['controllerId'] ?? null) ? $card['controllerId'] : $playerId,
            'zone' => $zone,
            'isCommander' => ($card['isCommander'] ?? false) === true,
            'isToken' => ($card['isToken'] ?? false) === true,
            'tapped' => ($card['tapped'] ?? false) === true,
            'rotation' => max(0, (int) ($card['rotation'] ?? 0)),
            'counters' => $this->counterMap($card['counters'] ?? []),
            'mutableStats' => $this->objectMap($card['mutableStats'] ?? []),
            'position' => $this->objectMap($card['position'] ?? []),
            'faceDown' => ($card['faceDown'] ?? false) === true,
            'activeFace' => max(0, (int) ($card['activeFace'] ?? 0)),
        ];
    }

    /**
     * @return array<string,int>|\stdClass
     */
    private function counterMap(mixed $value): array|\stdClass
    {
        if (!is_array($value)) {
            return $this->emptyObject();
        }

        $out = [];
        foreach ($value as $key => $count) {
            if (!is_string($key) || trim($key) === '') {
                continue;
            }
            $out[$key] = (int) $count;
        }

        return $out !== [] ? $out : $this->emptyObject();
    }

    /**
     * @return array<string,mixed>|\stdClass
     */
    private function objectMap(mixed $value): array|\stdClass
    {
        if (!is_array($value)) {
            return $this->emptyObject();
        }

        $out = [];
        foreach ($value as $key => $item) {
            if (!is_string($key) || trim($key) === '') {
                continue;
            }
            $out[$key] = $item;
        }

        return $out !== [] ? $out : $this->emptyObject();
    }

    /**
     * @param array<string,bool> $value
     *
     * @return array<string,bool>|\stdClass
     */
    private function boolMap(array $value): array|\stdClass
    {
        return $value !== [] ? $value : $this->emptyObject();
    }

    private function emptyObject(): \stdClass
    {
        return new \stdClass();
    }
}
