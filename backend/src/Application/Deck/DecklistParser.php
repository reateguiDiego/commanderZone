<?php

namespace App\Application\Deck;

class DecklistParser
{
    /**
     * @return array<int, array{quantity:int,name:string,section:string}>
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

            $entries[] = [
                'quantity' => isset($matches[1]) && $matches[1] !== '' ? (int) $matches[1] : 1,
                'name' => $this->cleanName($matches[2]),
                'section' => $section,
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
}
