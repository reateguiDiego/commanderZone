<?php

namespace App\Application\Game;

use App\Domain\Deck\DeckCard;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;

class GameSnapshotFactory
{
    public function fromRoom(Room $room): array
    {
        $players = [];

        foreach ($room->players() as $roomPlayer) {
            if (!$roomPlayer instanceof RoomPlayer) {
                continue;
            }

            $library = [];
            foreach ($roomPlayer->deck()?->cards() ?? [] as $deckCard) {
                if (!$deckCard instanceof DeckCard || $deckCard->section() !== DeckCard::SECTION_MAIN) {
                    continue;
                }

                for ($i = 0; $i < $deckCard->quantity(); ++$i) {
                    $library[] = [
                        'instanceId' => $deckCard->card()->scryfallId().'-'.count($library),
                        'scryfallId' => $deckCard->card()->scryfallId(),
                        'name' => $deckCard->card()->name(),
                        'tapped' => false,
                    ];
                }
            }

            $command = [];
            foreach ($roomPlayer->deck()?->cards() ?? [] as $deckCard) {
                if (!$deckCard instanceof DeckCard || $deckCard->section() !== DeckCard::SECTION_COMMANDER) {
                    continue;
                }

                $command[] = [
                    'instanceId' => $deckCard->card()->scryfallId().'-commander',
                    'scryfallId' => $deckCard->card()->scryfallId(),
                    'name' => $deckCard->card()->name(),
                    'tapped' => false,
                ];
            }

            $players[$roomPlayer->user()->id()] = [
                'user' => $roomPlayer->user()->toArray(),
                'life' => 40,
                'zones' => [
                    'library' => $library,
                    'hand' => [],
                    'battlefield' => [],
                    'graveyard' => [],
                    'exile' => [],
                    'command' => $command,
                ],
                'commanderDamage' => [],
                'counters' => [],
            ];
        }

        return [
            'players' => $players,
            'turn' => [
                'activePlayerId' => array_key_first($players),
                'phase' => 'beginning',
                'number' => 1,
            ],
            'chat' => [],
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ];
    }
}
