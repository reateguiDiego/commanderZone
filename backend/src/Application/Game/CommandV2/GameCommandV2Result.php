<?php

namespace App\Application\Game\CommandV2;

final readonly class GameCommandV2Result
{
    /**
     * @param array<string,mixed>      $eventPayload
     * @param list<array<string,mixed>> $operations
     */
    public function __construct(
        private ?string $logMessage,
        private array $eventPayload,
        private array $operations,
        private bool $appendEventLog = true,
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
}
