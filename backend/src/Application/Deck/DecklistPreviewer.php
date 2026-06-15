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
    public function preview(array $entries, string $format, ?string $preferredLanguage = null, ?string $deckFormat = null): array
    {
        $resolvedEntries = [];
        $missingCards = [];
        $totalCards = 0;
        $resolvedCards = 0;

        foreach ($entries as $index => $entry) {
            $totalCards += $entry['quantity'];

            $card = $this->cardResolver->resolveForDecklistEntry($entry, $preferredLanguage, $deckFormat);
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

        $resolvedEntries = $this->inferCommanderSection($resolvedEntries, $format, $deckFormat);
        $counts = $this->sectionCounts($resolvedEntries);

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

    /**
     * @param array<int, array{quantity:int,name:string,section:string,setCode:?string,collectorNumber:?string,rawLine:string,line:int,resolved:bool,card:?Card}> $entries
     * @return array<int, array{quantity:int,name:string,section:string,setCode:?string,collectorNumber:?string,rawLine:string,line:int,resolved:bool,card:?Card}>
     */
    private function inferCommanderSection(array $entries, string $format, ?string $deckFormat): array
    {
        if ($entries === [] || !$this->shouldInferCommander($deckFormat)) {
            return $entries;
        }

        foreach ($entries as $entry) {
            if (($entry['section'] ?? DeckCard::SECTION_MAIN) === DeckCard::SECTION_COMMANDER) {
                return $entries;
            }
        }

        $candidateIndexes = [];
        $boundaryIndexes = $this->commanderBoundaryIndexes($entries, $format);
        foreach ($boundaryIndexes as $index) {
            $entry = $entries[$index] ?? null;
            $card = $entry['card'] ?? null;
            if (!is_array($entry) || !$card instanceof Card) {
                continue;
            }

            if (($entry['section'] ?? null) !== DeckCard::SECTION_MAIN) {
                continue;
            }

            if (($entry['quantity'] ?? 0) !== 1 || !$this->isCommanderCandidateCard($card)) {
                continue;
            }

            if (!$this->entrySupportsCommanderInference($entry, $format)) {
                continue;
            }

            $candidateIndexes[] = $index;
        }

        if (count($candidateIndexes) !== 1) {
            return $entries;
        }

        $entries[$candidateIndexes[0]]['section'] = DeckCard::SECTION_COMMANDER;

        return $entries;
    }

    /**
     * @param array<int, array{section:string,quantity:int}> $entries
     * @return array<string, int>
     */
    private function sectionCounts(array $entries): array
    {
        $counts = [
            DeckCard::SECTION_COMMANDER => 0,
            DeckCard::SECTION_MAIN => 0,
            DeckCard::SECTION_SIDEBOARD => 0,
            DeckCard::SECTION_MAYBEBOARD => 0,
        ];

        foreach ($entries as $entry) {
            $section = $entry['section'] ?? DeckCard::SECTION_MAIN;
            $counts[$section] = ($counts[$section] ?? 0) + (int) ($entry['quantity'] ?? 0);
        }

        return $counts;
    }

    private function shouldInferCommander(?string $deckFormat): bool
    {
        return $deckFormat === null || trim(mb_strtolower($deckFormat)) === 'commander';
    }

    /**
     * @param array<int, array{quantity:int,name:string,section:string,setCode:?string,collectorNumber:?string,rawLine:string,line:int,resolved:bool,card:?Card}> $entries
     * @return list<int>
     */
    private function commanderBoundaryIndexes(array $entries, string $format): array
    {
        $lastIndex = count($entries) - 1;

        return match (trim(mb_strtolower($format))) {
            DecklistParser::FORMAT_MOXFIELD => array_values(array_unique([0, $lastIndex])),
            DecklistParser::FORMAT_PLAIN => [$lastIndex],
            default => [],
        };
    }

    private function isCommanderCandidateCard(Card $card): bool
    {
        $typeLine = mb_strtolower($card->typeLine() ?? '');
        if (str_contains($typeLine, 'legendary') && str_contains($typeLine, 'creature')) {
            return true;
        }

        $oracleText = mb_strtolower($card->oracleText() ?? '');

        return str_contains($oracleText, 'can be your commander');
    }

    /**
     * @param array{quantity:int,name:string,section:string,setCode:?string,collectorNumber:?string,rawLine:string,line:int,resolved:bool,card:?Card} $entry
     */
    private function entrySupportsCommanderInference(array $entry, string $format): bool
    {
        if (trim(mb_strtolower($format)) !== DecklistParser::FORMAT_MOXFIELD) {
            return true;
        }

        return ($entry['setCode'] ?? null) !== null && ($entry['collectorNumber'] ?? null) !== null;
    }
}
