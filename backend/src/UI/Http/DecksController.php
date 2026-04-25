<?php

namespace App\UI\Http;

use App\Application\Deck\CommanderDeckValidator;
use App\Application\Deck\DecklistParser;
use App\Application\Card\CardResolver;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\Deck\DeckFolder;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class DecksController extends ApiController
{
    #[Route('/decks', methods: ['GET'])]
    public function list(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $criteria = ['owner' => $user];
        if ($request->query->has('folderId')) {
            $folderId = (string) $request->query->get('folderId');
            if ($folderId === 'null' || $folderId === '') {
                $criteria['folder'] = null;
            } else {
                $folder = $this->ownedFolder($folderId, $user, $entityManager);
                if (!$folder) {
                    return $this->fail('Folder not found.', 404);
                }
                $criteria['folder'] = $folder;
            }
        }

        $decks = $entityManager->getRepository(Deck::class)->findBy($criteria, ['id' => 'DESC']);

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
        $folder = $this->folderFromPayload($payload, $user, $entityManager);
        if ($folder === false) {
            return $this->fail('Folder not found.', 404);
        }
        $deck->moveToFolder($folder);
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
        if (array_key_exists('folderId', $payload)) {
            $folder = $this->folderFromPayload($payload, $user, $entityManager);
            if ($folder === false) {
                return $this->fail('Folder not found.', 404);
            }
            $deck->moveToFolder($folder);
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
    public function import(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, DecklistParser $parser, CardResolver $cardResolver): JsonResponse
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
            $card = $cardResolver->resolveForDecklistEntry($entry);
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

    #[Route('/decks/{id}/cards', methods: ['POST'])]
    public function addCard(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $payload = $this->payload($request);
        $section = (string) ($payload['section'] ?? DeckCard::SECTION_MAIN);
        if (!$this->isValidSection($section)) {
            return $this->fail('section must be main or commander.');
        }

        $card = $entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => (string) ($payload['scryfallId'] ?? '')]);
        if (!$card instanceof Card) {
            return $this->fail('Card not found.', 404);
        }

        $deck->addOrIncrementCard($card, (int) ($payload['quantity'] ?? 1), $section);
        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)], 201);
    }

    #[Route('/decks/{id}/cards/{deckCardId}', methods: ['PATCH'])]
    public function updateCard(string $id, string $deckCardId, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $deckCard = $this->deckCard($deck, $deckCardId);
        if (!$deckCard) {
            return $this->fail('Deck card not found.', 404);
        }

        $payload = $this->payload($request);
        if (isset($payload['quantity'])) {
            $deckCard->changeQuantity((int) $payload['quantity']);
        }
        if (isset($payload['section'])) {
            $section = (string) $payload['section'];
            if (!$this->isValidSection($section)) {
                return $this->fail('section must be main or commander.');
            }
            $deckCard->moveToSection($section);
        }
        $deck->touch();
        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)]);
    }

    #[Route('/decks/{id}/cards/{deckCardId}', methods: ['DELETE'])]
    public function deleteCard(string $id, string $deckCardId, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $deckCard = $this->deckCard($deck, $deckCardId);
        if (!$deckCard) {
            return $this->fail('Deck card not found.', 404);
        }

        $deck->removeCard($deckCard);
        $entityManager->remove($deckCard);
        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)]);
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

    private function ownedFolder(string $id, User $user, EntityManagerInterface $entityManager): ?DeckFolder
    {
        $folder = $entityManager->getRepository(DeckFolder::class)->find($id);

        return $folder instanceof DeckFolder && $folder->owner()->id() === $user->id() ? $folder : null;
    }

    /**
     * @return DeckFolder|false|null
     */
    private function folderFromPayload(array $payload, User $user, EntityManagerInterface $entityManager): DeckFolder|false|null
    {
        if (!array_key_exists('folderId', $payload) || $payload['folderId'] === null || $payload['folderId'] === '') {
            return null;
        }

        return $this->ownedFolder((string) $payload['folderId'], $user, $entityManager) ?? false;
    }

    private function deckCard(Deck $deck, string $deckCardId): ?DeckCard
    {
        foreach ($deck->cards() as $deckCard) {
            if ($deckCard instanceof DeckCard && $deckCard->id() === $deckCardId) {
                return $deckCard;
            }
        }

        return null;
    }

    private function isValidSection(string $section): bool
    {
        return in_array($section, [DeckCard::SECTION_MAIN, DeckCard::SECTION_COMMANDER], true);
    }
}
