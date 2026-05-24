<?php

namespace App\Application\Game\Debug;

final class GameDebugHealthAggregator
{
    private const MAX_RECENT_ITEMS = 120;
    private const MAX_EVENT_ITEMS = 240;

    /**
     * @param array<string,mixed>|null $state
     *
     * @return array<string,mixed>
     */
    public function normalize(?array $state): array
    {
        $state = is_array($state) ? $state : [];

        return [
            'websocket' => [
                'connections' => [
                    'total' => (int) ($state['websocket']['connections']['total'] ?? 0),
                    'byUser' => is_array($state['websocket']['connections']['byUser'] ?? null) ? $state['websocket']['connections']['byUser'] : [],
                    'transitions' => [
                        'online' => (int) ($state['websocket']['connections']['transitions']['online'] ?? 0),
                        'offline' => (int) ($state['websocket']['connections']['transitions']['offline'] ?? 0),
                    ],
                ],
                'lastSeen' => is_array($state['websocket']['lastSeen'] ?? null) ? $state['websocket']['lastSeen'] : null,
            ],
            'pipeline' => [
                'gamePatch' => (int) ($state['pipeline']['gamePatch'] ?? 0),
                'commandAck' => [
                    'rejected' => (int) ($state['pipeline']['commandAck']['rejected'] ?? 0),
                    'duplicate' => (int) ($state['pipeline']['commandAck']['duplicate'] ?? 0),
                    'resync_required' => (int) ($state['pipeline']['commandAck']['resync_required'] ?? 0),
                ],
                'resyncRequired' => (int) ($state['pipeline']['resyncRequired'] ?? 0),
                'error' => (int) ($state['pipeline']['error'] ?? 0),
                'pong' => (int) ($state['pipeline']['pong'] ?? 0),
                'presenceChanged' => (int) ($state['pipeline']['presenceChanged'] ?? 0),
            ],
            'replay' => [
                'attempts' => (int) ($state['replay']['attempts'] ?? 0),
                'hits' => (int) ($state['replay']['hits'] ?? 0),
                'misses' => (int) ($state['replay']['misses'] ?? 0),
                'gaps' => (int) ($state['replay']['gaps'] ?? 0),
                'lastWindow' => is_array($state['replay']['lastWindow'] ?? null) ? $state['replay']['lastWindow'] : null,
            ],
            'sync' => [
                'lastGamePatch' => is_array($state['sync']['lastGamePatch'] ?? null) ? $state['sync']['lastGamePatch'] : null,
                'lastVersionGap' => is_array($state['sync']['lastVersionGap'] ?? null) ? $state['sync']['lastVersionGap'] : null,
                'lastConflict' => is_array($state['sync']['lastConflict'] ?? null) ? $state['sync']['lastConflict'] : null,
                'lastError' => is_array($state['sync']['lastError'] ?? null) ? $state['sync']['lastError'] : null,
            ],
            'errors' => [
                'total' => (int) ($state['errors']['total'] ?? 0),
                'byCode' => is_array($state['errors']['byCode'] ?? null) ? $state['errors']['byCode'] : [],
            ],
            'recent' => is_array($state['recent'] ?? null) ? array_values($state['recent']) : [],
            'events' => is_array($state['events'] ?? null) ? array_values($state['events']) : [],
        ];
    }

    /**
     * @param array<string,mixed> $state
     *
     * @return array<string,mixed>
     */
    public function recordConnectionSnapshot(array $state, string $userId, string $displayName, string $status, int $totalConnections, int $userConnections, ?string $changedAt = null): array
    {
        $state = $this->normalize($state);
        $timestamp = $changedAt ?? $this->now();

        $current = $state['websocket']['connections']['byUser'][$userId] ?? [];
        $previousStatus = is_string($current['status'] ?? null) ? $current['status'] : null;

        $state['websocket']['connections']['total'] = max(0, $totalConnections);
        $state['websocket']['connections']['byUser'][$userId] = [
            'displayName' => $displayName,
            'status' => $status,
            'connections' => max(0, $userConnections),
            'lastConnectedAt' => $status === 'online'
                ? $timestamp
                : (is_string($current['lastConnectedAt'] ?? null) ? $current['lastConnectedAt'] : null),
            'lastDisconnectedAt' => $status === 'offline'
                ? $timestamp
                : (is_string($current['lastDisconnectedAt'] ?? null) ? $current['lastDisconnectedAt'] : null),
            'offlineSince' => $status === 'offline'
                ? $timestamp
                : null,
        ];

        if ($previousStatus !== $status) {
            if ($status === 'online') {
                $state['websocket']['connections']['transitions']['online']++;
            } elseif ($status === 'offline') {
                $state['websocket']['connections']['transitions']['offline']++;
            }
        }

        return $state;
    }

    /**
     * @param array<string,mixed> $state
     * @param array<string,mixed> $message
     *
     * @return array<string,mixed>
     */
    public function recordOutboundMessage(array $state, array $message, ?string $channel = null): array
    {
        $state = $this->normalize($state);
        $timestamp = $this->now();
        $kind = is_string($message['kind'] ?? null) ? $message['kind'] : 'unknown';

        $state['websocket']['lastSeen'] = [
            'kind' => $kind,
            'at' => $timestamp,
        ];

        switch ($kind) {
            case 'game_patch':
                $state['pipeline']['gamePatch']++;
                $state['sync']['lastGamePatch'] = [
                    'baseVersion' => (int) ($message['baseVersion'] ?? 0),
                    'version' => (int) ($message['version'] ?? 0),
                    'clientActionId' => is_string($message['clientActionId'] ?? null) ? $message['clientActionId'] : null,
                    'at' => $timestamp,
                ];
                break;

            case 'command_ack':
                $status = is_string($message['status'] ?? null) ? $message['status'] : 'rejected';
                if (!isset($state['pipeline']['commandAck'][$status])) {
                    $state['pipeline']['commandAck'][$status] = 0;
                }
                $state['pipeline']['commandAck'][$status]++;
                if ($status === 'resync_required' || $status === 'rejected') {
                    $state['sync']['lastConflict'] = [
                        'status' => $status,
                        'version' => (int) ($message['version'] ?? 0),
                        'clientActionId' => is_string($message['clientActionId'] ?? null) ? $message['clientActionId'] : null,
                        'code' => is_string($message['error']['code'] ?? null) ? $message['error']['code'] : null,
                        'at' => $timestamp,
                    ];
                }
                break;

            case 'resync_required':
                $state['pipeline']['resyncRequired']++;
                $state['sync']['lastVersionGap'] = [
                    'currentVersion' => (int) ($message['currentVersion'] ?? 0),
                    'reason' => is_string($message['reason'] ?? null) ? $message['reason'] : 'unknown',
                    'clientActionId' => is_string($message['clientActionId'] ?? null) ? $message['clientActionId'] : null,
                    'at' => $timestamp,
                ];
                break;

            case 'error':
                $state['pipeline']['error']++;
                $this->recordErrorData($state, (string) ($message['error']['code'] ?? 'UNKNOWN_ERROR'), (string) ($message['error']['message'] ?? 'Unknown error'), $timestamp);
                break;

            case 'pong':
                $state['pipeline']['pong']++;
                break;

            case 'player_presence_changed':
                $state['pipeline']['presenceChanged']++;
                break;
        }

        $state = $this->appendRecent($state, [
            'kind' => $kind,
            'channel' => $channel,
            'at' => $timestamp,
            'message' => $this->compactMessage($message),
        ]);

        if (in_array($kind, ['game_patch', 'command_ack', 'resync_required', 'error'], true)) {
            $state = $this->appendEvent($state, [
                'kind' => $kind,
                'at' => $timestamp,
                'message' => $this->compactMessage($message),
            ]);
        }

        return $state;
    }

    /**
     * @param array<string,mixed> $state
     *
     * @return array<string,mixed>
     */
    public function recordIncomingValidationError(array $state, string $code, string $message, ?array $meta = null): array
    {
        $state = $this->normalize($state);
        $timestamp = $this->now();

        $state['pipeline']['error']++;
        $this->recordErrorData($state, $code, $message, $timestamp);

        $state = $this->appendRecent($state, [
            'kind' => 'incoming_error',
            'code' => $code,
            'message' => $message,
            'meta' => $meta,
            'at' => $timestamp,
        ]);

        $state = $this->appendEvent($state, [
            'kind' => 'incoming_error',
            'code' => $code,
            'message' => $message,
            'meta' => $meta,
            'at' => $timestamp,
        ]);

        return $state;
    }

    /**
     * @param array<string,mixed> $state
     *
     * @return array<string,mixed>
     */
    public function recordReplayResult(array $state, string $userId, int $lastSeenVersion, int $currentVersion, ?int $replayedCount, string $result): array
    {
        $state = $this->normalize($state);
        $timestamp = $this->now();

        $state['replay']['attempts']++;
        if ($result === 'hit') {
            $state['replay']['hits']++;
        } elseif ($result === 'gap') {
            $state['replay']['gaps']++;
            $state['replay']['misses']++;
            $state['sync']['lastVersionGap'] = [
                'currentVersion' => $currentVersion,
                'reason' => 'version_gap',
                'clientActionId' => null,
                'at' => $timestamp,
            ];
        } else {
            $state['replay']['misses']++;
        }

        $state['replay']['lastWindow'] = [
            'userId' => $userId,
            'lastSeenVersion' => $lastSeenVersion,
            'currentVersion' => $currentVersion,
            'replayedCount' => $replayedCount,
            'result' => $result,
            'at' => $timestamp,
        ];

        $state = $this->appendRecent($state, [
            'kind' => 'replay',
            'userId' => $userId,
            'lastSeenVersion' => $lastSeenVersion,
            'currentVersion' => $currentVersion,
            'replayedCount' => $replayedCount,
            'result' => $result,
            'at' => $timestamp,
        ]);

        return $state;
    }

    /**
     * @param array<string,mixed> $state
     * @param array<string,mixed> $item
     *
     * @return array<string,mixed>
     */
    private function appendRecent(array $state, array $item): array
    {
        $state['recent'][] = $item;
        if (count($state['recent']) > self::MAX_RECENT_ITEMS) {
            $state['recent'] = array_slice($state['recent'], -self::MAX_RECENT_ITEMS);
        }

        return $state;
    }

    /**
     * @param array<string,mixed> $state
     * @param array<string,mixed> $item
     *
     * @return array<string,mixed>
     */
    private function appendEvent(array $state, array $item): array
    {
        $state['events'][] = $item;
        if (count($state['events']) > self::MAX_EVENT_ITEMS) {
            $state['events'] = array_slice($state['events'], -self::MAX_EVENT_ITEMS);
        }

        return $state;
    }

    /**
     * @param array<string,mixed> $state
     */
    private function recordErrorData(array &$state, string $code, string $message, string $timestamp): void
    {
        $normalizedCode = trim($code) !== '' ? trim($code) : 'UNKNOWN_ERROR';

        $state['errors']['total']++;
        $state['errors']['byCode'][$normalizedCode] = (int) ($state['errors']['byCode'][$normalizedCode] ?? 0) + 1;
        $state['sync']['lastError'] = [
            'code' => $normalizedCode,
            'message' => $message,
            'at' => $timestamp,
        ];
    }

    /**
     * @param array<string,mixed> $message
     *
     * @return array<string,mixed>
     */
    private function compactMessage(array $message): array
    {
        $compact = $message;

        if (isset($compact['operations']) && is_array($compact['operations'])) {
            $compact['operations'] = array_map(
                static function (mixed $operation): mixed {
                    if (!is_array($operation)) {
                        return $operation;
                    }

                    $summary = [
                        'op' => $operation['op'] ?? null,
                    ];
                    if (isset($operation['playerId'])) {
                        $summary['playerId'] = $operation['playerId'];
                    }
                    if (isset($operation['zone'])) {
                        $summary['zone'] = $operation['zone'];
                    }
                    if (isset($operation['instanceId'])) {
                        $summary['instanceId'] = $operation['instanceId'];
                    }

                    return $summary;
                },
                $compact['operations'],
            );
        }

        if (isset($compact['event']) && is_array($compact['event'])) {
            $compact['event'] = [
                'id' => $compact['event']['id'] ?? null,
                'type' => $compact['event']['type'] ?? null,
                'clientActionId' => $compact['event']['clientActionId'] ?? null,
                'createdAt' => $compact['event']['createdAt'] ?? null,
            ];
        }

        return $compact;
    }

    private function now(): string
    {
        return (new \DateTimeImmutable())->format(DATE_ATOM);
    }
}
