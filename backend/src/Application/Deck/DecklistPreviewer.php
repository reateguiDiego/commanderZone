<?php

namespace App\Application\Deck;

use App\Application\Card\CardResolver;
use App\Domain\Card\Card;

class DecklistPreviewer
{
    public function __construct(private readonly CardResolver $cardResolver)
    {
    }

    /**
     * @param array<int, array{quantity:int,name:string,section:string,setCode:?string,collectorNumber:?string,rawLine:string}> $entries
     * @return array<string,mixed>
     */
    public function preview(array $entries, string $format): array
    {
        $resolvedEntries = [];
        $missingCards = [];
        $totalCards = 0;
        $resolvedCards = 0;
        $commanderCount = 0;
        $mainCount = 0;

        foreach ($entries as $index => $entry) {
            $totalCards += $entry['quantity'];
            if ($entry['section'] === 'commander') {
                $commanderCount += $entry['quantity'];
            } else {
                $mainCount += $entry['quantity'];
            }

            $card = $this->cardResolver->resolveForDecklistEntry($entry);
            if ($card instanceof Card) {
                $resolvedCards += $entry['quantity'];
            } else {
                $missingCards[] = [
                    'name' => $entry['name'],
                    'quantity' => $entry['quantity'],
                    'section' => $entry['section'],
                    'setCode' => $entry['setCode'],
                    'collectorNumber' => $entry['collectorNumber'],
                    'line' => $index + 1,
                    'rawLine' => $entry['rawLine'],
                    'reason' => 'not_found',
                ];
            }

            $resolvedEntries[] = [
                ...$entry,
                'line' => $index + 1,
                'resolved' => $card instanceof Card,
                'card' => $card,
            ];
        }

        return [
            'format' => $format,
            'entries' => $resolvedEntries,
            'summary' => [
                'format' => $format,
                'parsedCards' => count($entries),
                'totalCards' => $totalCards,
                'resolvedCards' => $resolvedCards,
                'importedCards' => $resolvedCards,
                'missingCards' => $totalCards - $resolvedCards,
                'commanderCount' => $commanderCount,
                'mainCount' => $mainCount,
            ],
            'missingCards' => $missingCards,
            'warnings' => $this->warnings($entries, $commanderCount),
        ];
    }

    /**
     * @param array<string,mixed> $preview
     * @return array<string,mixed>
     */
    public function toArray(array $preview): array
    {
        $entries = [];
        foreach ($preview['entries'] ?? [] as $entry) {
            $card = $entry['card'] ?? null;
            $entries[] = [
                'line' => $entry['line'],
                'quantity' => $entry['quantity'],
                'name' => $entry['name'],
                'section' => $entry['section'],
                'setCode' => $entry['setCode'],
                'collectorNumber' => $entry['collectorNumber'],
                'rawLine' => $entry['rawLine'],
                'resolved' => $entry['resolved'],
                'card' => $card instanceof Card ? $card->toArray() : null,
            ];
        }

        return [
            'format' => $preview['format'],
            'entries' => $entries,
            'summary' => $preview['summary'],
            'missingCards' => $preview['missingCards'],
            'warnings' => $preview['warnings'],
        ];
    }

    /**
     * @param array<int, array{quantity:int,name:string,section:string,setCode:?string,collectorNumber:?string,rawLine:string}> $entries
     * @return list<string>
     */
    private function warnings(array $entries, int $commanderCount): array
    {
        $warnings = [];
        if ($entries === []) {
            $warnings[] = 'Decklist is empty or invalid.';
        }
        if ($commanderCount === 0) {
            $warnings[] = 'No commander section was detected.';
        }

        return $warnings;
    }
}
