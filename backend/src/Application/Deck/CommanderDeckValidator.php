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
            if ($deckCard->isPlayable()) {
                $commanderLegality = $this->commanderLegality($card);
                $commanderBanlistReason = $this->commanderBanlistReason($card);
                if ($commanderLegality === null) {
                    $errors[] = $this->issue(
                        'card.data_insufficient',
                        'Card data is insufficient',
                        sprintf('%s does not provide enough Commander legality metadata.', $cardName),
                        [$cardName],
                    );
                }

                if ($commanderLegality === 'banned' || $commanderBanlistReason !== null) {
                    $errors[] = $this->issue(
                        'card.commander_banned',
                        'Card is banned in Commander',
                        $commanderBanlistReason ?? sprintf('%s is banned in Commander.', $cardName),
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
                    $copyLimit = $this->commanderCopyLimit($card);
                    if ($copyLimit !== null && $mainByName[$name] > $copyLimit) {
                        $errors[] = $this->issue(
                            'card.singleton_violation',
                            'Singleton violation',
                            sprintf('%s appears %d times in the main deck; Commander allows up to %d.', $cardName, $mainByName[$name], $copyLimit),
                            [$cardName],
                        );
                    }
                }
            }
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
            if ($this->canBeCommander($commanders[0]->card())) {
                $commanderMode = 'single';
            } else {
                $errors[] = $this->issue(
                    'commander.invalid',
                    'Commander card is invalid',
                    sprintf('%s must be a legendary creature or explicitly say it can be your commander.', $commanders[0]->card()->name()),
                    [$commanders[0]->card()->name()],
                );
            }
        } elseif (count($commanders) === 2) {
            if ($this->isLegalCommanderPair($commanders[0]->card(), $commanders[1]->card())) {
                $commanderMode = 'pair';
            } else {
                $errors[] = $this->issue(
                    'commander.pair_unsupported',
                    'Commander pair is not supported',
                    'The two selected commanders do not match a supported pairing rule.',
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
            'format' => DeckFormatCatalog::COMMANDER,
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

    private function isLegalCommanderPair(Card $first, Card $second): bool
    {
        if ($this->hasGenericPartner($first) && $this->hasGenericPartner($second) && $this->canBeCommander($first) && $this->canBeCommander($second)) {
            return true;
        }

        if ($this->isNamedPartnerPair($first, $second) && $this->canBeCommander($first) && $this->canBeCommander($second)) {
            return true;
        }

        if ($this->hasFriendsForever($first) && $this->hasFriendsForever($second) && $this->canBeCommander($first) && $this->canBeCommander($second)) {
            return true;
        }

        if ($this->isChooseBackgroundPair($first, $second)) {
            return true;
        }

        return $this->isDoctorsCompanionPair($first, $second);
    }

    private function canBeCommander(Card $card): bool
    {
        return $this->isLegendaryCreature($card) || $this->oracleSaysCanBeCommander($card);
    }

    private function isLegendaryCreature(Card $card): bool
    {
        $typeLine = $this->normalizedText($card->typeLine());

        return str_contains($typeLine, 'legendary') && str_contains($typeLine, 'creature');
    }

    private function oracleSaysCanBeCommander(Card $card): bool
    {
        return preg_match('/\bcan be your commander\b/', $this->normalizedText($card->oracleText())) === 1;
    }

    private function hasGenericPartner(Card $card): bool
    {
        return preg_match('/(^|\n)\s*partner(?:\s*\(|\s*$)/', $this->normalizedText($card->oracleText())) === 1;
    }

    private function isNamedPartnerPair(Card $first, Card $second): bool
    {
        return $this->partnerWithName($first) === $this->normalizedCardName($second)
            && $this->partnerWithName($second) === $this->normalizedCardName($first);
    }

    private function partnerWithName(Card $card): ?string
    {
        if (preg_match('/(^|\n)\s*partner with ([^\n(]+)/', $this->normalizedText($card->oracleText()), $matches) !== 1) {
            return null;
        }

        $name = trim($matches[2], " \t\n\r\0\x0B.");

        return $name !== '' ? Card::normalizeName($name) : null;
    }

    private function hasFriendsForever(Card $card): bool
    {
        return str_contains($this->normalizedText($card->oracleText()), 'friends forever');
    }

    private function isChooseBackgroundPair(Card $first, Card $second): bool
    {
        return ($this->hasChooseBackground($first) && $this->canBeCommander($first) && $this->isBackground($second))
            || ($this->hasChooseBackground($second) && $this->canBeCommander($second) && $this->isBackground($first));
    }

    private function hasChooseBackground(Card $card): bool
    {
        return str_contains($this->normalizedText($card->oracleText()), 'choose a background');
    }

    private function isBackground(Card $card): bool
    {
        return str_contains($this->normalizedText($card->typeLine()), 'background');
    }

    private function isDoctorsCompanionPair(Card $first, Card $second): bool
    {
        return ($this->hasDoctorsCompanion($first) && $this->isLegendaryCreature($first) && $this->isDoctorCommander($second))
            || ($this->hasDoctorsCompanion($second) && $this->isLegendaryCreature($second) && $this->isDoctorCommander($first));
    }

    private function hasDoctorsCompanion(Card $card): bool
    {
        return str_contains($this->normalizedText($card->oracleText()), "doctor's companion");
    }

    private function isDoctorCommander(Card $card): bool
    {
        $typeLine = $this->normalizedText($card->typeLine());

        return $this->isLegendaryCreature($card) && str_contains($typeLine, 'time lord') && str_contains($typeLine, 'doctor');
    }

    private function normalizedCardName(Card $card): string
    {
        $name = $card->normalizedName();

        return $name !== '' ? $name : Card::normalizeName($card->name());
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

    private function commanderBanlistReason(Card $card): ?string
    {
        $typeLine = $this->normalizedText($card->typeLine());
        $oracleText = $this->normalizedText($card->oracleText());
        if (str_contains($typeLine, 'conspiracy')) {
            return sprintf('%s is banned in Commander because Conspiracy cards are banned.', $card->name());
        }

        if (preg_match('/\bante\b/', $oracleText) === 1) {
            return sprintf('%s is banned in Commander because it references ante.', $card->name());
        }

        if (preg_match('/\b(?:sticker|attraction)\b/', $typeLine."\n".$oracleText) === 1) {
            return sprintf('%s is banned in Commander because it brings sticker or Attraction mechanics into the game.', $card->name());
        }

        return null;
    }

    private function commanderCopyLimit(Card $card): ?int
    {
        if ($card->isBasicLand()) {
            return null;
        }

        $oracleText = $this->normalizedText($card->oracleText());
        if (str_contains($oracleText, 'a deck can have any number of cards named')) {
            return null;
        }

        if (preg_match('/a deck can have up to ([a-z0-9]+) cards named/', $oracleText, $matches) === 1) {
            return $this->numberFromRulesText($matches[1]) ?? 1;
        }

        return 1;
    }

    private function numberFromRulesText(string $value): ?int
    {
        if (ctype_digit($value)) {
            return (int) $value;
        }

        return [
            'one' => 1,
            'two' => 2,
            'three' => 3,
            'four' => 4,
            'five' => 5,
            'six' => 6,
            'seven' => 7,
            'eight' => 8,
            'nine' => 9,
            'ten' => 10,
            'eleven' => 11,
            'twelve' => 12,
            'thirteen' => 13,
            'fourteen' => 14,
            'fifteen' => 15,
            'sixteen' => 16,
            'seventeen' => 17,
            'eighteen' => 18,
            'nineteen' => 19,
            'twenty' => 20,
        ][$value] ?? null;
    }

    private function normalizedText(?string $value): string
    {
        return mb_strtolower(trim((string) $value));
    }
}
