<?php

namespace App\Application\Deck;

use App\Application\Card\CardResolver;
use App\Domain\Card\Card;
use App\Domain\Deck\DeckCard;

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
        $counts = [
            DeckCard::SECTION_COMMANDER => 0,
            DeckCard::SECTION_MAIN => 0,
            DeckCard::SECTION_SIDEBOARD => 0,
            DeckCard::SECTION_MAYBEBOARD => 0,
        ];

        foreach ($entries as $index => $entry) {
            $totalCards += $entry['quantity'];
            $counts[$entry['section']] = ($counts[$entry['section']] ?? 0) + $entry['quantity'];

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
                'commanderCount' => $counts[DeckCard::SECTION_COMMANDER],
                'mainCount' => $counts[DeckCard::SECTION_MAIN],
                'sideboardCount' => $counts[DeckCard::SECTION_SIDEBOARD],
                'maybeboardCount' => $counts[DeckCard::SECTION_MAYBEBOARD],
                'playableTotal' => $counts[DeckCard::SECTION_COMMANDER] + $counts[DeckCard::SECTION_MAIN],
            ],
            'missingCards' => $missingCards,
            'warnings' => $this->warnings($entries, $counts[DeckCard::SECTION_COMMANDER]),
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
