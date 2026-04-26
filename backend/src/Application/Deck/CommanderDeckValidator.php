<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;

class CommanderDeckValidator
{
    /**
     * @return array{valid:bool,errors:array<int,string>,issues:array<int,array{severity:string,title:string,detail:string,cards:array<int,string>}>}
     */
    public function validate(Deck $deck): array
    {
        $issues = [];
        $total = 0;
        $commanders = [];
        $mainByName = [];

        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            $card = $deckCard->card();
            if (!$deckCard->isPlayable()) {
                $commanderLegality = $card->legalities()['commander'] ?? null;
                if (!$card->isCommanderLegal() || in_array($commanderLegality, ['banned', 'not_legal'], true)) {
                    $issues[] = $this->issue(
                        'warning',
                        'Non-playable section legality review',
                        sprintf('%s is in %s and is marked as %s in Commander.', $card->name(), $deckCard->section(), $commanderLegality ?? 'not legal'),
                        [$card->name()],
                    );
                }
                continue;
            }

            $total += $deckCard->quantity();

            $commanderLegality = $card->legalities()['commander'] ?? null;
            if (!$card->isCommanderLegal() || in_array($commanderLegality, ['banned', 'not_legal'], true)) {
                $issues[] = $this->issue(
                    'error',
                    'Commander legality issue',
                    sprintf('%s is marked as %s in Commander.', $card->name(), $commanderLegality ?? 'not legal'),
                    [$card->name()],
                );
            }

            if ($deckCard->section() === DeckCard::SECTION_COMMANDER) {
                $commanders[] = $deckCard;
                continue;
            }

            $name = $card->normalizedName();
            $mainByName[$name] = ($mainByName[$name] ?? 0) + $deckCard->quantity();
            if (!$card->isBasicLand() && $mainByName[$name] > 1) {
                $issues[] = $this->issue(
                    'error',
                    'Singleton violation',
                    sprintf('%s appears %d times in the main deck.', $card->name(), $mainByName[$name]),
                    [$card->name()],
                );
            }

            if (preg_match('/modal_dfc|transform|meld/i', $card->layout()) === 1 || str_contains($card->name(), '//')) {
                $issues[] = $this->issue(
                    'warning',
                    'MDFC/layout review',
                    sprintf('%s uses %s; verify the face and color identity behavior.', $card->name(), $card->layout()),
                    [$card->name()],
                );
            }
        }

        if ($total !== 100) {
            $issues[] = $this->issue(
                'error',
                'Invalid deck size',
                sprintf('Commander decks must contain exactly 100 cards; current total is %d.', $total),
                [],
            );
        }

        if (count($commanders) < 1) {
            $issues[] = $this->issue('error', 'Missing commander', 'A Commander deck needs at least one commander card.', []);
        }

        if (count($commanders) > 2) {
            $issues[] = $this->issue(
                'error',
                'Too many commanders',
                'Commander decks can use one commander, or a legal two-card pairing.',
                array_map(static fn (DeckCard $entry): string => $entry->card()->name(), $commanders),
            );
        }

        if (count($commanders) === 2 && !$this->looksLikeLegalPair($commanders)) {
            $issues[] = $this->issue(
                'warning',
                'Commander pair needs review',
                'The pair does not expose obvious partner/background wording in the available oracle text.',
                array_map(static fn (DeckCard $entry): string => $entry->card()->name(), $commanders),
            );
        }

        $allowedColors = [];
        foreach ($commanders as $commander) {
            $allowedColors = array_values(array_unique([...$allowedColors, ...$commander->card()->colorIdentity()]));
        }

        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }
            if ($deckCard->section() !== DeckCard::SECTION_MAIN || $commanders === []) {
                continue;
            }

            foreach ($deckCard->card()->colorIdentity() as $color) {
                if (!in_array($color, $allowedColors, true)) {
                    $issues[] = $this->issue(
                        'error',
                        'Color identity issue',
                        sprintf('%s includes colors outside the command zone identity.', $deckCard->card()->name()),
                        [$deckCard->card()->name()],
                    );
                    break;
                }
            }
        }

        $issues = $this->uniqueIssues($issues);
        $errors = array_values(array_map(
            static fn (array $issue): string => $issue['detail'],
            array_filter($issues, static fn (array $issue): bool => $issue['severity'] === 'error'),
        ));

        return [
            'valid' => $errors === [],
            'errors' => array_values(array_unique($errors)),
            'issues' => $issues,
        ];
    }

    /**
     * @param list<DeckCard> $commanders
     */
    private function looksLikeLegalPair(array $commanders): bool
    {
        $texts = array_map(
            static fn (DeckCard $entry): string => mb_strtolower(($entry->card()->typeLine() ?? '')."\n".($entry->card()->oracleText() ?? '')),
            $commanders,
        );

        $partnerCount = count(array_filter($texts, static fn (string $text): bool => str_contains($text, 'partner')));
        $hasChooseBackground = count(array_filter($texts, static fn (string $text): bool => str_contains($text, 'choose a background'))) > 0;
        $hasBackground = count(array_filter($texts, static fn (string $text): bool => str_contains($text, 'background'))) > 0;

        return $partnerCount === 2 || ($hasChooseBackground && $hasBackground);
    }

    /**
     * @return array{severity:string,title:string,detail:string,cards:array<int,string>}
     */
    private function issue(string $severity, string $title, string $detail, array $cards): array
    {
        return [
            'severity' => $severity,
            'title' => $title,
            'detail' => $detail,
            'cards' => array_values($cards),
        ];
    }

    /**
     * @param list<array{severity:string,title:string,detail:string,cards:array<int,string>}> $issues
     * @return list<array{severity:string,title:string,detail:string,cards:array<int,string>}>
     */
    private function uniqueIssues(array $issues): array
    {
        $seen = [];
        $unique = [];
        foreach ($issues as $issue) {
            $key = $issue['severity'].'|'.$issue['title'].'|'.$issue['detail'].'|'.implode(',', $issue['cards']);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $unique[] = $issue;
        }

        return $unique;
    }
}
