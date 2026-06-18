<?php

namespace App\Application\Game;

use App\Domain\Card\Card;
use Doctrine\ORM\EntityManagerInterface;

class GameCardBaseStatsResolver
{
    /**
     * @var array<string,array{power:int|string|null,toughness:int|string|null,loyalty:int|string|null,defense:int|string|null}|null>
     */
    private array $cache = [];

    private ?EntityManagerInterface $entityManager = null;

    public function __construct(?EntityManagerInterface $entityManager = null)
    {
        $this->entityManager = $entityManager;
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:int|string|null,toughness:int|string|null}|null
     */
    public function baseStats(array $card): ?array
    {
        $values = $this->baseCardValues($card);
        if ($values === null) {
            return null;
        }

        return [
            'power' => $values['power'],
            'toughness' => $values['toughness'],
        ];
    }

    /**
     * @param array<string,mixed> $card
     */
    public function baseLoyalty(array $card): int|string|null
    {
        return $this->baseCardValues($card)['loyalty'] ?? null;
    }

    /**
     * @param array<string,mixed> $card
     */
    public function baseDefense(array $card): int|string|null
    {
        return $this->baseCardValues($card)['defense'] ?? null;
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:int|string|null,toughness:int|string|null,loyalty:int|string|null,defense:int|string|null}|null
     */
    private function baseCardValues(array $card): ?array
    {
        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
        if ($scryfallId === '') {
            $values = $this->baseCardValuesFromFaces($card)
                ?? ['power' => null, 'toughness' => null, 'loyalty' => null, 'defense' => null];

            return [
                'power' => $values['power'],
                'toughness' => $values['toughness'],
                'loyalty' => $this->baseLoyaltyFromSnapshotCard($card) ?? $values['loyalty'],
                'defense' => $this->baseDefenseFromSnapshotCard($card) ?? $values['defense'],
            ];
        }

        if (array_key_exists($scryfallId, $this->cache)) {
            return $this->cache[$scryfallId];
        }

        $cardEntity = $this->entityManager
            ? $this->entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $scryfallId])
            : null;
        if (!$cardEntity instanceof Card) {
            $this->cache[$scryfallId] = $this->baseCardValuesFromFaces($card);

            return $this->cache[$scryfallId];
        }

        $legacyLoyalty = $this->printedStat($cardEntity->loyalty());
        $values = [
            'power' => $this->powerToughnessStat($cardEntity->power()),
            'toughness' => $this->powerToughnessStat($cardEntity->toughness()),
            'loyalty' => $this->loyaltyFromFaceStats($cardEntity->faceStats())
                ?? $legacyLoyalty
                ?? $this->loyaltyFromFaces($cardEntity->cardFaces()),
            'defense' => $this->defenseFromFaceStats($cardEntity->faceStats())
                ?? $this->defenseFromFaces($cardEntity->cardFaces()),
        ];
        if ($values['power'] === null && $values['toughness'] === null && $values['loyalty'] === null && $values['defense'] === null) {
            $values = $this->baseCardValuesFromFaces(['cardFaces' => $cardEntity->cardFaces()]) ?? $values;
        }

        $this->cache[$scryfallId] = $values;

        return $this->cache[$scryfallId];
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:int|string|null,toughness:int|string|null,loyalty:int|string|null,defense:int|string|null}|null
     */
    private function baseCardValuesFromFaces(array $card): ?array
    {
        $faces = $card['cardFaces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $power = $this->powerToughnessStat($face['power'] ?? null);
            $toughness = $this->powerToughnessStat($face['toughness'] ?? null);
            $loyalty = $this->printedStat($face['loyalty'] ?? null);
            $defense = $this->printedStat($face['defense'] ?? null);
            if ($power !== null || $toughness !== null || $loyalty !== null || $defense !== null) {
                return ['power' => $power, 'toughness' => $toughness, 'loyalty' => $loyalty, 'defense' => $defense];
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function baseLoyaltyFromSnapshotCard(array $card): int|string|null
    {
        return $this->loyaltyFromFaceStats($card['faceStats'] ?? null)
            ?? $this->printedStat($card['loyalty'] ?? null)
            ?? $this->loyaltyFromFaces($card['cardFaces'] ?? null);
    }

    private function baseDefenseFromSnapshotCard(array $card): int|string|null
    {
        return $this->defenseFromFaceStats($card['faceStats'] ?? null)
            ?? $this->printedStat($card['defense'] ?? null)
            ?? $this->defenseFromFaces($card['cardFaces'] ?? null);
    }

    private function loyaltyFromFaceStats(mixed $faceStats): int|string|null
    {
        if (!is_array($faceStats)) {
            return null;
        }

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

    private function loyaltyFromFaces(mixed $faces): int|string|null
    {
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

    private function defenseFromFaceStats(mixed $faceStats): int|string|null
    {
        if (!is_array($faceStats)) {
            return null;
        }

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

    private function defenseFromFaces(mixed $faces): int|string|null
    {
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

    private function printedStat(mixed $value): int|string|null
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (int) $value : (string) $value;
    }

    private function powerToughnessStat(mixed $value): int|string|null
    {
        return $this->printedStat($value);
    }
}
