<?php

namespace App\Domain\Card;

/** Commander rule 903.3: legendary Vehicles and Spacecraft with a P/T box. */
final class CommanderArtifactEligibility
{
    public static function matches(?string $typeLine, ?string $power, ?string $toughness, array $faces = []): bool
    {
        // A qualifying back face alone does not make the card a commander.
        $front = $faces[0] ?? [];
        $type = (string) ($front['type_line'] ?? $front['typeLine'] ?? explode('//', $typeLine ?? '')[0]);
        if (preg_match('/\blegendary\b/i', $type) !== 1) {
            return false;
        }
        if (preg_match('/\bvehicle\b/i', $type) === 1) {
            return true;
        }
        $power = $front['power'] ?? $power;
        $toughness = $front['toughness'] ?? $toughness;
        return preg_match('/\bspacecraft\b/i', $type) === 1
            && trim((string) $power) !== '' && trim((string) $toughness) !== '';
    }
}
