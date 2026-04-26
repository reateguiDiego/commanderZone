<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;

class DecklistExporter
{
    /**
     * @return array{format:string,filename:string,content:string}
     */
    public function export(Deck $deck, string $format): array
    {
        if (!in_array($format, DecklistParser::SUPPORTED_FORMATS, true)) {
            throw new \InvalidArgumentException('Unsupported decklist format.');
        }

        return [
            'format' => $format,
            'filename' => $this->filename($deck, $format),
            'content' => match ($format) {
                DecklistParser::FORMAT_MOXFIELD => $this->moxfield($deck),
                DecklistParser::FORMAT_ARCHIDEKT => $this->archidekt($deck),
                default => $this->plain($deck),
            },
        ];
    }

    private function plain(Deck $deck): string
    {
        return $this->sectioned($deck, 'Commander', 'Deck', false, false);
    }

    private function moxfield(Deck $deck): string
    {
        return $this->sectioned($deck, 'Commander', 'Deck', true, true);
    }

    private function archidekt(Deck $deck): string
    {
        return $this->sectioned($deck, 'Commanders', 'Mainboard', true, false);
    }

    private function sectioned(Deck $deck, string $commanderHeader, string $mainHeader, bool $withPrint, bool $withX): string
    {
        $sections = [
            DeckCard::SECTION_COMMANDER => [],
            DeckCard::SECTION_MAIN => [],
            DeckCard::SECTION_SIDEBOARD => [],
            DeckCard::SECTION_MAYBEBOARD => [],
        ];
        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            $sections[$deckCard->section()][] = $this->line($deckCard, $withPrint, $withX);
        }

        $lines = [];
        if ($sections[DeckCard::SECTION_COMMANDER] !== []) {
            $lines[] = $commanderHeader;
            array_push($lines, ...$sections[DeckCard::SECTION_COMMANDER]);
            $lines[] = '';
        }

        $lines[] = $mainHeader;
        array_push($lines, ...$sections[DeckCard::SECTION_MAIN]);

        if ($sections[DeckCard::SECTION_SIDEBOARD] !== []) {
            $lines[] = '';
            $lines[] = 'Sideboard';
            array_push($lines, ...$sections[DeckCard::SECTION_SIDEBOARD]);
        }

        if ($sections[DeckCard::SECTION_MAYBEBOARD] !== []) {
            $lines[] = '';
            $lines[] = 'Maybeboard';
            array_push($lines, ...$sections[DeckCard::SECTION_MAYBEBOARD]);
        }

        return trim(implode("\n", $lines));
    }

    private function line(DeckCard $deckCard, bool $withPrint, bool $withX): string
    {
        $card = $deckCard->card();
        $quantity = $withX ? $deckCard->quantity().'x' : (string) $deckCard->quantity();
        $line = sprintf('%s %s', $quantity, $card->name());

        if ($withPrint && $card->setCode() !== null && $card->collectorNumber() !== null) {
            $line .= sprintf(' (%s) %s', mb_strtoupper($card->setCode()), $card->collectorNumber());
        }

        return $line;
    }

    private function filename(Deck $deck, string $format): string
    {
        $slug = mb_strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', $deck->name()) ?? $deck->name(), '-'));

        return sprintf('%s-%s.txt', $slug !== '' ? $slug : 'deck', $format);
    }
}
