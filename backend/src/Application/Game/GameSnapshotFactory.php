<?php

namespace App\Application\Game;

use App\Domain\Deck\DeckCard;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use Symfony\Component\Uid\Uuid;

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
                    $library[] = $this->cardInstance($deckCard, $roomPlayer->user()->id(), 'library');
                }
            }
            shuffle($library);

            $command = [];
            foreach ($roomPlayer->deck()?->cards() ?? [] as $deckCard) {
                if (!$deckCard instanceof DeckCard || $deckCard->section() !== DeckCard::SECTION_COMMANDER) {
                    continue;
                }

                $command[] = $this->cardInstance($deckCard, $roomPlayer->user()->id(), 'command');
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

        foreach ($players as $targetPlayerId => &$player) {
            foreach (array_keys($players) as $sourcePlayerId) {
                if ($targetPlayerId !== $sourcePlayerId) {
                    $player['commanderDamage'][$sourcePlayerId] = 0;
                }
            }
        }
        unset($player);

        $createdAt = (new \DateTimeImmutable())->format(DATE_ATOM);

        return [
            'version' => 1,
            'players' => $players,
            'turn' => [
                'activePlayerId' => array_key_first($players),
                'phase' => 'untap',
                'number' => 1,
            ],
            'stack' => [],
            'arrows' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => $createdAt,
            'updatedAt' => $createdAt,
        ];
    }

    private function cardInstance(DeckCard $deckCard, string $ownerId, string $zone): array
    {
        $card = $deckCard->card();

        return [
            'instanceId' => Uuid::v7()->toRfc4122(),
            'ownerId' => $ownerId,
            'controllerId' => $ownerId,
            'scryfallId' => $card->scryfallId(),
            'name' => $card->name(),
            'imageUris' => $card->imageUris(),
            'typeLine' => $card->typeLine(),
            'manaCost' => $card->manaCost(),
            'power' => null,
            'toughness' => null,
            'loyalty' => null,
            'tapped' => false,
            'faceDown' => false,
            'revealedTo' => [],
            'position' => ['x' => 0, 'y' => 0],
            'rotation' => 0,
            'counters' => [],
            'zone' => $zone,
        ];
    }
}
