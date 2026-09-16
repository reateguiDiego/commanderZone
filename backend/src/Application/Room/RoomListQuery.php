<?php

namespace App\Application\Room;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

/** Scalar projection for the browser; never loads decks, game snapshots or waiting logs. */
final class RoomListQuery
{
    public function __construct(private readonly Connection $connection)
    {
    }

    public function page(string $viewer, string $status = 'active', int $limit = 50, ?string $cursor = null): array
    {
        if (!in_array($status, ['active', 'all'], true) || $limit < 1 || $limit > 100) {
            throw new \InvalidArgumentException('Unsupported room status filter or limit (1-100).');
        }
        $params = $status === 'all' ? ['viewer' => $viewer] : [];
        $after = '';
        if ($cursor !== null) {
            $key = $this->decodeCursor($cursor, $viewer, $status);
            $params += ['rank' => $key[3], 'name' => $key[4], 'id' => $key[5]];
            $after = 'WHERE (list_rank, name COLLATE "C", id) > (:rank, :name COLLATE "C", :id)';
        }
        $rows = $this->connection->fetchAllAssociative($this->pageSql($status, $after, $limit + 1), $params);
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }
        $next = null;
        if ($hasMore) {
            $last = $rows[array_key_last($rows)];
            $next = rtrim(strtr(base64_encode(json_encode([1, $viewer, $status, (int) $last['list_rank'], $last['name'], $last['id']], JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
        }
        if ($rows === []) {
            return ['data' => [], 'nextCursor' => null];
        }

        // Only page IDs reach user/player lookup. Hidden identities never reach the projection.
        $users = [];
        $userIds = [$viewer];
        foreach ($rows as $row) {
            if ($row['visibility'] === 'public' || $row['owner_id'] === $viewer) {
                $userIds[] = $row['owner_id'];
            }
        }
        $players = $this->connection->fetchAllAssociative(
            'SELECT p.room_id, p.id, p.user_id, p.deck_id, p.turn_roll, p.turn_rolls FROM room_player p WHERE p.room_id IN (:ids) ORDER BY p.joined_at, p.id',
            ['ids' => array_column($rows, 'id')], ['ids' => ArrayParameterType::STRING],
        );
        $visibleRooms = [];
        foreach ($rows as $row) {
            $visibleRooms[$row['id']] = $row['visibility'] === 'public' || $row['owner_id'] === $viewer;
        }
        foreach ($players as $player) {
            if ($visibleRooms[$player['room_id']]) {
                $userIds[] = $player['user_id'];
            }
        }
        foreach ($this->connection->fetchAllAssociative(
            'SELECT id, display_name, public_handle, display_name_style_preset, display_name_style_text_color, avatar_type, avatar_preset, avatar_initial_letter, avatar_initial_background_color, avatar_initial_text_color FROM app_user WHERE id IN (:ids)',
            ['ids' => array_values(array_unique($userIds))], ['ids' => ArrayParameterType::STRING],
        ) as $user) {
            $users[$user['id']] = $this->userPayload($user);
        }
        $byRoom = [];
        foreach ($players as $player) {
            $visible = $visibleRooms[$player['room_id']] || $player['user_id'] === $viewer;
            $byRoom[$player['room_id']][] = [
                'id' => $player['id'],
                'user' => $visible ? $users[$player['user_id']] : $this->maskedUser('private-player-'.$player['id']),
                'deckId' => $visible ? $player['deck_id'] : null,
                'turnRoll' => $visible && $player['turn_roll'] !== null ? (int) $player['turn_roll'] : null,
                'turnRolls' => $visible ? json_decode($player['turn_rolls'], true, 512, JSON_THROW_ON_ERROR) : [],
            ];
        }
        $data = [];
        foreach ($rows as $row) {
            $item = [];
            foreach (['id', 'name', 'status', 'visibility', 'format'] as $field) {
                $item[$field] = $row[$field];
            }
            foreach (['max_players' => 'maxPlayers', 'starting_life' => 'startingLife', 'timer_duration_seconds' => 'timerDurationSeconds'] as $column => $field) {
                $item[$field] = (int) $row[$column];
            }
            $item += [
                'owner' => $visibleRooms[$row['id']] ? $users[$row['owner_id']] : $this->maskedUser('private-host-'.$row['id']),
                'timerMode' => $row['timer_mode'], 'mulliganRule' => $row['mulligan_rule'],
                'firstMulliganFree' => (bool) $row['first_mulligan_free'],
                'players' => $byRoom[$row['id']] ?? [], 'gameId' => $row['game_id'],
            ];
            $data[] = $item;
        }
        return ['data' => $data, 'nextCursor' => $next];
    }

    /** Also used by the reproducible EXPLAIN regression test. */
    public function pageSql(string $status, string $after = '', int $fetch = 51): string
    {
        $columns = 'r.id, r.name, r.owner_id, r.status, r.visibility, r.format, r.max_players,
                r.starting_life, r.timer_mode, r.timer_duration_seconds, r.mulligan_rule,
                r.first_mulligan_free, r.game_id';
        $source = "SELECT $columns FROM room r WHERE r.status = 'waiting' AND r.game_id IS NULL";
        if ($status === 'all') {
            $source .= " UNION ALL SELECT $columns FROM room r WHERE r.status = 'started'
                AND r.id IN (SELECT owned.id FROM room owned WHERE owned.status = 'started' AND owned.owner_id = :viewer
                    UNION SELECT member.room_id FROM room_player member WHERE member.user_id = :viewer)
                AND EXISTS (SELECT 1 FROM game g WHERE g.id = r.game_id AND g.status = 'active')";
        }
        // MATERIALIZED ensures historical rooms are removed before occupancy probes.
        return "WITH eligible AS MATERIALIZED (
            $source
        ), ranked AS (
            SELECT e.*, (CASE WHEN visibility = 'public' THEN 0 ELSE 100 END +
                CASE WHEN status = 'waiting' AND (SELECT COUNT(*) FROM room_player p WHERE p.room_id = e.id) < max_players THEN 0
                     WHEN status = 'waiting' THEN 10 ELSE 20 END) AS list_rank
            FROM eligible e
        ) SELECT * FROM ranked $after ORDER BY list_rank, name COLLATE \"C\", id LIMIT $fetch";
    }

    private function decodeCursor(string $cursor, string $viewer, string $status): array
    {
        $key = strlen($cursor) <= 1024 ? json_decode(base64_decode(strtr($cursor, '-_', '+/'), true) ?: '', true) : null;
        if (!is_array($key) || !array_is_list($key) || count($key) !== 6 || $key[0] !== 1 || $key[1] !== $viewer || $key[2] !== $status
            || !is_int($key[3]) || !in_array($key[3], [0, 10, 20, 100, 110, 120], true)
            || !is_string($key[4]) || strlen($key[4]) > 120 || !is_string($key[5])
            || !preg_match('/^[0-9a-f-]{36}$/D', $key[5])) {
            throw new \InvalidArgumentException('Invalid room cursor.');
        }
        return $key;
    }

    private function maskedUser(string $id): array
    {
        return ['id' => $id, 'email' => '', 'displayName' => 'XXXX', 'roles' => ['ROLE_USER'],
            'displayNameStyle' => ['type' => 'plain', 'presetId' => 'plain'], 'avatar' => ['type' => 'initial', 'imageUrl' => null]];
    }

    private function userPayload(array $user): array
    {
        $payload = $this->maskedUser($user['id']);
        $payload['displayName'] = $user['display_name'];
        $payload['publicHandle'] = $user['public_handle'];
        $payload['publicPath'] = $user['public_handle'] === null ? null : '/community/users/'.rawurlencode($user['public_handle']);
        $payload['displayNameStyle'] = ['type' => $user['display_name_style_preset'] === 'plain' ? 'plain' : 'preset', 'presetId' => $user['display_name_style_preset']];
        if ($user['display_name_style_text_color'] !== null) {
            $payload['displayNameStyle']['textColor'] = $user['display_name_style_text_color'];
        }
        $payload['avatar'] = ['type' => $user['avatar_type'], 'imageUrl' => match ($user['avatar_type']) {
            'preset' => $user['avatar_preset'], 'upload' => '/users/'.$user['id'].'/avatar', default => null,
        }];
        if ($user['avatar_type'] === 'initial') {
            $payload['avatar']['initial'] = ['letter' => $user['avatar_initial_letter'] ?? mb_strtoupper(mb_substr(trim($user['display_name']), 0, 1)),
                'backgroundColor' => $user['avatar_initial_background_color'] ?? '#edcd83', 'textColor' => $user['avatar_initial_text_color'] ?? '#16120a'];
        }
        return $payload;
    }
}
