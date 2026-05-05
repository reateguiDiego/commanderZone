<?php

namespace App\Application\Deck;

use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;

class CommanderDeckValidator
{
    /**
     * @return array{
     *   valid:bool,
     *   format:string,
     *   counts:array{total:int,commander:int,main:int,sideboard:int,maybeboard:int},
     *   commander:array{mode:string,names:array<int,string>,colorIdentity:array<int,string>},
     *   errors:array<int,array{code:string,title:string,detail:string,cards:array<int,string>}>,
     *   warnings:array<int,array{code:string,title:string,detail:string,cards:array<int,string>}>
     * }
     */
    public function validate(Deck $deck): array
    {
        $errors = [];
        $warnings = [];
        $counts = [
            'total' => 0,
            'commander' => 0,
            'main' => 0,
            'sideboard' => 0,
            'maybeboard' => 0,
        ];
        $commanders = [];
        $mainByName = [];

        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            $quantity = max(1, $deckCard->quantity());
            $section = $deckCard->section();
            if (array_key_exists($section, $counts)) {
                $counts[$section] += $quantity;
            }
            if ($deckCard->isPlayable()) {
                $counts['total'] += $quantity;
            }

            $card = $deckCard->card();
            $cardName = $card->name();
            $commanderLegality = $this->commanderLegality($card);
            if ($commanderLegality === null) {
                $errors[] = $this->issue(
                    'card.data_insufficient',
                    'Card data is insufficient',
                    sprintf('%s does not provide enough Commander legality metadata.', $cardName),
                    [$cardName],
                );
            }

            if ($deckCard->isPlayable()) {
                if ($commanderLegality === 'banned') {
                    $errors[] = $this->issue(
                        'card.commander_banned',
                        'Card is banned in Commander',
                        sprintf('%s is banned in Commander.', $cardName),
                        [$cardName],
                    );
                } elseif ($commanderLegality === 'not_legal' || ($commanderLegality !== null && $commanderLegality !== 'legal') || !$card->isCommanderLegal()) {
                    $errors[] = $this->issue(
                        'card.commander_not_legal',
                        'Card is not legal in Commander',
                        sprintf('%s is marked as %s in Commander.', $cardName, $commanderLegality ?? 'not legal'),
                        [$cardName],
                    );
                }

                if ($section === DeckCard::SECTION_COMMANDER) {
                    $commanders[] = $deckCard;
                    continue;
                }

                if ($section === DeckCard::SECTION_MAIN) {
                    $name = $card->normalizedName();
                    if ($name === '') {
                        $name = Card::normalizeName($cardName);
                    }
                    $mainByName[$name] = ($mainByName[$name] ?? 0) + $quantity;
                    if (!$card->isBasicLand() && $mainByName[$name] > 1) {
                        $errors[] = $this->issue(
                            'card.singleton_violation',
                            'Singleton violation',
                            sprintf('%s appears %d times in the main deck.', $cardName, $mainByName[$name]),
                            [$cardName],
                        );
                    }
                }
            }

            if (preg_match('/modal_dfc|transform|meld/i', $card->layout()) === 1 || str_contains($cardName, '//')) {
                $warnings[] = $this->issue(
                    'card.layout_review',
                    'MDFC/layout review',
                    sprintf('%s uses %s; verify the face and color identity behavior.', $cardName, $card->layout()),
                    [$cardName],
                );
            }
        }

        if ($counts['sideboard'] > 0) {
            $errors[] = $this->issue(
                'deck.sideboard_not_allowed',
                'Sideboard is not allowed',
                sprintf('Commander validation requires sideboard to be empty; current sideboard count is %d.', $counts['sideboard']),
                [],
            );
        }

        if ($counts['maybeboard'] > 0) {
            $errors[] = $this->issue(
                'deck.maybeboard_not_allowed',
                'Maybeboard is not allowed',
                sprintf('Commander validation requires maybeboard to be empty; current maybeboard count is %d.', $counts['maybeboard']),
                [],
            );
        }

        if ($counts['total'] !== 100) {
            $errors[] = $this->issue(
                'deck.size.invalid',
                'Invalid deck size',
                sprintf('Commander decks must contain exactly 100 playable cards; current total is %d.', $counts['total']),
                [],
            );
        }

        $commanderNames = [];
        $allowedColors = [];
        foreach ($commanders as $commander) {
            $commanderNames[] = $commander->card()->name();
            $allowedColors = array_values(array_unique([...$allowedColors, ...$commander->card()->colorIdentity()]));
            if (!$this->isCommanderTypeValid($commander)) {
                $errors[] = $this->issue(
                    'commander.invalid',
                    'Commander card is invalid',
                    sprintf('%s does not look like a valid commander card.', $commander->card()->name()),
                    [$commander->card()->name()],
                );
            }
        }

        $commanderMode = 'invalid';
        if (count($commanders) < 1) {
            $errors[] = $this->issue('commander.missing', 'Missing commander', 'A Commander deck needs at least one commander card.', []);
        } elseif (count($commanders) > 2) {
            $errors[] = $this->issue(
                'commander.too_many',
                'Too many commanders',
                'Commander decks can use one commander, or a legal two-card pairing.',
                $commanderNames,
            );
        } elseif (count($commanders) === 1) {
            $commanderMode = 'single';
        } elseif (count($commanders) === 2) {
            if ($this->looksLikeLegalPair($commanders)) {
                $commanderMode = 'pair';
            } else {
                $errors[] = $this->issue(
                    'commander.pair_unsupported',
                    'Commander pair is not supported',
                    'The pair does not expose obvious partner/background wording in the available oracle text.',
                    $commanderNames,
                );
            }
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
                    $errors[] = $this->issue(
                        'card.color_identity_violation',
                        'Color identity issue',
                        sprintf('%s includes colors outside the command zone identity.', $deckCard->card()->name()),
                        [$deckCard->card()->name()],
                    );
                    break;
                }
            }
        }

        $errors = $this->uniqueIssues($errors);
        $warnings = $this->uniqueIssues($warnings);

        return [
            'valid' => $errors === [],
            'format' => 'commander',
            'counts' => $counts,
            'commander' => [
                'mode' => $commanderMode,
                'names' => $commanderNames,
                'colorIdentity' => $allowedColors,
            ],
            'errors' => $errors,
            'warnings' => $warnings,
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
     * @return array{code:string,title:string,detail:string,cards:array<int,string>}
     */
    private function issue(string $code, string $title, string $detail, array $cards): array
    {
        return [
            'code' => $code,
            'title' => $title,
            'detail' => $detail,
            'cards' => array_values($cards),
        ];
    }

    /**
     * @param list<array{code:string,title:string,detail:string,cards:array<int,string>}> $issues
     * @return list<array{code:string,title:string,detail:string,cards:array<int,string>}>
     */
    private function uniqueIssues(array $issues): array
    {
        $seen = [];
        $unique = [];
        foreach ($issues as $issue) {
            $key = $issue['code'].'|'.$issue['title'].'|'.$issue['detail'].'|'.implode(',', $issue['cards']);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $unique[] = $issue;
        }

        return $unique;
    }

    private function commanderLegality(Card $card): ?string
    {
        $value = $card->legalities()['commander'] ?? null;
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        return trim($value);
    }

    private function isCommanderTypeValid(DeckCard $deckCard): bool
    {
        $typeLine = mb_strtolower((string) ($deckCard->card()->typeLine() ?? ''));

        return str_contains($typeLine, 'legendary');
    }
}
