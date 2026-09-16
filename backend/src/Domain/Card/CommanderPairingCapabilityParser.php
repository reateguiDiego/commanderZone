<?php

namespace App\Domain\Card;

final class CommanderPairingCapabilityParser
{
    public function parse(?string $oracleText): CommanderPairingCapability
    {
        foreach ($this->abilityLines($oracleText) as $line) {
            $partnerName = $this->namedPartner($line);
            if ($partnerName !== null) {
                return new CommanderPairingCapability(CommanderPairingAbility::NamedPartner, $partnerName);
            }

            if ($this->isGenericPartner($line)) {
                return new CommanderPairingCapability(CommanderPairingAbility::GenericPartner);
            }

            foreach ([
                [CommanderPairingAbility::FriendsForever, 'friends forever'],
                [CommanderPairingAbility::ChooseBackground, 'choose a background'],
                [CommanderPairingAbility::DoctorsCompanion, "doctor's companion"],
            ] as [$ability, $label]) {
                if ($this->isAbilityLine($line, $label)) {
                    return new CommanderPairingCapability($ability);
                }
            }
        }

        return new CommanderPairingCapability(CommanderPairingAbility::None);
    }

    /**
     * @return list<string>
     */
    private function abilityLines(?string $oracleText): array
    {
        $lines = preg_split('/\R/u', (string) $oracleText) ?: [];

        return array_values(array_filter(array_map(
            fn (string $line): string => $this->normalizeLine($line),
            $lines,
        ), static fn (string $line): bool => $line !== ''));
    }

    private function namedPartner(string $line): ?string
    {
        if (preg_match('/^partner\s+with\s+(.+?)(?:\s*\([^)]*\))?$/u', $line, $matches) !== 1) {
            return null;
        }

        $partnerName = Card::normalizeName($matches[1]);

        return $partnerName !== '' ? $partnerName : null;
    }

    private function isGenericPartner(string $line): bool
    {
        return preg_match('/^partner(?:\s*\([^)]*\)|\s*[-\x{2013}\x{2014}]\s*.+)?$/u', $line) === 1;
    }

    private function isAbilityLine(string $line, string $label): bool
    {
        $normalizedLine = str_replace(["\u{2018}", "\u{2019}"], "'", $line);

        return preg_match(
            '/^'.preg_quote($label, '/').'(?:\s*\([^)]*\)|\s*[-\x{2013}\x{2014}]\s*.+)?$/u',
            $normalizedLine,
        ) === 1;
    }

    private function normalizeLine(string $line): string
    {
        $normalized = trim($line);

        return mb_strtolower(preg_replace('/\s+/u', ' ', $normalized) ?? $normalized);
    }
}
