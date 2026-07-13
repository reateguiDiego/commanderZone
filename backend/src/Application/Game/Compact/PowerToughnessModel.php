<?php

namespace App\Application\Game\Compact;

final class PowerToughnessModel
{
    public const NUMERIC = 'NUMERIC';
    public const FORMULA = 'FORMULA';
    public const SYMBOLIC = 'UNKNOWN_SYMBOLIC';
    public const ABSENT = 'ABSENT';

    /** @return array{value:?string,kind:string} */
    public static function classify(mixed $value): array
    {
        if ($value === null) {
            return ['value' => null, 'kind' => self::ABSENT];
        }

        $normalized = trim((string) $value);
        if ($normalized === '') {
            return ['value' => null, 'kind' => self::ABSENT];
        }
        $normalized = str_replace('x', 'X', $normalized);
        if (preg_match('/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/D', $normalized) === 1) {
            return ['value' => $normalized, 'kind' => self::NUMERIC];
        }
        if (str_contains($normalized, '*') || str_contains($normalized, 'X')) {
            return ['value' => $normalized, 'kind' => self::FORMULA];
        }

        return ['value' => $normalized, 'kind' => self::SYMBOLIC];
    }

    /**
     * @param array<string,mixed> $card
     * @return array<string,array<string,mixed>>
     */
    public static function printedStats(array $card): array
    {
        $provenance = ($card['isTokenCopy'] ?? false) === true || (($card['tokenMeta']['isCopy'] ?? false) === true)
            ? 'copy_effect'
            : (($card['isToken'] ?? false) === true ? 'token_creation' : 'printed');
        $faces = is_array($card['cardFaces'] ?? null) ? array_values($card['cardFaces']) : [];
        if ($faces === []) {
            $faces = [[
                'power' => array_key_exists('defaultPower', $card) ? $card['defaultPower'] : ($card['power'] ?? null),
                'toughness' => array_key_exists('defaultToughness', $card) ? $card['defaultToughness'] : ($card['toughness'] ?? null),
            ]];
        }

        $printed = [];
        foreach ($faces as $index => $face) {
            $face = is_array($face) ? $face : [];
            $power = self::classify($face['power'] ?? null)['value'];
            $toughness = self::classify($face['toughness'] ?? null)['value'];
            $printed[(string) $index] = [
                'faceKey' => (string) $index,
                'faceIndex' => $index,
                'power' => $power,
                'toughness' => $toughness,
                'provenance' => $provenance,
            ];
        }

        return $printed;
    }

    /**
     * @param array<string,mixed> $card
     * @param array<string,array<string,mixed>> $printedStats
     * @return array<string,array<string,mixed>>
     */
    public static function manualOverrides(array $card, array $printedStats): array
    {
        if (is_array($card['manualOverrides'] ?? null)) {
            $normalized = [];
            foreach ($card['manualOverrides'] as $faceKey => $override) {
                if (!is_array($override)) {
                    continue;
                }
                $entry = $override;
                foreach (['power', 'toughness'] as $axis) {
                    if (array_key_exists($axis, $entry)) {
                        $entry[$axis] = self::overrideValue($entry[$axis]);
                    }
                }
                if (!array_key_exists('power', $entry) && !array_key_exists('toughness', $entry)) {
                    continue;
                }
                $entry['faceKey'] = (string) $faceKey;
                $entry['faceIndex'] = isset($entry['faceIndex']) ? max(0, (int) $entry['faceIndex']) : max(0, (int) $faceKey);
                $entry['provenance'] = is_string($entry['provenance'] ?? null) ? $entry['provenance'] : 'imported_legacy';
                $normalized[(string) $faceKey] = $entry;
            }

            return $normalized;
        }

        $faceIndex = max(0, (int) ($card['activeFaceIndex'] ?? $card['activeFace'] ?? 0));
        $faceKey = (string) $faceIndex;
        $printed = $printedStats[$faceKey] ?? null;
        if (!is_array($printed)) {
            return [];
        }
        $override = [];
        foreach (['power', 'toughness'] as $axis) {
            if (!array_key_exists($axis, $card)) {
                continue;
            }
            $current = self::overrideValue($card[$axis]);
            if ($current === null || self::legacyValueMeansNoOverride($printed[$axis] ?? null, $current)) {
                continue;
            }
            $override[$axis] = $current;
        }
        if ($override === []) {
            return [];
        }
        $override['faceKey'] = $faceKey;
        $override['faceIndex'] = $faceIndex;
        $override['provenance'] = ($card['isTokenCopy'] ?? false) === true
            ? 'copy_effect'
            : (($card['isToken'] ?? false) === true ? 'token_creation' : 'imported_legacy');

        return [$faceKey => $override];
    }

    public static function activeAxis(array $printedStats, array $manualOverrides, int $faceIndex, string $axis): int|float|string|null
    {
        $faceKey = (string) max(0, $faceIndex);
        if (array_key_exists($axis, $manualOverrides[$faceKey] ?? [])) {
            return self::overrideValue($manualOverrides[$faceKey][$axis]);
        }

        return self::displayPrintedValue($printedStats[$faceKey][$axis] ?? null);
    }

    public static function overrideValue(mixed $value): int|float|string|null
    {
        if ($value === null || (is_string($value) && trim($value) === '')) {
            return null;
        }
        if (is_int($value) || is_float($value)) {
            return is_finite((float) $value) ? $value : null;
        }
        if (!is_string($value) && !is_numeric($value)) {
            return null;
        }
        $classified = self::classify($value);
        if ($classified['value'] === null) {
            return null;
        }
        if ($classified['kind'] !== self::NUMERIC) {
            return $classified['value'];
        }

        return str_contains($classified['value'], '.') ? (float) $classified['value'] : (int) $classified['value'];
    }

    private static function displayPrintedValue(mixed $value): int|float|string|null
    {
        $classified = self::classify($value);
        if ($classified['value'] === null) {
            return null;
        }
        if ($classified['kind'] !== self::NUMERIC) {
            return $classified['value'];
        }

        return str_contains($classified['value'], '.') ? (float) $classified['value'] : (int) $classified['value'];
    }

    private static function legacyValueMeansNoOverride(mixed $printedValue, int|float|string $current): bool
    {
        $printed = self::classify($printedValue);
        $normalizedCurrent = self::classify($current);
        if (in_array($printed['kind'], [self::FORMULA, self::SYMBOLIC], true) && $normalizedCurrent['kind'] === self::NUMERIC && (float) $normalizedCurrent['value'] === 0.0) {
            return true;
        }
        if ($printed['kind'] === self::NUMERIC && $normalizedCurrent['kind'] === self::NUMERIC) {
            return (float) $printed['value'] === (float) $normalizedCurrent['value'];
        }

        return $printed['value'] === $normalizedCurrent['value'];
    }
}
