<?php

namespace App\Application\Game;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Compact\GameplayCompactRuntimeFlags;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use Symfony\Component\Uid\Uuid;

class GameSnapshotFactory
{
    private const PLAY_MAT_COUNTS_BY_COLOR = [
        'W' => 12,
        'U' => 15,
        'B' => 13,
        'R' => 10,
        'G' => 9,
        'C' => 7,
    ];

    public function __construct(
        ?GameRandomizer $randomizer = null,
        ?CompactGameCardStateMapper $compactStateMapper = null,
        ?GameplayCompactRuntimeFlags $compactRuntimeFlags = null,
    )
    {
        $this->randomizer = $randomizer ?? new GameRandomizer();
        $this->compactStateMapper = $compactStateMapper ?? new CompactGameCardStateMapper();
        $this->compactRuntimeFlags = $compactRuntimeFlags ?? new GameplayCompactRuntimeFlags();
    }

    private readonly GameRandomizer $randomizer;
    private readonly CompactGameCardStateMapper $compactStateMapper;
    private readonly GameplayCompactRuntimeFlags $compactRuntimeFlags;

    public function fromRoom(Room $room): array
    {
        $players = [];
        $usedBackgroundNames = [];

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
            $library = $this->randomizer->shuffle($library);
            $mulliganState = GameMulliganRules::calculateMulliganState($room->mulliganRule(), $room->firstMulliganFree(), 0);
            $openingHand = array_splice($library, 0, min($mulliganState['drawCount'], count($library)));
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
                'backgroundName' => $this->backgroundNameForDeck($deck, $colorIdentity, $usedBackgroundNames),
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
                'mulligan' => [
                    ...$mulliganState,
                    'status' => 'DECIDING',
                    'ready' => false,
                    'scryCardInstanceId' => null,
                ],
            ];
        }

        foreach ($players as $targetPlayerId => &$player) {
            foreach ($players as $sourcePlayerId => $sourcePlayer) {
                if ($targetPlayerId === $sourcePlayerId) {
                    continue;
                }

                foreach ($sourcePlayer['zones']['command'] ?? [] as $commander) {
                    $commanderInstanceId = (string) ($commander['instanceId'] ?? '');
                    if ($commanderInstanceId !== '') {
                        $player['commanderDamage'][$commanderInstanceId] = 0;
                    }
                }
            }
        }
        unset($player);

        $createdAt = (new \DateTimeImmutable())->format(DATE_ATOM);

        $snapshot = [
            'version' => 1,
            'ownerId' => $room->owner()->id(),
            'gamePhase' => 'MULLIGAN',
            'mulligan' => [
                'rule' => $room->mulliganRule(),
                'firstMulliganFree' => $room->firstMulliganFree(),
            ],
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
            'attachments' => [],
            'specialEntities' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => $createdAt,
            'updatedAt' => $createdAt,
        ];

        if ($this->compactRuntimeFlags->enabled()) {
            return $this->compactStateMapper->compactSnapshot($snapshot);
        }

        return $snapshot;
    }

    private function cardInstance(DeckCard $deckCard, string $ownerId, string $zone, bool $isCommander = false): array
    {
        $card = $deckCard->card();
        $baseLoyalty = $this->initialLoyalty($card);
        $baseDefense = $this->initialDefense($card);
        $basePower = $this->powerToughnessStat($card->power());
        $baseToughness = $this->powerToughnessStat($card->toughness());

        return [
            'instanceId' => Uuid::v7()->toRfc4122(),
            'ownerId' => $ownerId,
            'controllerId' => $ownerId,
            'scryfallId' => $card->scryfallId(),
            'name' => $card->name(),
            'imageUris' => $card->imageUris(),
            'cardFaces' => $card->cardFaces(),
            'hasRulings' => $card->hasRulings(),
            'typeLine' => $card->typeLine(),
            'manaCost' => $card->manaCost(),
            'oracleText' => $card->oracleText(),
            'colorIdentity' => $this->orderedColorIdentity($card->colorIdentity()),
            'power' => $this->gameplayStat($basePower),
            'toughness' => $this->gameplayStat($baseToughness),
            'loyalty' => $this->gameplayStat($baseLoyalty),
            'defense' => $this->gameplayStat($baseDefense),
            'defaultPower' => $basePower,
            'defaultToughness' => $baseToughness,
            'defaultLoyalty' => $baseLoyalty,
            'defaultDefense' => $baseDefense,
            'tapped' => false,
            'faceDown' => false,
            'activeFaceIndex' => 0,
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

    /**
     * @param list<string> $colorIdentity
     * @param list<string> $usedBackgroundNames
     */
    private function backgroundNameForDeck(?Deck $deck, array $colorIdentity, array &$usedBackgroundNames): string
    {
        if (!$deck instanceof Deck) {
            return Deck::DEFAULT_BACKGROUND_NAME;
        }

        $storedBackgroundName = $deck->backgroundName();
        if ($storedBackgroundName !== Deck::DEFAULT_BACKGROUND_NAME && !in_array($storedBackgroundName, $usedBackgroundNames, true)) {
            $usedBackgroundNames[] = $storedBackgroundName;

            return $storedBackgroundName;
        }

        // TODO provisional: replace this automatic playmat pick with a real deck setting once users can choose playmats.
        $backgroundName = $this->temporaryPlayMatName($colorIdentity, $usedBackgroundNames);
        $usedBackgroundNames[] = $backgroundName;

        return $backgroundName;
    }

    /**
     * @param list<string> $colorIdentity
     * @param list<string> $usedBackgroundNames
     */
    private function temporaryPlayMatName(array $colorIdentity, array $usedBackgroundNames): string
    {
        $preferredColors = $colorIdentity === [] ? ['C'] : $colorIdentity;
        $selectedColor = $preferredColors === [] ? 'C' : $this->randomizer->pickOne($preferredColors);
        $candidates = $this->availablePlayMatNames([$selectedColor], $usedBackgroundNames);

        if ($candidates === []) {
            $candidates = $this->availablePlayMatNames($preferredColors, $usedBackgroundNames);
        }

        if ($candidates === []) {
            $candidates = $this->availablePlayMatNames(array_keys(self::PLAY_MAT_COUNTS_BY_COLOR), $usedBackgroundNames);
        }

        if ($candidates === []) {
            return Deck::DEFAULT_BACKGROUND_NAME;
        }

        return $this->randomizer->pickOne($candidates);
    }

    /**
     * @param list<string> $colors
     * @param list<string> $usedBackgroundNames
     *
     * @return list<string>
     */
    private function availablePlayMatNames(array $colors, array $usedBackgroundNames): array
    {
        $names = [];
        foreach ($colors as $color) {
            $playMatCount = self::PLAY_MAT_COUNTS_BY_COLOR[$color] ?? 0;
            for ($index = 1; $index <= $playMatCount; ++$index) {
                $name = sprintf('%s_%d', $color, $index);
                if (!in_array($name, $usedBackgroundNames, true)) {
                    $names[] = $name;
                }
            }
        }

        return $names;
    }

    private function printedCardStat(?string $value): int|string|null
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (int) $value : $value;
    }

    private function powerToughnessStat(?string $value): int|string|null
    {
        return $this->printedCardStat($value);
    }

    private function gameplayStat(mixed $value): int|string|null
    {
        $printed = $this->printedStat($value);
        if (!is_string($printed)) {
            return $printed;
        }

        return $this->isVariablePrintedStat($printed) ? 0 : $printed;
    }

    private function initialLoyalty(\App\Domain\Card\Card $card): int|string|null
    {
        $fromFaceStats = $this->loyaltyFromFaceStats($card->faceStats());
        if ($fromFaceStats !== null) {
            return $fromFaceStats;
        }

        $legacy = $this->printedCardStat($card->loyalty());
        if ($legacy !== null) {
            return $legacy;
        }

        return $this->loyaltyFromCardFaces($card->cardFaces());
    }

    private function initialDefense(\App\Domain\Card\Card $card): int|string|null
    {
        $fromFaceStats = $this->defenseFromFaceStats($card->faceStats());
        if ($fromFaceStats !== null) {
            return $fromFaceStats;
        }

        return $this->defenseFromCardFaces($card->cardFaces());
    }

    /**
     * @param array<string,mixed> $faceStats
     */
    private function loyaltyFromFaceStats(array $faceStats): int|string|null
    {
        $root = $faceStats['root'] ?? null;
        if (is_array($root)) {
            $rootLoyalty = $this->printedStat($root['loyalty'] ?? null);
            if ($rootLoyalty !== null) {
                return $rootLoyalty;
            }
        }

        $faces = $faceStats['faces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $loyalty = $this->printedStat($face['loyalty'] ?? null);
            if ($loyalty !== null) {
                return $loyalty;
            }
        }

        return null;
    }

    /**
     * @param list<array<string,mixed>> $faces
     */
    private function loyaltyFromCardFaces(array $faces): int|string|null
    {
        foreach ($faces as $face) {
            $loyalty = $this->printedStat($face['loyalty'] ?? null);
            if ($loyalty !== null) {
                return $loyalty;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $faceStats
     */
    private function defenseFromFaceStats(array $faceStats): int|string|null
    {
        $root = $faceStats['root'] ?? null;
        if (is_array($root)) {
            $rootDefense = $this->printedStat($root['defense'] ?? null);
            if ($rootDefense !== null) {
                return $rootDefense;
            }
        }

        $faces = $faceStats['faces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $defense = $this->printedStat($face['defense'] ?? null);
            if ($defense !== null) {
                return $defense;
            }
        }

        return null;
    }

    /**
     * @param list<array<string,mixed>> $faces
     */
    private function defenseFromCardFaces(array $faces): int|string|null
    {
        foreach ($faces as $face) {
            $defense = $this->printedStat($face['defense'] ?? null);
            if ($defense !== null) {
                return $defense;
            }
        }

        return null;
    }

    private function printedStat(mixed $value): int|string|null
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (int) $value : (string) $value;
    }

    private function isVariablePrintedStat(string $value): bool
    {
        return str_contains(strtolower($value), 'x') || str_contains($value, '*');
    }
}
