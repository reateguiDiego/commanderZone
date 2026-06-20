<?php

namespace App\Application\Game\Contract\V2;

final readonly class EventPayloadV2 implements \JsonSerializable
{
    /**
     * @param array<string,mixed> $payload
     */
    public function __construct(
        public string $gameId,
        public int $version,
        public string $type,
        public array $payload,
        public ?string $createdBy,
        public ?string $clientActionId,
        public string $createdAt,
    ) {
    }

    /**
     * @param array<string,mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $createdAt = ContractV2Assert::optionalDateTimeString(
            ContractV2Assert::requiredNonEmptyString($data, 'createdAt'),
            'createdAt',
        );

        return new self(
            ContractV2Assert::requiredNonEmptyString($data, 'gameId'),
            ContractV2Assert::requiredPositiveInt($data, 'version'),
            ContractV2Assert::requiredNonEmptyString($data, 'type'),
            ContractV2Assert::requiredMap($data, 'payload'),
            ContractV2Assert::optionalNonEmptyString($data, 'createdBy'),
            ContractV2Assert::optionalNonEmptyString($data, 'clientActionId'),
            $createdAt ?? throw new \InvalidArgumentException('Field "createdAt" is required.'),
        );
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        $data = [
            'gameId' => $this->gameId,
            'version' => $this->version,
            'type' => $this->type,
            'payload' => $this->payload,
            'createdAt' => $this->createdAt,
        ];
        if ($this->createdBy !== null) {
            $data['createdBy'] = $this->createdBy;
        }
        if ($this->clientActionId !== null) {
            $data['clientActionId'] = $this->clientActionId;
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
}
