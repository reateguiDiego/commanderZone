<?php

namespace App\Application\Deck;

class DecklistParser
{
    /**
     * @return array<int, array{quantity:int,name:string,section:string,setCode:?string,collectorNumber:?string}>
     */
    public function parse(string $decklist): array
    {
        $section = 'main';
        $entries = [];

        foreach (preg_split('/\R/', $decklist) ?: [] as $line) {
            $line = trim($line);
            if (str_starts_with($line, '//')) {
                continue;
            }
            if ($line === '') {
                continue;
            }

            $normalizedHeader = mb_strtolower(trim($line, ':'));
            if (in_array($normalizedHeader, ['commander', 'commanders'], true)) {
                $section = 'commander';
                continue;
            }
            if (in_array($normalizedHeader, ['deck', 'main', 'maindeck'], true)) {
                $section = 'main';
                continue;
            }

            if (!preg_match('/^(?:(\d+)x?\s+)?(.+)$/i', $line, $matches)) {
                continue;
            }

            $rawName = $matches[2];
            $printMetadata = $this->extractPrintMetadata($rawName);

            $entries[] = [
                'quantity' => isset($matches[1]) && $matches[1] !== '' ? (int) $matches[1] : 1,
                'name' => $this->cleanName($rawName),
                'section' => $section,
                'setCode' => $printMetadata['setCode'],
                'collectorNumber' => $printMetadata['collectorNumber'],
            ];
        }

        return $entries;
    }

    private function cleanName(string $name): string
    {
        $name = preg_replace('/\s+\*[A-Z]\*\s*$/i', '', $name) ?? $name;
        $name = preg_replace('/\s*[★☆]\s*$/u', '', $name) ?? $name;
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
