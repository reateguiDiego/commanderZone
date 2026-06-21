<?php

namespace App\Application\Game\CommandV2;

final readonly class GameCommandV2Result
{
    /**
     * @param array<string,mixed>      $eventPayload
     * @param list<array<string,mixed>> $operations
     * @param array<string,array<string,mixed>> $viewerPayloads
     * @param array<string,array<string,mixed>> $groupPayloads
     */
    public function __construct(
        private ?string $logMessage,
        private array $eventPayload,
        private array $operations,
        private bool $appendEventLog = true,
        private array $viewerPayloads = [],
        private bool $sanitizeEventLog = false,
        private array $groupPayloads = [],
        private ?string $ackClientActionId = null,
        private ?int $version = null,
    ) {
    }

    public function logMessage(): ?string
    {
        return $this->logMessage;
    }

    /**
     * @return array<string,mixed>
     */
    public function eventPayload(): array
    {
        return $this->eventPayload;
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function operations(): array
    {
        return $this->operations;
    }

    public function appendEventLog(): bool
    {
        return $this->appendEventLog;
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    public function viewerPayloads(): array
    {
        return $this->viewerPayloads;
    }

    public function sanitizeEventLog(): bool
    {
        return $this->sanitizeEventLog;
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    public function groupPayloads(): array
    {
        return $this->groupPayloads;
    }

    public function ackClientActionId(): ?string
    {
        return $this->ackClientActionId;
    }

    public function version(): ?int
    {
        return $this->version;
    }

    /**
     * @param list<array<string,mixed>> $entries
     *
     * @return list<array<string,mixed>>
     */
    public function operationsWithEventLog(array $entries): array
    {
        if (!$this->appendEventLog() || $entries === []) {
            return $this->operations();
        }

        return [
            ...$this->operations(),
            [
                'op' => 'eventLog.append',
                'entries' => $entries,
            ],
        ];
    }

    /**
     * @param list<array<string,mixed>> $eventLogEntries
     *
     * @return array<string,mixed>
     */
    public function directPatchPayload(array $eventLogEntries): array
    {
        $payload = [
            'eventPayload' => $this->eventPayload(),
            'operations' => $this->operations(),
            'appendEventLog' => $this->appendEventLog(),
            'eventLogEntries' => $eventLogEntries,
            'sanitizeEventLog' => $this->sanitizeEventLog(),
        ];
        if ($this->ackClientActionId() !== null) {
            $payload['ackClientActionId'] = $this->ackClientActionId();
        }
        if ($this->version() !== null) {
            $payload['version'] = $this->version();
        }

        if ($this->viewerPayloads() === []) {
            if ($this->groupPayloads() === []) {
                return $payload;
            }
        } else {
            $payload['viewerPayloads'] = [];
            foreach ($this->viewerPayloads() as $viewerId => $viewerPayload) {
                if (!is_string($viewerId) || trim($viewerId) === '') {
                    continue;
                }

                $payload['viewerPayloads'][$viewerId] = [
                    'eventPayload' => is_array($viewerPayload['eventPayload'] ?? null)
                        ? $viewerPayload['eventPayload']
                        : $this->eventPayload(),
                    'operations' => is_array($viewerPayload['operations'] ?? null)
                        ? array_values($viewerPayload['operations'])
                        : $this->operations(),
                    'appendEventLog' => array_key_exists('appendEventLog', $viewerPayload)
                        ? (bool) $viewerPayload['appendEventLog']
                        : $this->appendEventLog(),
                    'sanitizeEventLog' => array_key_exists('sanitizeEventLog', $viewerPayload)
                        ? (bool) $viewerPayload['sanitizeEventLog']
                        : $this->sanitizeEventLog(),
                    'eventLogEntries' => is_array($viewerPayload['eventLogEntries'] ?? null)
                        ? array_values($viewerPayload['eventLogEntries'])
                        : $eventLogEntries,
                ];
            }
        }

        if ($this->groupPayloads() !== []) {
            $payload['groupPayloads'] = [];
            foreach ($this->groupPayloads() as $groupKey => $groupPayload) {
                if (!is_string($groupKey) || trim($groupKey) === '') {
                    continue;
                }

                $payload['groupPayloads'][$groupKey] = [
                    'eventPayload' => is_array($groupPayload['eventPayload'] ?? null)
                        ? $groupPayload['eventPayload']
                        : $this->eventPayload(),
                    'operations' => is_array($groupPayload['operations'] ?? null)
                        ? array_values($groupPayload['operations'])
                        : $this->operations(),
                    'appendEventLog' => array_key_exists('appendEventLog', $groupPayload)
                        ? (bool) $groupPayload['appendEventLog']
                        : $this->appendEventLog(),
                    'sanitizeEventLog' => array_key_exists('sanitizeEventLog', $groupPayload)
                        ? (bool) $groupPayload['sanitizeEventLog']
                        : $this->sanitizeEventLog(),
                    'eventLogEntries' => is_array($groupPayload['eventLogEntries'] ?? null)
                        ? array_values($groupPayload['eventLogEntries'])
                        : $eventLogEntries,
                ];
            }
        }

        return $payload;
    }
}
