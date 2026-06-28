<?php

namespace App\Application\Game\CommandV2;

final class PatchEmitterV2
{
    /**
     * @var list<array<string,mixed>>
     */
    private array $publicOps = [];

    /**
     * @var array<string,list<array<string,mixed>>>
     */
    private array $privateOpsByPlayer = [];

    /**
     * @var array<string,list<array<string,mixed>>>
     */
    private array $groupOpsByMask = [];

    private ?string $ackClientActionId = null;

    private ?int $version = null;

    /**
     * @param array<string,mixed> $op
     */
    public function addOp(string $visibilityGroup, array $op): self
    {
        if ($visibilityGroup === 'public') {
            return $this->emitPublic($op);
        }

        if (str_starts_with($visibilityGroup, 'player:')) {
            $playerId = substr($visibilityGroup, strlen('player:'));

            return $this->emitPrivate($playerId, $op);
        }

        if (str_starts_with($visibilityGroup, 'group:')) {
            $mask = (int) substr($visibilityGroup, strlen('group:'));

            return $this->emitGroup($mask, $op);
        }

        throw new \InvalidArgumentException(sprintf('Unsupported visibility group: %s', $visibilityGroup));
    }

    /**
     * @param array<string,mixed> $op
     */
    public function emitPublic(array $op): self
    {
        $this->publicOps[] = $op;

        return $this;
    }

    /**
     * @param array<string,mixed> $op
     */
    public function emitPrivate(string $playerId, array $op): self
    {
        $playerId = trim($playerId);
        if ($playerId === '') {
            throw new \InvalidArgumentException('playerId is required.');
        }

        $this->privateOpsByPlayer[$playerId] ??= [];
        $this->privateOpsByPlayer[$playerId][] = $op;

        return $this;
    }

    /**
     * @param array<string,mixed> $op
     */
    public function emitGroup(int $mask, array $op): self
    {
        if ($mask <= 0) {
            throw new \InvalidArgumentException('mask must be positive.');
        }

        $key = (string) $mask;
        $this->groupOpsByMask[$key] ??= [];
        $this->groupOpsByMask[$key][] = $op;

        return $this;
    }

    public function attachAck(?string $clientActionId): self
    {
        $this->ackClientActionId = is_string($clientActionId) && trim($clientActionId) !== ''
            ? trim($clientActionId)
            : null;

        return $this;
    }

    public function attachVersion(?int $version): self
    {
        $this->version = is_int($version) && $version > 0 ? $version : null;

        return $this;
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function publicOps(): array
    {
        return $this->publicOps;
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    public function viewerPayloads(): array
    {
        $payloads = [];
        foreach ($this->privateOpsByPlayer as $playerId => $operations) {
            $payloads[$playerId] = [
                'operations' => array_values($operations),
            ];
        }

        return $payloads;
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    public function groupPayloads(): array
    {
        $payloads = [];
        foreach ($this->groupOpsByMask as $mask => $operations) {
            $payloads['group:'.$mask] = [
                'operations' => array_values($operations),
            ];
        }

        return $payloads;
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
     * @param array<string,mixed> $eventPayload
     */
    public function toResult(
        ?string $logMessage,
        array $eventPayload,
        bool $appendEventLog = true,
        bool $sanitizeEventLog = false,
    ): GameCommandV2Result {
        return new GameCommandV2Result(
            $logMessage,
            $eventPayload,
            $this->publicOps(),
            $appendEventLog,
            $this->viewerPayloads(),
            $sanitizeEventLog,
            $this->groupPayloads(),
            $this->ackClientActionId(),
            $this->version(),
        );
    }
}
