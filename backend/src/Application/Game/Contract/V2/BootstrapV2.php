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
     * @param array<string,array<string,int>> $sharedCounters
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
        public array $sharedCounters,
        public array $relations,
        public array $turn,
        public array $staticCards,
        public ?string $chatCursor,
        public ?string $logCursor,
        public string $rulesVersion = 'commanderzone-manual-v1',
        public string $cardCatalogVersion = 'legacy-snapshot-v1',
        public ?int $payloadBytes = null,
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
            self::validateSharedCounters(self::optionalSharedCountersMap($data)),
            ContractV2Assert::requiredMap($data, 'relations'),
            ContractV2Assert::requiredMap($data, 'turn'),
            self::validateStaticCards($data),
            ContractV2Assert::optionalNonEmptyString($data, 'chatCursor'),
            ContractV2Assert::optionalNonEmptyString($data, 'logCursor'),
            is_string($data['rulesVersion'] ?? null) && trim((string) $data['rulesVersion']) !== ''
                ? trim((string) $data['rulesVersion'])
                : 'commanderzone-manual-v1',
            is_string($data['cardCatalogVersion'] ?? null) && trim((string) $data['cardCatalogVersion']) !== ''
                ? trim((string) $data['cardCatalogVersion'])
                : 'legacy-snapshot-v1',
            is_int($data['payloadBytes'] ?? null) && (int) $data['payloadBytes'] >= 0 ? (int) $data['payloadBytes'] : null,
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
            'rulesVersion' => $this->rulesVersion,
            'cardCatalogVersion' => $this->cardCatalogVersion,
        ];
        if ($this->sharedCounters !== []) {
            $data['sharedCounters'] = $this->sharedCounters;
        }
        if ($this->chatCursor !== null) {
            $data['chatCursor'] = $this->chatCursor;
        }
        if ($this->logCursor !== null) {
            $data['logCursor'] = $this->logCursor;
        }
        if ($this->payloadBytes !== null) {
            $data['payloadBytes'] = $this->payloadBytes;
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

    /**
     * @param array<string,mixed> $data
     * @return array<string,array<string,mixed>>
     */
    private static function validateStaticCards(array $data): array
    {
        $value = $data['staticCards'] ?? null;
        if ($value === []) {
            return [];
        }
        if (!is_array($value) || array_is_list($value)) {
            throw new \InvalidArgumentException('Field "staticCards" must be an object.');
        }

        return $value;
    }

    /**
     * @param array<string,mixed> $sharedCounters
     * @return array<string,array<string,int>>
     */
    private static function validateSharedCounters(array $sharedCounters): array
    {
        $normalized = [];
        foreach ($sharedCounters as $scope => $counters) {
            if (!is_string($scope) || $scope === '' || !is_array($counters) || array_is_list($counters)) {
                throw new \InvalidArgumentException('Field "sharedCounters" must be an object of counter maps.');
            }

            $normalizedCounters = [];
            foreach ($counters as $key => $value) {
                if (!is_string($key) || $key === '' || !is_int($value)) {
                    throw new \InvalidArgumentException('Field "sharedCounters" must contain integer counter values.');
                }

                $normalizedCounters[$key] = $value;
            }

            $normalized[$scope] = $normalizedCounters;
        }

        return $normalized;
    }

    /**
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    private static function optionalSharedCountersMap(array $data): array
    {
        $value = $data['sharedCounters'] ?? null;
        if ($value === null || $value === []) {
            return [];
        }
        if (!is_array($value) || array_is_list($value)) {
            throw new \InvalidArgumentException('Field "sharedCounters" must be an object when provided.');
        }

        return $value;
    }
}
