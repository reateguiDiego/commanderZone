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
            $line = trim(preg_replace('/\/\/.*$/', '', $line) ?? '');
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

            if (!preg_match('/^(?:(\d+)x?\s+)?(.+?)\s*(?:\([A-Z0-9]{2,5}\)\s*\d+)?$/i', $line, $matches)) {
                continue;
            }

            $entries[] = [
                'quantity' => isset($matches[1]) && $matches[1] !== '' ? (int) $matches[1] : 1,
                'name' => trim($matches[2]),
                'section' => $section,
            ];
        }

        return $entries;
    }
}
