<?php

namespace App\Application\Game\Debug;

final class GameDebugHealthAggregator
{
    private const MAX_RECENT_ITEMS = 120;
    private const MAX_EVENT_ITEMS = 240;
    private const MAX_ACTION_ITEMS = 120;
    private const MAX_BOOTSTRAP_ITEMS = 60;
    private const BOOTSTRAP_STAGES = [
        'initial_snapshot',
        'websocket_ticket',
        'socket_connect',
        'first_connection_state',
        'first_mercure_event',
        'viewer_control_access',
        'first_render_ready',
    ];

    /**
     * @param array<string,mixed>|null $state
     *
     * @return array<string,mixed>
     */
    public function normalize(?array $state): array
    {
        $state = is_array($state) ? $state : [];
        $connectionsByUser = $this->normalizeConnectionsByUser($state['websocket']['connections']['byUser'] ?? []);

        return [
            'websocket' => [
                'connections' => [
                    'total' => (int) ($state['websocket']['connections']['total'] ?? 0),
                    'byUser' => $connectionsByUser,
                    'transitions' => [
                        'online' => (int) ($state['websocket']['connections']['transitions']['online'] ?? 0),
                        'offline' => (int) ($state['websocket']['connections']['transitions']['offline'] ?? 0),
                    ],
                    'disconnectRanking' => $this->disconnectRanking($connectionsByUser),
                ],
                'lastSeen' => is_array($state['websocket']['lastSeen'] ?? null) ? $state['websocket']['lastSeen'] : null,
            ],
            'traffic' => [
                'incoming' => $this->normalizeTrafficBucket($state['traffic']['incoming'] ?? []),
                'outgoing' => $this->normalizeTrafficBucket($state['traffic']['outgoing'] ?? []),
                'keepalive' => [
                    'incoming' => $this->normalizeTrafficBucket($state['traffic']['keepalive']['incoming'] ?? []),
                    'outgoing' => $this->normalizeTrafficBucket($state['traffic']['keepalive']['outgoing'] ?? []),
                ],
            ],
            'actions' => [
                'total' => (int) ($state['actions']['total'] ?? 0),
                'byType' => is_array($state['actions']['byType'] ?? null) ? $state['actions']['byType'] : [],
                'recent' => is_array($state['actions']['recent'] ?? null) ? array_values($state['actions']['recent']) : [],
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
            'performance' => [
                'commands' => [
                    'count' => (int) ($state['performance']['commands']['count'] ?? 0),
                    'totalMs' => round((float) ($state['performance']['commands']['totalMs'] ?? 0), 2),
                    'avgMs' => round((float) ($state['performance']['commands']['avgMs'] ?? 0), 2),
                    'maxMs' => round((float) ($state['performance']['commands']['maxMs'] ?? 0), 2),
                ],
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
                'recent' => is_array($state['errors']['recent'] ?? null) ? array_values($state['errors']['recent']) : [],
            ],
            'bootstrap' => [
                'stages' => $this->normalizeBootstrapStages($state['bootstrap']['stages'] ?? []),
                'recent' => is_array($state['bootstrap']['recent'] ?? null) ? array_values($state['bootstrap']['recent']) : [],
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
        $previousStatus = is_array($current) && is_string($current['status'] ?? null) ? $current['status'] : null;

        $state['websocket']['connections']['total'] = max(0, $totalConnections);
        $state['websocket']['connections']['byUser'][$userId] = [
            'displayName' => trim($displayName) !== '' ? trim($displayName) : $userId,
            'status' => $status,
            'connections' => max(0, $userConnections),
            'disconnects' => (int) ($current['disconnects'] ?? 0) + ($previousStatus !== $status && $status === 'offline' ? 1 : 0),
            'lastConnectedAt' => $status === 'online'
                ? $timestamp
                : (is_array($current) && is_string($current['lastConnectedAt'] ?? null) ? $current['lastConnectedAt'] : null),
            'lastDisconnectedAt' => $status === 'offline'
                ? $timestamp
                : (is_array($current) && is_string($current['lastDisconnectedAt'] ?? null) ? $current['lastDisconnectedAt'] : null),
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

        $state['websocket']['connections']['disconnectRanking'] = $this->disconnectRanking($state['websocket']['connections']['byUser']);

        return $state;
    }

    /**
     * @param array<string,mixed> $state
     * @param array<string,mixed> $message
     *
     * @return array<string,mixed>
     */
    public function recordIncomingMessage(array $state, array $message, int $characters): array
    {
        $state = $this->normalize($state);
        $timestamp = $this->now();
        $summary = $this->incomingSummary($message, $characters, $timestamp);

        if ($this->isKeepaliveKind($summary['kind'])) {
            $this->recordKeepaliveTraffic($state, 'incoming', $summary['kind'], $characters);
            $state['websocket']['lastSeen'] = [
                'direction' => 'incoming',
                'kind' => $summary['kind'],
                'action' => null,
                'at' => $timestamp,
            ];

            return $state;
        }

        $this->recordTraffic($state, 'incoming', $summary['kind'], $characters, $summary['action'] ?? null);
        $state['websocket']['lastSeen'] = [
            'direction' => 'incoming',
            'kind' => $summary['kind'],
            'action' => $summary['action'] ?? null,
            'at' => $timestamp,
        ];

        return $this->appendRecent($state, $summary);
    }

    /**
     * @param array<string,mixed> $state
     * @param array<string,mixed> $message
     *
     * @return array<string,mixed>
     */
    public function recordOutboundMessage(array $state, array $message, ?string $channel = null, ?int $characters = null): array
    {
        $state = $this->normalize($state);
        $timestamp = $this->now();
        $messageCharacters = $characters ?? $this->jsonCharacters($message);
        $summary = $this->outboundSummary($message, $channel, $messageCharacters, $timestamp);
        $message['characters'] = $messageCharacters;

        $this->recordOutboundPipeline($state, $message, $timestamp);
        if ($this->isKeepaliveKind($summary['kind'])) {
            $this->recordKeepaliveTraffic($state, 'outgoing', $summary['kind'], (int) $summary['characters'], null, $channel);
            $state['websocket']['lastSeen'] = [
                'direction' => 'outgoing',
                'kind' => $summary['kind'],
                'at' => $timestamp,
            ];

            return $state;
        }

        $this->recordTraffic($state, 'outgoing', $summary['kind'], (int) $summary['characters'], null, $channel);
        $state['websocket']['lastSeen'] = [
            'direction' => 'outgoing',
            'kind' => $summary['kind'],
            'at' => $timestamp,
        ];

        $state = $this->appendRecent($state, $summary);
        if (in_array($summary['kind'], ['game_patch', 'command_ack', 'resync_required', 'error'], true)) {
            $state = $this->appendEvent($state, $summary);
        }

        return $state;
    }

    /**
     * @param array<string,mixed>       $state
     * @param array<string,mixed>       $incoming
     * @param list<array<string,mixed>> $outgoing
     *
     * @return array<string,mixed>
     */
    public function recordActionExchange(array $state, array $incoming, array $outgoing, float $durationMs, ?array $phases = null): array
    {
        $state = $this->normalize($state);
        $timestamp = $this->now();
        $action = is_string($incoming['action'] ?? null) && trim($incoming['action']) !== ''
            ? trim($incoming['action'])
            : 'unknown';
        $incomingKind = is_string($incoming['kind'] ?? null) && trim($incoming['kind']) !== ''
            ? trim($incoming['kind'])
            : 'unknown';
        $incomingCharacters = max(0, (int) ($incoming['characters'] ?? 0));

        $this->recordTraffic($state, 'incoming', $incomingKind, $incomingCharacters, $action);
        $state['actions']['total']++;
        $state['actions']['byType'][$action] = (int) ($state['actions']['byType'][$action] ?? 0) + 1;
        $this->recordCommandPerformance($state, $durationMs);

        $outgoingSummary = $this->summarizeOutgoingBatch($outgoing);
        foreach ($outgoing as $message) {
            $kind = is_string($message['kind'] ?? null) ? $message['kind'] : 'unknown';
            $channel = is_string($message['channel'] ?? null) ? $message['channel'] : null;
            $characters = max(0, (int) ($message['characters'] ?? 0));
            $this->recordTraffic($state, 'outgoing', $kind, $characters, $action, $channel);
            $this->recordOutboundPipeline($state, $message, $timestamp);
        }

        $exchange = [
            'kind' => 'action_exchange',
            'action' => $action,
            'clientActionId' => is_string($incoming['clientActionId'] ?? null) ? $incoming['clientActionId'] : null,
            'userId' => is_string($incoming['userId'] ?? null) ? $incoming['userId'] : null,
            'baseVersion' => is_int($incoming['baseVersion'] ?? null) ? $incoming['baseVersion'] : null,
            'durationMs' => round(max(0, $durationMs), 2),
            'incoming' => [
                'kind' => $incomingKind,
                'characters' => $incomingCharacters,
            ],
            'outgoing' => $outgoingSummary,
            'at' => $timestamp,
        ];
        $normalizedPhases = $this->normalizeActionPhases($phases, $durationMs);
        if ($normalizedPhases !== null) {
            $exchange['phases'] = $normalizedPhases;
        }

        $state['actions']['recent'][] = $exchange;
        if (count($state['actions']['recent']) > self::MAX_ACTION_ITEMS) {
            $state['actions']['recent'] = array_slice($state['actions']['recent'], -self::MAX_ACTION_ITEMS);
        }

        $state['websocket']['lastSeen'] = [
            'direction' => 'exchange',
            'kind' => 'command',
            'action' => $action,
            'at' => $timestamp,
        ];

        $state = $this->appendRecent($state, $exchange);

        return $this->appendEvent($state, $exchange);
    }

    /**
     * @param array<string,mixed>|null $context
     *
     * @return array<string,mixed>
     */
    public function recordBootstrapStage(array $state, string $stage, float $durationMs, ?array $context = null, ?string $timestamp = null): array
    {
        $state = $this->normalize($state);
        $stage = in_array($stage, self::BOOTSTRAP_STAGES, true) ? $stage : 'first_render_ready';
        $durationMs = round(max(0, $durationMs), 2);
        $timestamp = $timestamp ?? $this->now();

        $stageState = $state['bootstrap']['stages'][$stage] ?? $this->emptyBootstrapStage();
        $stageState['count']++;
        $stageState['totalMs'] = round((float) $stageState['totalMs'] + $durationMs, 2);
        $stageState['avgMs'] = $stageState['count'] > 0
            ? round($stageState['totalMs'] / $stageState['count'], 2)
            : 0.0;
        $stageState['maxMs'] = round(max((float) $stageState['maxMs'], $durationMs), 2);
        $stageState['lastMs'] = $durationMs;
        $stageState['lastAt'] = $timestamp;
        $stageState['lastContext'] = is_array($context) && $context !== [] ? $context : null;
        $state['bootstrap']['stages'][$stage] = $stageState;

        $item = [
            'kind' => 'bootstrap',
            'stage' => $stage,
            'durationMs' => $durationMs,
            'at' => $timestamp,
        ];
        if (is_array($context) && $context !== []) {
            $item['context'] = $context;
        }

        $state['bootstrap']['recent'][] = $item;
        if (count($state['bootstrap']['recent']) > self::MAX_BOOTSTRAP_ITEMS) {
            $state['bootstrap']['recent'] = array_slice($state['bootstrap']['recent'], -self::MAX_BOOTSTRAP_ITEMS);
        }

        return $this->appendEvent($state, $item);
    }

    /**
     * @param array<string,mixed>|null $phases
     *
     * @return array<string,float>|null
     */
    private function normalizeActionPhases(?array $phases, float $durationMs): ?array
    {
        if (!is_array($phases)) {
            return null;
        }

        $normalized = [];
        foreach (['load', 'apply', 'persist', 'localization', 'projection', 'patch'] as $phase) {
            $normalized[$phase] = round(max(0, (float) ($phases[$phase] ?? 0)), 2);
        }
        $normalized['total'] = round(max(0, (float) ($phases['total'] ?? $durationMs)), 2);
        foreach ($phases as $key => $value) {
            if (!is_string($key) || isset($normalized[$key]) || !is_numeric($value)) {
                continue;
            }

            $normalized[$key] = round((float) $value, 2);
        }

        return $normalized;
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
        $characters = max(0, (int) ($meta['characters'] ?? 0));
        $kind = is_string($meta['kind'] ?? null) ? $meta['kind'] : 'invalid';
        $action = is_string($meta['action'] ?? null) ? $meta['action'] : null;

        $state['pipeline']['error']++;
        $this->recordTraffic($state, 'incoming', $kind, $characters, $action);
        $this->recordErrorData($state, $code, $message, $timestamp);

        $item = [
            'kind' => 'incoming_error',
            'code' => $code,
            'meta' => [
                'kind' => $kind,
                'action' => $action,
                'characters' => $characters,
            ],
            'at' => $timestamp,
        ];

        $state = $this->appendRecent($state, $item);

        return $this->appendEvent($state, $item);
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

        return $this->appendRecent($state, [
            'kind' => 'replay',
            'userId' => $userId,
            'lastSeenVersion' => $lastSeenVersion,
            'currentVersion' => $currentVersion,
            'replayedCount' => $replayedCount,
            'result' => $result,
            'at' => $timestamp,
        ]);
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
     * @param array<string,mixed> $bucket
     *
     * @return array<string,mixed>
     */
    private function normalizeTrafficBucket(mixed $bucket): array
    {
        $bucket = is_array($bucket) ? $bucket : [];

        return [
            'messages' => (int) ($bucket['messages'] ?? 0),
            'characters' => (int) ($bucket['characters'] ?? 0),
            'byKind' => is_array($bucket['byKind'] ?? null) ? $bucket['byKind'] : [],
            'byAction' => is_array($bucket['byAction'] ?? null) ? $bucket['byAction'] : [],
            'byChannel' => is_array($bucket['byChannel'] ?? null) ? $bucket['byChannel'] : [],
        ];
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    private function normalizeBootstrapStages(mixed $stages): array
    {
        $stages = is_array($stages) ? $stages : [];
        $normalized = [];
        foreach (self::BOOTSTRAP_STAGES as $stage) {
            $normalized[$stage] = $this->normalizeBootstrapStage($stages[$stage] ?? []);
        }

        return $normalized;
    }

    /**
     * @return array{count: int, totalMs: float, avgMs: float, maxMs: float, lastMs: float, lastAt: ?string, lastContext: ?array}
     */
    private function normalizeBootstrapStage(mixed $stage): array
    {
        $stage = is_array($stage) ? $stage : [];
        $count = max(0, (int) ($stage['count'] ?? 0));
        $totalMs = round(max(0, (float) ($stage['totalMs'] ?? 0)), 2);

        return [
            'count' => $count,
            'totalMs' => $totalMs,
            'avgMs' => $count > 0
                ? round((float) ($stage['avgMs'] ?? ($totalMs / $count)), 2)
                : 0.0,
            'maxMs' => round(max(0, (float) ($stage['maxMs'] ?? 0)), 2),
            'lastMs' => round(max(0, (float) ($stage['lastMs'] ?? 0)), 2),
            'lastAt' => is_string($stage['lastAt'] ?? null) ? $stage['lastAt'] : null,
            'lastContext' => is_array($stage['lastContext'] ?? null) ? $stage['lastContext'] : null,
        ];
    }

    /**
     * @return array{count: int, totalMs: float, avgMs: float, maxMs: float, lastMs: float, lastAt: null, lastContext: null}
     */
    private function emptyBootstrapStage(): array
    {
        return [
            'count' => 0,
            'totalMs' => 0.0,
            'avgMs' => 0.0,
            'maxMs' => 0.0,
            'lastMs' => 0.0,
            'lastAt' => null,
            'lastContext' => null,
        ];
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    private function normalizeConnectionsByUser(mixed $connections): array
    {
        if (!is_array($connections)) {
            return [];
        }

        $normalized = [];
        foreach ($connections as $userId => $connection) {
            if (!is_string($userId) || !is_array($connection)) {
                continue;
            }

            $displayName = is_string($connection['displayName'] ?? null) && trim($connection['displayName']) !== ''
                ? trim($connection['displayName'])
                : $userId;
            $status = is_string($connection['status'] ?? null) && trim($connection['status']) !== ''
                ? trim($connection['status'])
                : 'offline';

            $normalized[$userId] = [
                'displayName' => $displayName,
                'status' => $status,
                'connections' => max(0, (int) ($connection['connections'] ?? 0)),
                'disconnects' => max(0, (int) ($connection['disconnects'] ?? 0)),
                'lastConnectedAt' => is_string($connection['lastConnectedAt'] ?? null) ? $connection['lastConnectedAt'] : null,
                'lastDisconnectedAt' => is_string($connection['lastDisconnectedAt'] ?? null) ? $connection['lastDisconnectedAt'] : null,
                'offlineSince' => is_string($connection['offlineSince'] ?? null) ? $connection['offlineSince'] : null,
            ];
        }

        return $normalized;
    }

    /**
     * @param array<string,array<string,mixed>> $connectionsByUser
     *
     * @return list<array{userId: string, displayName: string, disconnects: int, status: string, lastDisconnectedAt: ?string}>
     */
    private function disconnectRanking(array $connectionsByUser): array
    {
        $ranking = [];
        foreach ($connectionsByUser as $userId => $connection) {
            $ranking[] = [
                'userId' => $userId,
                'displayName' => is_string($connection['displayName'] ?? null) ? $connection['displayName'] : $userId,
                'disconnects' => max(0, (int) ($connection['disconnects'] ?? 0)),
                'status' => is_string($connection['status'] ?? null) ? $connection['status'] : 'offline',
                'lastDisconnectedAt' => is_string($connection['lastDisconnectedAt'] ?? null) ? $connection['lastDisconnectedAt'] : null,
            ];
        }

        usort($ranking, static fn (array $left, array $right): int => $right['disconnects'] <=> $left['disconnects']
            ?: strcmp($left['displayName'], $right['displayName']));

        return $ranking;
    }

    /**
     * @param array<string,mixed> $state
     */
    private function recordTraffic(array &$state, string $direction, string $kind, int $characters, ?string $action = null, ?string $channel = null): void
    {
        $kind = trim($kind) !== '' ? trim($kind) : 'unknown';
        $state['traffic'][$direction]['messages']++;
        $state['traffic'][$direction]['characters'] += max(0, $characters);
        $state['traffic'][$direction]['byKind'][$kind] = (int) ($state['traffic'][$direction]['byKind'][$kind] ?? 0) + 1;

        if (is_string($action) && trim($action) !== '') {
            $action = trim($action);
            $state['traffic'][$direction]['byAction'][$action] = (int) ($state['traffic'][$direction]['byAction'][$action] ?? 0) + 1;
        }

        if (is_string($channel) && trim($channel) !== '') {
            $channel = trim($channel);
            $state['traffic'][$direction]['byChannel'][$channel] = (int) ($state['traffic'][$direction]['byChannel'][$channel] ?? 0) + 1;
        }
    }

    /**
     * @param array<string,mixed> $state
     */
    private function recordKeepaliveTraffic(array &$state, string $direction, string $kind, int $characters, ?string $action = null, ?string $channel = null): void
    {
        $kind = trim($kind) !== '' ? trim($kind) : 'unknown';
        $state['traffic']['keepalive'][$direction]['messages']++;
        $state['traffic']['keepalive'][$direction]['characters'] += max(0, $characters);
        $state['traffic']['keepalive'][$direction]['byKind'][$kind] = (int) ($state['traffic']['keepalive'][$direction]['byKind'][$kind] ?? 0) + 1;

        if (is_string($action) && trim($action) !== '') {
            $action = trim($action);
            $state['traffic']['keepalive'][$direction]['byAction'][$action] = (int) ($state['traffic']['keepalive'][$direction]['byAction'][$action] ?? 0) + 1;
        }

        if (is_string($channel) && trim($channel) !== '') {
            $channel = trim($channel);
            $state['traffic']['keepalive'][$direction]['byChannel'][$channel] = (int) ($state['traffic']['keepalive'][$direction]['byChannel'][$channel] ?? 0) + 1;
        }
    }

    /**
     * @param array<string,mixed> $state
     * @param array<string,mixed> $message
     */
    private function recordOutboundPipeline(array &$state, array $message, string $timestamp): void
    {
        $kind = is_string($message['kind'] ?? null) ? $message['kind'] : 'unknown';

        switch ($kind) {
            case 'game_patch':
                $state['pipeline']['gamePatch']++;
                $state['sync']['lastGamePatch'] = [
                    'baseVersion' => (int) ($message['baseVersion'] ?? 0),
                    'version' => (int) ($message['version'] ?? 0),
                    'clientActionId' => is_string($message['clientActionId'] ?? null) ? $message['clientActionId'] : null,
                    'operationTypes' => $this->operationTypes($message),
                    'characters' => (int) ($message['characters'] ?? 0),
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
                    $errorMessage = is_string($message['error']['message'] ?? null) ? $message['error']['message'] : 'Command acknowledgement error.';
                    $state['sync']['lastConflict'] = [
                        'status' => $status,
                        'version' => (int) ($message['version'] ?? 0),
                        'clientActionId' => is_string($message['clientActionId'] ?? null) ? $message['clientActionId'] : null,
                        'code' => is_string($message['error']['code'] ?? null) ? $message['error']['code'] : null,
                        'message' => $errorMessage,
                        'at' => $timestamp,
                    ];
                    $this->recordErrorData($state, (string) ($message['error']['code'] ?? strtoupper($status)), $errorMessage, $timestamp);
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
                $this->recordErrorData($state, (string) ($message['error']['code'] ?? 'UNKNOWN_ERROR'), (string) ($message['error']['message'] ?? 'WebSocket error response.'), $timestamp);
                break;

            case 'pong':
                $state['pipeline']['pong']++;
                break;

            case 'player_presence_changed':
                $state['pipeline']['presenceChanged']++;
                break;
        }
    }

    /**
     * @param array<string,mixed> $state
     */
    private function recordCommandPerformance(array &$state, float $durationMs): void
    {
        $durationMs = max(0, $durationMs);
        $state['performance']['commands']['count']++;
        $state['performance']['commands']['totalMs'] = round((float) $state['performance']['commands']['totalMs'] + $durationMs, 2);
        $state['performance']['commands']['maxMs'] = round(max((float) $state['performance']['commands']['maxMs'], $durationMs), 2);
        $state['performance']['commands']['avgMs'] = $state['performance']['commands']['count'] > 0
            ? round($state['performance']['commands']['totalMs'] / $state['performance']['commands']['count'], 2)
            : 0;
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
        $state['errors']['recent'][] = [
            'code' => $normalizedCode,
            'message' => $message,
            'at' => $timestamp,
        ];
        if (count($state['errors']['recent']) > self::MAX_RECENT_ITEMS) {
            $state['errors']['recent'] = array_slice($state['errors']['recent'], -self::MAX_RECENT_ITEMS);
        }
    }

    /**
     * @param array<string,mixed> $message
     *
     * @return array<string,mixed>
     */
    private function incomingSummary(array $message, int $characters, string $timestamp): array
    {
        $kind = is_string($message['kind'] ?? null) ? $message['kind'] : 'unknown';
        $command = is_array($message['command'] ?? null) ? $message['command'] : [];

        return [
            'direction' => 'incoming',
            'kind' => $kind,
            'action' => is_string($command['type'] ?? null) ? $command['type'] : null,
            'clientActionId' => is_string($command['clientActionId'] ?? null) ? $command['clientActionId'] : null,
            'userId' => is_string($message['userId'] ?? null) ? $message['userId'] : null,
            'baseVersion' => is_int($command['baseVersion'] ?? null) ? $command['baseVersion'] : null,
            'characters' => max(0, $characters),
            'at' => $timestamp,
        ];
    }

    /**
     * @param array<string,mixed> $message
     *
     * @return array<string,mixed>
     */
    private function outboundSummary(array $message, ?string $channel, int $characters, string $timestamp): array
    {
        $kind = is_string($message['kind'] ?? null) ? $message['kind'] : 'unknown';

        return [
            'direction' => 'outgoing',
            'kind' => $kind,
            'channel' => $channel,
            'characters' => max(0, $characters),
            'status' => is_string($message['status'] ?? null) ? $message['status'] : null,
            'error' => $this->errorSummary($message),
            'version' => is_int($message['version'] ?? null) ? $message['version'] : null,
            'currentVersion' => is_int($message['currentVersion'] ?? null) ? $message['currentVersion'] : null,
            'operationTypes' => $this->operationTypes($message),
            'operationCount' => is_array($message['operations'] ?? null) ? count($message['operations']) : 0,
            'at' => $timestamp,
        ];
    }

    /**
     * @param list<array<string,mixed>> $outgoing
     *
     * @return array<string,mixed>
     */
    private function summarizeOutgoingBatch(array $outgoing): array
    {
        $summary = [
            'messages' => count($outgoing),
            'characters' => 0,
            'byKind' => [],
            'byChannel' => [],
            'operationTypes' => [],
            'operationCount' => 0,
            'recipientCount' => 0,
            'maxMessageCharacters' => 0,
            'errors' => [],
        ];

        $recipients = [];
        $operationTypes = [];
        foreach ($outgoing as $message) {
            $kind = is_string($message['kind'] ?? null) ? $message['kind'] : 'unknown';
            $channel = is_string($message['channel'] ?? null) ? $message['channel'] : 'unknown';
            $characters = max(0, (int) ($message['characters'] ?? 0));

            $summary['characters'] += $characters;
            $summary['maxMessageCharacters'] = max($summary['maxMessageCharacters'], $characters);
            $summary['byKind'][$kind] = (int) ($summary['byKind'][$kind] ?? 0) + 1;
            $summary['byChannel'][$channel] = (int) ($summary['byChannel'][$channel] ?? 0) + 1;

            if (is_string($message['recipientUserId'] ?? null)) {
                $recipients[$message['recipientUserId']] = true;
            }

            foreach ($this->operationTypes($message) as $operationType) {
                $operationTypes[$operationType] = true;
            }
            if (is_array($message['operations'] ?? null)) {
                $summary['operationCount'] += count($message['operations']);
            }
            $error = $this->errorSummary($message);
            if ($error !== null) {
                $summary['errors'][] = [
                    'kind' => $kind,
                    'status' => is_string($message['status'] ?? null) ? $message['status'] : null,
                    ...$error,
                ];
            }
        }

        $summary['operationTypes'] = array_values(array_keys($operationTypes));
        $summary['recipientCount'] = count($recipients);

        return $summary;
    }

    /**
     * @param array<string,mixed> $message
     *
     * @return list<string>
     */
    private function operationTypes(array $message): array
    {
        $operations = is_array($message['operations'] ?? null)
            ? $message['operations']
            : (is_array($message['ops'] ?? null) ? $message['ops'] : null);
        if (!is_array($operations)) {
            return [];
        }

        $types = [];
        foreach ($operations as $operation) {
            if (is_array($operation) && is_string($operation['op'] ?? null) && trim($operation['op']) !== '') {
                $types[$operation['op']] = true;
            }
        }

        return array_values(array_keys($types));
    }

    /**
     * @param array<string,mixed> $message
     *
     * @return array{code: ?string, message: ?string, retryable: ?bool}|null
     */
    private function errorSummary(array $message): ?array
    {
        if (!is_array($message['error'] ?? null)) {
            return null;
        }

        $error = $message['error'];

        return [
            'code' => is_string($error['code'] ?? null) ? $error['code'] : null,
            'message' => is_string($error['message'] ?? null) ? $error['message'] : null,
            'retryable' => is_bool($error['retryable'] ?? null) ? $error['retryable'] : null,
        ];
    }

    /**
     * @param array<string,mixed> $message
     */
    private function jsonCharacters(array $message): int
    {
        try {
            return strlen(json_encode($message, JSON_THROW_ON_ERROR));
        } catch (\JsonException) {
            return 0;
        }
    }

    private function isKeepaliveKind(mixed $kind): bool
    {
        return $kind === 'ping' || $kind === 'pong';
    }

    private function now(): string
    {
        return (new \DateTimeImmutable())->format(DATE_ATOM);
    }
}
