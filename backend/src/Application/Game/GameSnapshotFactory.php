<?php

namespace App\Application\Game;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use Symfony\Component\Uid\Uuid;

class GameSnapshotFactory
{
    public function fromRoom(Room $room): array
    {
        $players = [];

        foreach ($room->orderedPlayers() as $roomPlayer) {
            if (!$roomPlayer instanceof RoomPlayer) {
                continue;
            }

            $deck = $roomPlayer->deck();
            $library = [];
            foreach ($deck?->cards() ?? [] as $deckCard) {
                if (!$deckCard instanceof DeckCard || $deckCard->section() !== DeckCard::SECTION_MAIN) {
                    continue;
                }

                for ($i = 0; $i < $deckCard->quantity(); ++$i) {
                    $library[] = $this->cardInstance($deckCard, $roomPlayer->user()->id(), 'library');
                }
            }
            shuffle($library);
            $openingHand = array_splice($library, 0, min(7, count($library)));
            $openingHand = array_values(array_map(
                static fn (array $card): array => [...$card, 'zone' => 'hand'],
                $openingHand,
            ));

            $command = [];
            $colorIdentity = [];
            foreach ($deck?->cards() ?? [] as $deckCard) {
                if (!$deckCard instanceof DeckCard || $deckCard->section() !== DeckCard::SECTION_COMMANDER) {
                    continue;
                }

                $command[] = $this->cardInstance($deckCard, $roomPlayer->user()->id(), 'command', true);
                $colorIdentity = array_values(array_unique([...$colorIdentity, ...$deckCard->card()->colorIdentity()]));
            }
            $colorIdentity = $this->orderedColorIdentity($colorIdentity);

            $players[$roomPlayer->user()->id()] = [
                'user' => $roomPlayer->user()->toArray(),
                'status' => 'active',
                'concededAt' => null,
                'deckName' => $deck?->name(),
                'colorIdentity' => $colorIdentity,
                'backgroundName' => $deck?->backgroundName() ?? Deck::DEFAULT_BACKGROUND_NAME,
                'sleevesName' => $deck?->sleevesName() ?? Deck::DEFAULT_SLEEVES_NAME,
                'life' => $room->startingLife(),
                'zones' => [
                    'library' => $library,
                    'hand' => $openingHand,
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
            'ownerId' => $room->owner()->id(),
            'players' => $players,
            'turn' => [
                'activePlayerId' => array_key_first($players),
                'phase' => 'untap',
                'number' => 1,
            ],
            'timer' => [
                'mode' => $room->timerMode(),
                'durationSeconds' => $room->timerMode() === Room::TIMER_NONE ? null : $room->timerDurationSeconds(),
                'remainingSeconds' => $room->timerMode() === Room::TIMER_NONE ? null : $room->timerDurationSeconds(),
                'status' => 'idle',
            ],
            'stack' => [],
            'arrows' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => $createdAt,
            'updatedAt' => $createdAt,
        ];
    }

    private function cardInstance(DeckCard $deckCard, string $ownerId, string $zone, bool $isCommander = false): array
    {
        $card = $deckCard->card();

        return [
            'instanceId' => Uuid::v7()->toRfc4122(),
            'ownerId' => $ownerId,
            'controllerId' => $ownerId,
            'scryfallId' => $card->scryfallId(),
            'name' => $card->name(),
            'imageUris' => $card->imageUris(),
            'cardFaces' => $card->cardFaces(),
            'typeLine' => $card->typeLine(),
            'manaCost' => $card->manaCost(),
            'oracleText' => $card->oracleText(),
            'colorIdentity' => $this->orderedColorIdentity($card->colorIdentity()),
            'power' => $this->numericCardStat($card->power()),
            'toughness' => $this->numericCardStat($card->toughness()),
            'loyalty' => $this->numericCardStat($card->loyalty()),
            'defaultPower' => $this->numericCardStat($card->power()),
            'defaultToughness' => $this->numericCardStat($card->toughness()),
            'defaultLoyalty' => $this->numericCardStat($card->loyalty()),
            'tapped' => false,
            'faceDown' => false,
            'revealedTo' => [],
            'position' => ['x' => 0, 'y' => 0],
            'rotation' => 0,
            'counters' => [],
            'zone' => $zone,
            'isCommander' => $isCommander,
        ];
    }

    /**
     * @param list<string> $colors
     *
     * @return list<string>
     */
    private function orderedColorIdentity(array $colors): array
    {
        $colors = array_values(array_unique($colors));

        return array_values(array_filter(['W', 'U', 'B', 'R', 'G'], static fn (string $color): bool => in_array($color, $colors, true)));
    }

    private function numericCardStat(?string $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }
}
