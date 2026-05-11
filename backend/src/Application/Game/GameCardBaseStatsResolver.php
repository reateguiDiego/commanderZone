<?php

namespace App\Application\Game;

use App\Domain\Card\Card;
use Doctrine\ORM\EntityManagerInterface;

class GameCardBaseStatsResolver
{
    /**
     * @var array<string,array{power:?int,toughness:?int}|null>
     */
    private array $cache = [];

    public function __construct(private readonly ?EntityManagerInterface $entityManager = null)
    {
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:?int,toughness:?int}|null
     */
    public function baseStats(array $card): ?array
    {
        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
        if ($scryfallId === '') {
            return $this->baseStatsFromFaces($card);
        }

        if (array_key_exists($scryfallId, $this->cache)) {
            return $this->cache[$scryfallId];
        }

        $cardEntity = $this->entityManager
            ? $this->entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $scryfallId])
            : null;
        if (!$cardEntity instanceof Card) {
            $this->cache[$scryfallId] = $this->baseStatsFromFaces($card);

            return $this->cache[$scryfallId];
        }

        $stats = [
            'power' => $this->numericStat($cardEntity->power()),
            'toughness' => $this->numericStat($cardEntity->toughness()),
        ];
        if ($stats['power'] === null && $stats['toughness'] === null) {
            $stats = $this->baseStatsFromFaces(['cardFaces' => $cardEntity->cardFaces()]) ?? $stats;
        }

        $this->cache[$scryfallId] = $stats;

        return $this->cache[$scryfallId];
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array{power:?int,toughness:?int}|null
     */
    private function baseStatsFromFaces(array $card): ?array
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
            if ($power !== null || $toughness !== null) {
                return ['power' => $power, 'toughness' => $toughness];
            }
        }

        return null;
    }

    private function numericStat(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }
}
