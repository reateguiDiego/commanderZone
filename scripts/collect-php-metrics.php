<?php

// Run through stdin in the API container. Never emit current URIs or credentials.
$context = stream_context_create(['http' => ['timeout' => 2, 'ignore_errors' => true]]);
$read = static fn (string $path): string => (string) @file_get_contents('http://127.0.0.1:2019'.$path, false, $context);
$threads = json_decode($read('/frankenphp/threads'), true);
$result = ['status' => 'unavailable', 'capturedAt' => gmdate('c'), 'queueDepth' => null];
if (is_array($threads['ThreadDebugStates'] ?? null)) {
    $states = $threads['ThreadDebugStates'];
    $result += [
        'totalThreads' => count($states),
        'busyThreads' => count(array_filter($states, static fn (array $t): bool => ($t['IsBusy'] ?? false) === true)),
        'reservedThreads' => $threads['ReservedThreadCount'] ?? null,
    ];
    $result['status'] = 'available';
}
if (preg_match('/^frankenphp_queue_depth(?:\{[^\n]*\})?\s+(\d+(?:\.\d+)?)\s*$/m', $read('/metrics'), $match)) {
    $result['queueDepth'] = (int) $match[1];
}
echo json_encode($result, JSON_THROW_ON_ERROR).PHP_EOL;
