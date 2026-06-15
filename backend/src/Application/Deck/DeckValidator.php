<?php

namespace App\Application\Deck;

use App\Domain\Deck\Deck;

final class DeckValidator
{
    public function __construct(private readonly CommanderDeckValidator $commanderValidator)
    {
    }

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
        $format = DeckFormatCatalog::normalize($deck->format());

        return match ($format) {
            DeckFormatCatalog::COMMANDER => $this->commanderValidator->validate($deck),
            default => $this->unsupportedFormatResult($deck->format()),
        };
    }

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
    private function unsupportedFormatResult(string $format): array
    {
        return [
            'valid' => false,
            'format' => $format,
            'counts' => [
                'total' => 0,
                'commander' => 0,
                'main' => 0,
                'sideboard' => 0,
                'maybeboard' => 0,
            ],
            'commander' => [
                'mode' => 'invalid',
                'names' => [],
                'colorIdentity' => [],
            ],
            'errors' => [[
                'code' => 'deck.format.unsupported',
                'title' => 'Unsupported deck format',
                'detail' => sprintf('%s is not supported by the deck validator.', $format),
                'cards' => [],
            ]],
            'warnings' => [],
        ];
    }
}
