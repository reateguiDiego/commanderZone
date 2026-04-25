<?php

namespace App\UI\Http;

use App\Application\Deck\CommanderDeckValidator;
use App\Application\Deck\DecklistParser;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class DecksController extends ApiController
{
    #[Route('/decks', methods: ['GET'])]
    public function list(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $decks = $entityManager->getRepository(Deck::class)->findBy(['owner' => $user], ['id' => 'DESC']);

        return $this->json(['data' => array_map(static fn (Deck $deck) => $deck->toArray(), $decks)]);
    }

    #[Route('/decks', methods: ['POST'])]
    public function create(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $payload = $this->payload($request);
        $name = trim((string) ($payload['name'] ?? ''));
        if ($name === '') {
            return $this->fail('Deck name is required.');
        }

        $deck = new Deck($user, $name);
        $entityManager->persist($deck);
        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)], 201);
    }

    #[Route('/decks/{id}', methods: ['GET'])]
    public function show(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        return $this->json(['deck' => $deck->toArray(true)]);
    }

    #[Route('/decks/{id}', methods: ['PATCH'])]
    public function update(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $payload = $this->payload($request);
        if (isset($payload['name'])) {
            $deck->rename((string) $payload['name']);
        }

        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)]);
    }

    #[Route('/decks/{id}', methods: ['DELETE'])]
    public function delete(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $entityManager->remove($deck);
        $entityManager->flush();

        return $this->json(null, 204);
    }

    #[Route('/decks/{id}/import', methods: ['POST'])]
    public function import(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, DecklistParser $parser): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $payload = $this->payload($request);
        $entries = $parser->parse((string) ($payload['decklist'] ?? ''));
        if ($entries === []) {
            return $this->fail('Decklist is empty or invalid.');
        }

        $deck->clearCards();
        $missing = [];

        foreach ($entries as $entry) {
            $card = $entityManager->getRepository(Card::class)->findOneBy(['normalizedName' => Card::normalizeName($entry['name'])]);
            if (!$card instanceof Card) {
                $missing[] = $entry['name'];
                continue;
            }

            $deck->addCard(new DeckCard($deck, $card, $entry['quantity'], $entry['section']));
        }

        $entityManager->flush();

        return $this->json([
            'deck' => $deck->toArray(true),
            'missing' => array_values(array_unique($missing)),
        ]);
    }

    #[Route('/decks/{id}/validate-commander', methods: ['POST'])]
    public function validateCommander(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager, CommanderDeckValidator $validator): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        return $this->json($validator->validate($deck));
    }

    private function ownedDeck(string $id, User $user, EntityManagerInterface $entityManager): ?Deck
    {
        $deck = $entityManager->getRepository(Deck::class)->find($id);

        return $deck instanceof Deck && $deck->owner()->id() === $user->id() ? $deck : null;
    }
}
