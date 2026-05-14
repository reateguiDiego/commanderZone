<?php

namespace App\Application\Game;

use App\Domain\Card\Card;
use Doctrine\ORM\EntityManagerInterface;

class GameCardBaseStatsResolver
{
    /**
     * @var array<string,array{power:?int,toughness:?int,loyalty:?int}|null>
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
     * @return array{power:?int,toughness:?int}|null
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
    public function baseLoyalty(array $card): ?int
    {
        return $this->baseCardValues($card)['loyalty'] ?? null;
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:?int,toughness:?int,loyalty:?int}|null
     */
    private function baseCardValues(array $card): ?array
    {
        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
        if ($scryfallId === '') {
            return [
                ...($this->baseCardValuesFromFaces($card) ?? ['power' => null, 'toughness' => null, 'loyalty' => null]),
                'loyalty' => $this->baseLoyaltyFromSnapshotCard($card),
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

        $legacyLoyalty = $this->numericStat($cardEntity->loyalty());
        $values = [
            'power' => $this->numericStat($cardEntity->power()),
            'toughness' => $this->numericStat($cardEntity->toughness()),
            'loyalty' => $this->loyaltyFromFaceStats($cardEntity->faceStats())
                ?? $legacyLoyalty
                ?? $this->loyaltyFromFaces($cardEntity->cardFaces()),
        ];
        if ($values['power'] === null && $values['toughness'] === null && $values['loyalty'] === null) {
            $values = $this->baseCardValuesFromFaces(['cardFaces' => $cardEntity->cardFaces()]) ?? $values;
        }

        $this->cache[$scryfallId] = $values;

        return $this->cache[$scryfallId];
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:?int,toughness:?int,loyalty:?int}|null
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

            $power = $this->numericStat($face['power'] ?? null);
            $toughness = $this->numericStat($face['toughness'] ?? null);
            $loyalty = $this->numericStat($face['loyalty'] ?? null);
            if ($power !== null || $toughness !== null || $loyalty !== null) {
                return ['power' => $power, 'toughness' => $toughness, 'loyalty' => $loyalty];
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function baseLoyaltyFromSnapshotCard(array $card): ?int
    {
        return $this->loyaltyFromFaceStats($card['faceStats'] ?? null)
            ?? $this->numericStat($card['loyalty'] ?? null)
            ?? $this->loyaltyFromFaces($card['cardFaces'] ?? null);
    }

    private function loyaltyFromFaceStats(mixed $faceStats): ?int
    {
        if (!is_array($faceStats)) {
            return null;
        }

        $root = $faceStats['root'] ?? null;
        if (is_array($root)) {
            $rootLoyalty = $this->numericStat($root['loyalty'] ?? null);
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

            $loyalty = $this->numericStat($face['loyalty'] ?? null);
            if ($loyalty !== null) {
                return $loyalty;
            }
        }

        return null;
    }

    private function loyaltyFromFaces(mixed $faces): ?int
    {
        if (!is_array($faces)) {
            return null;
        }

        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $loyalty = $this->numericStat($face['loyalty'] ?? null);
            if ($loyalty !== null) {
                return $loyalty;
            }
        }

        return null;
    }

    private function numericStat(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }
}
