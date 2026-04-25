<?php

namespace App\Application\Card;

use App\Domain\Card\Card;
use Doctrine\ORM\EntityManagerInterface;

class CardResolver
{
    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    /**
     * @return list<Card>
     */
    public function resolveCandidates(array $criteria): array
    {
        $scryfallId = trim((string) ($criteria['scryfallId'] ?? ''));
        if ($scryfallId !== '') {
            $card = $this->entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $scryfallId]);

            return $card instanceof Card ? [$card] : [];
        }

        $setCode = mb_strtolower(trim((string) ($criteria['setCode'] ?? '')));
        $collectorNumber = trim((string) ($criteria['collectorNumber'] ?? ''));
        if ($setCode !== '' && $collectorNumber !== '') {
            $matches = $this->entityManager->getRepository(Card::class)->findBy([
                'setCode' => $setCode,
                'collectorNumber' => $collectorNumber,
            ]);

            return array_values(array_filter($matches, static fn (mixed $card) => $card instanceof Card));
        }

        $name = trim((string) ($criteria['name'] ?? ''));
        if ($name !== '') {
            $matches = $this->entityManager->getRepository(Card::class)->findBy([
                'normalizedName' => Card::normalizeName($name),
            ]);

            return array_values(array_filter($matches, static fn (mixed $card) => $card instanceof Card));
        }

        $flavorName = trim((string) ($criteria['flavorName'] ?? ''));
        if ($flavorName !== '' && $setCode !== '' && $collectorNumber !== '') {
            $matches = $this->entityManager->getRepository(Card::class)->findBy([
                'setCode' => $setCode,
                'collectorNumber' => $collectorNumber,
            ]);

            return array_values(array_filter($matches, static fn (mixed $card) => $card instanceof Card));
        }

        return [];
    }

    public function resolveOne(array $criteria): ?Card
    {
        return $this->resolveCandidates($criteria)[0] ?? null;
    }

    public function resolveForDecklistEntry(array $entry): ?Card
    {
        if (($entry['setCode'] ?? null) !== null && ($entry['collectorNumber'] ?? null) !== null) {
            $card = $this->resolveOne([
                'setCode' => $entry['setCode'],
                'collectorNumber' => $entry['collectorNumber'],
                'flavorName' => $entry['name'] ?? null,
            ]);
            if ($card instanceof Card) {
                return $card;
            }
        }

        return $this->entityManager->getRepository(Card::class)->findOneBy([
            'normalizedName' => Card::normalizeName((string) ($entry['name'] ?? '')),
        ]);
    }
}
