<?php

namespace App\Application\Game\Contract\V2;

final readonly class PatchEnvelopeV2 implements \JsonSerializable
{
    /**
     * @param list<array<string,mixed>> $ops
     */
    public function __construct(
        public string $gameId,
        public int $version,
        public string $visibility,
        public array $ops,
        public ?string $ackClientActionId = null,
    ) {
    }

    /**
     * @param array<string,mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $ops = ContractV2Assert::semanticOps(ContractV2Assert::requiredList($data, 'ops'));

        return new self(
            ContractV2Assert::requiredNonEmptyString($data, 'gameId'),
            ContractV2Assert::requiredPositiveInt($data, 'version'),
            ContractV2Assert::visibility(ContractV2Assert::requiredNonEmptyString($data, 'visibility')),
            $ops,
            ContractV2Assert::optionalNonEmptyString($data, 'ackClientActionId'),
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
            'visibility' => $this->visibility,
            'ops' => $this->ops,
        ];
        if ($this->ackClientActionId !== null) {
            $data['ackClientActionId'] = $this->ackClientActionId;
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
