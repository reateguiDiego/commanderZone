<?php

namespace App\Application\TableAssistant;

use App\Domain\Room\Room;
use App\Domain\User\User;

class TableAssistantStateFactory
{
    public const DEFAULT_PLAYER_COUNT = 4;
    public const DEFAULT_LIFE = 40;
    public const PHASES = ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end'];
    public const TRACKERS = ['commander-damage', 'poison', 'commander-tax', 'energy', 'experience', 'monarch', 'initiative', 'storm'];
    public const PLAYER_TRACKERS = ['poison', 'commander-tax', 'energy', 'experience'];
    public const GLOBAL_TRACKERS = ['monarch', 'initiative', 'storm'];
    private const PLAYER_COLORS = [
        'white',
        'blue',
        'black',
        'red',
        'green',
        'azorius',
        'dimir',
        'rakdos',
        'gruul',
        'selesnya',
        'orzhov',
        'izzet',
        'golgari',
        'boros',
        'simic',
        'esper',
        'grixis',
        'jund',
        'naya',
        'bant',
    ];

    public function create(Room $room, User $host, array $payload): array
    {
        $mode = $this->validMode((string) ($payload['mode'] ?? 'single-device'));
        $settings = $this->settings($payload, $mode);
        $timerDurationSeconds = $settings['timerMode'] === 'none'
            ? null
            : $this->positiveInteger($payload['timerDurationSeconds'] ?? 300, 300);
        $players = $this->players(
            (int) ($payload['playerCount'] ?? self::DEFAULT_PLAYER_COUNT),
            $settings['initialLife'],
            $settings['activeTrackerIds'],
            is_array($payload['players'] ?? null) ? $payload['players'] : [],
        );
        $hostParticipantId = 'participant-host';

        if ($mode === 'per-player-device' && isset($players[0])) {
            $players[0]['assignedParticipantId'] = $hostParticipantId;
            $players[0]['assignedUserId'] = $host->id();
        }

        $createdAt = (new \DateTimeImmutable())->format(DATE_ATOM);

        return [
            'id' => $room->id(),
            'status' => 'setup',
            'mode' => $mode,
            'hostParticipantId' => $hostParticipantId,
            'players' => $players,
            'participants' => [[
                'id' => $hostParticipantId,
                'role' => 'host',
                'user' => $host->toArray(),
                'deviceId' => $this->stringOrNull($payload['deviceId'] ?? null),
                'assignedPlayerId' => $mode === 'per-player-device' ? ($players[0]['id'] ?? null) : null,
                'connected' => true,
                'joinedAt' => $createdAt,
            ]],
            'invitations' => [],
            'settings' => $settings,
            'turn' => [
                'activePlayerId' => $players[0]['id'] ?? null,
                'number' => 1,
                'phaseId' => $settings['phasesEnabled'] ? self::PHASES[0] : null,
            ],
            'timer' => [
                'mode' => $settings['timerMode'],
                'status' => 'idle',
                'durationSeconds' => $timerDurationSeconds,
                'remainingSeconds' => $timerDurationSeconds,
                'startedAt' => null,
            ],
            'sharing' => [
                'code' => strtoupper(substr(str_replace('-', '', $room->id()), 0, 6)),
                'inviteUrl' => null,
            ],
            'globalTrackers' => $this->globalTrackers($settings['activeTrackerIds']),
            'commanderDamage' => $this->commanderDamage($players),
            'actionLog' => [],
            'version' => 1,
            'createdAt' => $createdAt,
            'updatedAt' => $createdAt,
        ];
    }

    private function settings(array $payload, string $mode): array
    {
        $phasesEnabled = (bool) ($payload['phasesEnabled'] ?? false);
        $timerMode = $this->validTimerMode((string) ($payload['timerMode'] ?? 'none'), $phasesEnabled);
        $activeTrackerIds = $this->validTrackers($payload['activeTrackerIds'] ?? ['commander-damage']);

        return [
            'initialLife' => $this->positiveInteger($payload['initialLife'] ?? self::DEFAULT_LIFE, self::DEFAULT_LIFE),
            'commanderDamageEnabled' => true,
            'turnTrackingEnabled' => true,
            'phasesEnabled' => $phasesEnabled,
            'timerMode' => $timerMode,
            'skipEliminatedPlayers' => (bool) ($payload['skipEliminatedPlayers'] ?? false),
            'permissionPolicy' => $mode === 'single-device'
                ? ['mode' => 'everyone', 'hostCanEditAll' => true, 'playerCanEditOwnPanel' => true, 'viewerCanEdit' => false]
                : ['mode' => 'host-and-owner', 'hostCanEditAll' => true, 'playerCanEditOwnPanel' => true, 'viewerCanEdit' => false],
            'activeTrackerIds' => $activeTrackerIds,
        ];
    }

    private function players(int $count, int $life, array $activeTrackerIds, array $configuredPlayers): array
    {
        $count = max(1, min(6, $count));
        $players = [];

        for ($index = 0; $index < $count; $index++) {
            $players[] = [
                'id' => 'player-'.($index + 1),
                'name' => $this->playerName($configuredPlayers[$index]['name'] ?? null, $index),
                'color' => $this->playerColor($configuredPlayers[$index]['color'] ?? null, $index),
                'seatIndex' => $index,
                'turnOrder' => $index,
                'life' => $life,
                'startingLife' => $life,
                'eliminated' => false,
                'assignedParticipantId' => null,
                'assignedUserId' => null,
                'trackers' => $this->playerTrackers($activeTrackerIds),
            ];
        }

        return $players;
    }

    private function playerColor(mixed $color, int $index): string
    {
        if (is_string($color) && in_array($color, self::PLAYER_COLORS, true)) {
            return $color;
        }

        return self::PLAYER_COLORS[$index % count(self::PLAYER_COLORS)];
    }

    private function playerName(mixed $name, int $index): string
    {
        if (is_string($name) && trim($name) !== '') {
            return mb_substr(trim($name), 0, 40);
        }

        return 'Jugador '.($index + 1);
    }

    private function playerTrackers(array $activeTrackerIds): array
    {
        return array_reduce(self::PLAYER_TRACKERS, static function (array $trackers, string $trackerId) use ($activeTrackerIds): array {
            if (in_array($trackerId, $activeTrackerIds, true)) {
                $trackers[$trackerId] = 0;
            }

            return $trackers;
        }, []);
    }

    private function globalTrackers(array $activeTrackerIds): array
    {
        return array_reduce(self::GLOBAL_TRACKERS, static function (array $trackers, string $trackerId) use ($activeTrackerIds): array {
            if (in_array($trackerId, $activeTrackerIds, true)) {
                $trackers[$trackerId] = 0;
            }

            return $trackers;
        }, []);
    }

    private function commanderDamage(array $players): array
    {
        $damage = [];
        foreach ($players as $target) {
            $damage[$target['id']] = [];
            foreach ($players as $source) {
                if ($source['id'] !== $target['id']) {
                    $damage[$target['id']][$source['id']] = 0;
                }
            }
        }

        return $damage;
    }

    private function validMode(string $mode): string
    {
        return in_array($mode, ['single-device', 'per-player-device'], true) ? $mode : 'single-device';
    }

    private function validTimerMode(string $mode, bool $phasesEnabled): string
    {
        $valid = $phasesEnabled ? ['none', 'turn', 'phase'] : ['none', 'turn'];

        return in_array($mode, $valid, true) ? $mode : 'none';
    }

    private function validTrackers(mixed $trackers): array
    {
        if (!is_array($trackers)) {
            return ['commander-damage'];
        }

        $valid = array_values(array_intersect($trackers, self::TRACKERS));

        return $valid === [] ? ['commander-damage'] : $valid;
    }

    private function positiveInteger(mixed $value, int $fallback): int
    {
        $normalized = filter_var($value, FILTER_VALIDATE_INT);

        return is_int($normalized) && $normalized > 0 ? $normalized : $fallback;
    }

    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
