<?php

namespace App\Application\Game\Contract\V2;

final readonly class BootstrapV2 implements \JsonSerializable
{
    /**
     * @param array<string,mixed> $game
     * @param array<string,array<string,mixed>> $players
     * @param array<string,array<string,mixed>> $zones
     * @param array<string,array<string,mixed>> $instances
     * @param array<string,int> $zoneCounts
     * @param array<string,mixed> $relations
     * @param array<string,mixed> $turn
     * @param array<string,array<string,mixed>> $staticCards
     */
    public function __construct(
        public array $game,
        public array $players,
        public array $zones,
        public array $instances,
        public array $zoneCounts,
        public array $relations,
        public array $turn,
        public array $staticCards,
        public ?string $chatCursor,
        public ?string $logCursor,
    ) {
    }

    /**
     * @param array<string,mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            ContractV2Assert::requiredMap($data, 'game'),
            ContractV2Assert::requiredMap($data, 'players'),
            ContractV2Assert::requiredMap($data, 'zones'),
            ContractV2Assert::requiredMap($data, 'instances'),
            self::validateZoneCounts(ContractV2Assert::requiredMap($data, 'zoneCounts')),
            ContractV2Assert::requiredMap($data, 'relations'),
            ContractV2Assert::requiredMap($data, 'turn'),
            ContractV2Assert::requiredMap($data, 'staticCards'),
            ContractV2Assert::optionalNonEmptyString($data, 'chatCursor'),
            ContractV2Assert::optionalNonEmptyString($data, 'logCursor'),
        );
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        $data = [
            'game' => $this->game,
            'players' => $this->players,
            'zones' => $this->zones,
            'instances' => $this->instances,
            'zoneCounts' => $this->zoneCounts,
            'relations' => $this->relations,
            'turn' => $this->turn,
            'staticCards' => $this->staticCards,
        ];
        if ($this->chatCursor !== null) {
            $data['chatCursor'] = $this->chatCursor;
        }
        if ($this->logCursor !== null) {
            $data['logCursor'] = $this->logCursor;
        }

        return $data;
    }

    /**
     * @return array<string,mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    /**
     * @param array<string,mixed> $zoneCounts
     * @return array<string,int>
     */
    private static function validateZoneCounts(array $zoneCounts): array
    {
        $normalized = [];
        foreach ($zoneCounts as $zoneId => $count) {
            if (!is_string($zoneId) || $zoneId === '' || !is_int($count) || $count < 0) {
                throw new \InvalidArgumentException('Field "zoneCounts" must be an object keyed by zone id with non-negative integer values.');
            }

            $normalized[$zoneId] = $count;
        }

        return $normalized;
    }
}
