<?php

namespace App\Application\Deck;

use App\Domain\Deck\DeckCard;

class DecklistParser
{
    public const FORMAT_PLAIN = 'plain';
    public const FORMAT_MOXFIELD = 'moxfield';
    public const FORMAT_ARCHIDEKT = 'archidekt';

    public const SUPPORTED_FORMATS = [
        self::FORMAT_PLAIN,
        self::FORMAT_MOXFIELD,
        self::FORMAT_ARCHIDEKT,
    ];

    /**
     * @return array<int, array{quantity:int,name:string,section:string,setCode:?string,collectorNumber:?string,rawLine:string}>
     */
    public function parse(string $decklist, string $format = self::FORMAT_PLAIN): array
    {
        if (!in_array($format, self::SUPPORTED_FORMATS, true)) {
            throw new \InvalidArgumentException('Unsupported decklist format.');
        }

        $section = DeckCard::SECTION_MAIN;
        $entries = [];

        foreach (preg_split('/\R/', $decklist) ?: [] as $rawLine) {
            $line = trim($rawLine);
            if ($line === '' || str_starts_with($line, '//')) {
                continue;
            }

            $normalizedHeader = mb_strtolower(trim($line, ':'));
            $normalizedHeader = trim(preg_replace('/\s*\(\d+\)$/', '', $normalizedHeader) ?? $normalizedHeader);
            if (in_array($normalizedHeader, ['commander', 'commanders', 'command zone'], true)) {
                $section = DeckCard::SECTION_COMMANDER;
                continue;
            }
            if (in_array($normalizedHeader, ['sideboard', 'side'], true)) {
                $section = DeckCard::SECTION_SIDEBOARD;
                continue;
            }
            if (in_array($normalizedHeader, ['maybeboard', 'maybe', 'considering'], true)) {
                $section = DeckCard::SECTION_MAYBEBOARD;
                continue;
            }
            if (in_array($normalizedHeader, [
                'deck',
                'main',
                'maindeck',
                'mainboard',
                'creatures',
                'artifacts',
                'instants',
                'sorceries',
                'enchantments',
                'planeswalkers',
                'lands',
            ], true)) {
                $section = DeckCard::SECTION_MAIN;
                continue;
            }

            if (!preg_match('/^(?:(\d+)x?\s+)?(.+)$/i', $line, $matches)) {
                continue;
            }

            $quantity = isset($matches[1]) && $matches[1] !== '' ? (int) $matches[1] : 1;
            $rawName = $matches[2];
            $printMetadata = $this->extractPrintMetadata($rawName);
            $name = $this->cleanName($rawName);

            if ($quantity < 1 || $name === '') {
                continue;
            }

            $entries[] = [
                'quantity' => $quantity,
                'name' => $name,
                'section' => $section,
                'setCode' => $printMetadata['setCode'],
                'collectorNumber' => $printMetadata['collectorNumber'],
                'rawLine' => $line,
            ];
        }

        return $entries;
    }

    public function normalizeFormat(mixed $format): ?string
    {
        $normalized = mb_strtolower(trim((string) ($format ?: self::FORMAT_PLAIN)));

        return in_array($normalized, self::SUPPORTED_FORMATS, true) ? $normalized : null;
    }

    public function resolveFormat(mixed $format, string $decklist): ?string
    {
        if ($format !== null && trim((string) $format) !== '') {
            return $this->normalizeFormat($format);
        }

        return $this->detectFormat($decklist);
    }

    public function detectFormat(string $decklist): string
    {
        $archidektHeaders = 0;
        $moxfieldPrintLines = 0;
        $moxfieldQuantityLines = 0;

        foreach (preg_split('/\R/', $decklist) ?: [] as $rawLine) {
            $line = trim($rawLine);
            if ($line === '' || str_starts_with($line, '//')) {
                continue;
            }

            if (preg_match('/^(commanders?|command zone|deck|main|mainboard|sideboard|side|maybeboard|maybe|considering|creatures|artifacts|instants|sorceries|enchantments|planeswalkers|lands)\s*\(\d+\)\s*:?\s*$/i', $line) === 1) {
                ++$archidektHeaders;
                continue;
            }

            if (preg_match('/^\d+x\s+.+/i', $line) === 1) {
                ++$moxfieldQuantityLines;
                if (preg_match('/\([A-Z0-9]{2,8}\)\s+\S+/i', $line) === 1) {
                    ++$moxfieldPrintLines;
                }
            }
        }

        if ($archidektHeaders > 0) {
            return self::FORMAT_ARCHIDEKT;
        }

        if ($moxfieldPrintLines > 0 || $moxfieldQuantityLines >= 2) {
            return self::FORMAT_MOXFIELD;
        }

        return self::FORMAT_PLAIN;
    }

    private function cleanName(string $name): string
    {
        $name = preg_replace('/\s+\*[A-Z]\*\s*$/i', '', $name) ?? $name;
        $name = preg_replace('/\s*[\x{2605}\x{2606}]\s*$/u', '', $name) ?? $name;
        $name = preg_replace('/\s*[â˜…â˜†]\s*$/u', '', $name) ?? $name;
        $name = preg_replace('/\s+\([A-Z0-9]{2,8}\)\s+.+$/i', '', $name) ?? $name;
        $name = preg_replace('/\s+\/\s+/', ' // ', $name) ?? $name;
        $name = preg_replace('/\s*\[[^\]]+\]\s*$/', '', $name) ?? $name;
        $name = preg_replace('/\s+#\d+\s*$/', '', $name) ?? $name;

        return trim($name);
    }

    /**
     * @return array{setCode:?string,collectorNumber:?string}
     */
    private function extractPrintMetadata(string $name): array
    {
        if (!preg_match('/\(([A-Z0-9]{2,8})\)\s+([^\s]+)/i', $name, $matches)) {
            return ['setCode' => null, 'collectorNumber' => null];
        }

        return [
            'setCode' => mb_strtolower($matches[1]),
            'collectorNumber' => preg_replace('/[^A-Za-z0-9_.-]+$/', '', $matches[2]) ?: null,
        ];
    }
}
