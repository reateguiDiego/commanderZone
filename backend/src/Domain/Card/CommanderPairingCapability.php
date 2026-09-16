<?php

namespace App\Domain\Card;

final readonly class CommanderPairingCapability
{
    public function __construct(
        public CommanderPairingAbility $ability,
        public ?string $partnerName = null,
    ) {
        if ($ability !== CommanderPairingAbility::NamedPartner && $partnerName !== null) {
            throw new \InvalidArgumentException('Only Partner with can include a named partner.');
        }

        if ($ability === CommanderPairingAbility::NamedPartner && ($partnerName === null || $partnerName === '')) {
            throw new \InvalidArgumentException('Partner with requires a partner name.');
        }
    }

    public function is(CommanderPairingAbility $ability): bool
    {
        return $this->ability === $ability;
    }
}
