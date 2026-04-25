<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;

class CommanderDeckValidator
{
    /**
     * @return array{valid:bool,errors:array<int,string>}
     */
    public function validate(Deck $deck): array
    {
        $errors = [];
        $total = 0;
        $commanders = [];
        $mainByName = [];

        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            $total += $deckCard->quantity();
            $card = $deckCard->card();

            if (!$card->isCommanderLegal()) {
                $errors[] = sprintf('%s is not legal in Commander.', $card->name());
            }

            if ($deckCard->section() === DeckCard::SECTION_COMMANDER) {
                $commanders[] = $card;
                continue;
            }

            $name = $card->normalizedName();
            $mainByName[$name] = ($mainByName[$name] ?? 0) + $deckCard->quantity();
            if (!$card->isBasicLand() && $mainByName[$name] > 1) {
                $errors[] = sprintf('%s breaks Commander singleton.', $card->name());
            }
        }

        if ($total !== 100) {
            $errors[] = sprintf('Commander decks must contain exactly 100 cards; current total is %d.', $total);
        }

        if (count($commanders) < 1) {
            $errors[] = 'A Commander deck needs at least one commander card.';
        }

        $allowedColors = [];
        foreach ($commanders as $commander) {
            $allowedColors = array_values(array_unique([...$allowedColors, ...$commander->colorIdentity()]));
        }

        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            foreach ($deckCard->card()->colorIdentity() as $color) {
                if (!in_array($color, $allowedColors, true)) {
                    $errors[] = sprintf('%s is outside commander color identity.', $deckCard->card()->name());
                    break;
                }
            }
        }

        return [
            'valid' => $errors === [],
            'errors' => array_values(array_unique($errors)),
        ];
    }
}
