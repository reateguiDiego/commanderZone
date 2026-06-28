<?php

namespace App\Application\Game\Contract\V2;

final readonly class CommandEnvelopeV2 implements \JsonSerializable
{
    /**
     * @param array<string,mixed> $payload
     * @param array<string,mixed>|null $client
     */
    public function __construct(
        public string $gameId,
        public int $baseVersion,
        public string $clientActionId,
        public string $type,
        public array $payload,
        public ?string $sentAt = null,
        public ?array $client = null,
    ) {
    }

    /**
     * @param array<string,mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $payload = ContractV2Assert::requiredMap($data, 'payload');
        $sentAt = ContractV2Assert::optionalDateTimeString(
            ContractV2Assert::optionalNonEmptyString($data, 'sentAt'),
            'sentAt',
        );

        return new self(
            ContractV2Assert::requiredNonEmptyString($data, 'gameId'),
            ContractV2Assert::requiredPositiveInt($data, 'baseVersion'),
            ContractV2Assert::requiredNonEmptyString($data, 'clientActionId'),
            ContractV2Assert::requiredNonEmptyString($data, 'type'),
            $payload,
            $sentAt,
            ContractV2Assert::optionalMap($data, 'client'),
        );
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        $data = [
            'gameId' => $this->gameId,
            'baseVersion' => $this->baseVersion,
            'clientActionId' => $this->clientActionId,
            'type' => $this->type,
            'payload' => $this->payload,
        ];
        if ($this->sentAt !== null) {
            $data['sentAt'] = $this->sentAt;
        }
        if ($this->client !== null) {
            $data['client'] = $this->client;
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
