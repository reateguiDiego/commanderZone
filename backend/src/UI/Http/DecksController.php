<?php

namespace App\UI\Http;

use App\Application\Deck\CommanderDeckValidator;
use App\Application\Deck\DeckAnalysisService;
use App\Application\Deck\DecklistExporter;
use App\Application\Deck\DecklistParser;
use App\Application\Deck\DecklistPreviewer;
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
    private const MAX_DECK_NAME_LENGTH = 20;

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
        $nameError = $this->deckNameError($name);
        if ($nameError !== null) {
            return $this->fail($nameError);
        }

        $deck = new Deck($user, $name);
        $deck->setVisibility($this->visibilityFromPayload($payload));
        $folder = $this->folderFromPayload($payload, $user, $entityManager);
        if ($folder === false) {
            return $this->fail('Folder not found.', 404);
        }
        $deck->moveToFolder($folder);
        $entityManager->persist($deck);
        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)], 201);
    }

    #[Route('/decks/quick-build', methods: ['POST'])]
    public function quickBuild(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, CardResolver $cardResolver): JsonResponse
    {
        $payload = $this->payload($request);
        $name = trim((string) ($payload['name'] ?? ''));
        $nameError = $this->deckNameError($name);
        if ($nameError !== null) {
            return $this->fail($nameError);
        }

        $deck = new Deck($user, $name);
        $deck->setVisibility($this->visibilityFromPayload($payload));
        $folder = $this->folderFromPayload($payload, $user, $entityManager);
        if ($folder === false) {
            return $this->fail('Folder not found.', 404);
        }
        $deck->moveToFolder($folder);
        $entityManager->persist($deck);

        $missingCards = [];
        $cards = $payload['cards'] ?? [];
        if (is_array($cards)) {
            foreach ($cards as $index => $cardPayload) {
                if (!is_array($cardPayload)) {
                    continue;
                }
                $resolved = $cardResolver->resolveUnique($cardPayload);
                $card = $resolved['card'];
                if (!$card instanceof Card) {
                    $missingCards[] = $this->missingCardPayload($cardPayload, $index + 1, (string) $resolved['error'], $resolved['matches']);
                    continue;
                }

                $section = (string) ($cardPayload['section'] ?? DeckCard::SECTION_MAIN);
                if (!$this->isValidSection($section)) {
                    $section = DeckCard::SECTION_MAIN;
                }

                $deck->addOrIncrementCard($card, (int) ($cardPayload['quantity'] ?? 1), $section);
            }
        }

        $entityManager->flush();

        return $this->json([
            'deck' => $deck->toArray(true),
            'missing' => $this->missingNames($missingCards),
            'missingCards' => $missingCards,
        ], 201);
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

    #[Route('/decks/{id}/analysis', methods: ['GET'])]
    public function analysis(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, DeckAnalysisService $analysis): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        return $this->json($analysis->analyze($deck, [
            'includeCommanderInAnalysis' => $request->query->get('includeCommanderInAnalysis'),
            'includeSideboard' => $request->query->get('includeSideboard'),
            'includeMaybeboard' => $request->query->get('includeMaybeboard'),
            'curvePlayabilityMode' => $request->query->get('curvePlayabilityMode'),
            'manaSourcesMode' => $request->query->get('manaSourcesMode'),
        ]));
    }

    #[Route('/decks/{id}/sections', methods: ['GET'])]
    public function sections(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $sections = [
            DeckCard::SECTION_COMMANDER => [],
            DeckCard::SECTION_MAIN => [],
            DeckCard::SECTION_SIDEBOARD => [],
            DeckCard::SECTION_MAYBEBOARD => [],
            'tokens' => [],
        ];
        $counts = [
            DeckCard::SECTION_COMMANDER => 0,
            DeckCard::SECTION_MAIN => 0,
            DeckCard::SECTION_SIDEBOARD => 0,
            DeckCard::SECTION_MAYBEBOARD => 0,
            'tokens' => 0,
            'playableTotal' => 0,
        ];

        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            $sections[$deckCard->section()][] = $deckCard->toArray();
            $counts[$deckCard->section()] += $deckCard->quantity();
            if ($deckCard->isPlayable()) {
                $counts['playableTotal'] += $deckCard->quantity();
            }
        }

        $tokenPayload = $this->derivedTokens($deck, $entityManager);
        $sections['tokens'] = $tokenPayload['data'];
        $counts['tokens'] = count($tokenPayload['data']);

        return $this->json([
            'deckId' => $deck->id(),
            'sections' => $sections,
            'counts' => $counts,
        ]);
    }

    #[Route('/decks/{id}/tokens', methods: ['GET'])]
    public function tokens(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        return $this->json([
            'deckId' => $deck->id(),
            ...$this->derivedTokens($deck, $entityManager),
        ]);
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
            $name = trim((string) $payload['name']);
            $nameError = $this->deckNameError($name);
            if ($nameError !== null) {
                return $this->fail($nameError);
            }
            $deck->rename($name);
        }
        if (array_key_exists('folderId', $payload)) {
            $folder = $this->folderFromPayload($payload, $user, $entityManager);
            if ($folder === false) {
                return $this->fail('Folder not found.', 404);
            }
            $deck->moveToFolder($folder);
        }
        if (isset($payload['visibility'])) {
            $deck->setVisibility((string) $payload['visibility']);
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
    public function import(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, DecklistParser $parser, DecklistPreviewer $previewer, CardResolver $cardResolver): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $payload = $this->payload($request);
        $decklist = (string) ($payload['decklist'] ?? '');
        $format = $parser->resolveFormat($payload['format'] ?? null, $decklist);
        if ($format === null) {
            return $this->fail('Decklist format is invalid.');
        }

        $entries = $parser->parse($decklist, $format);
        if ($entries === []) {
            return $this->fail('Decklist is empty or invalid.');
        }

        $preview = $previewer->preview($entries, $format);
        $selectedCommander = $this->commanderFromPayload($payload, $cardResolver);
        if ($selectedCommander === false) {
            return $this->fail('Commander card not found.', 404);
        }

        $deck->clearCards();
        $selectedCommanderImported = false;

        foreach ($preview['entries'] as $entry) {
            $card = $entry['card'];
            if (!$card instanceof Card) {
                continue;
            }

            $quantity = (int) $entry['quantity'];
            if ($selectedCommander instanceof Card && $this->isSameCommanderCard($card, $selectedCommander)) {
                if (!$selectedCommanderImported) {
                    $deck->addOrIncrementCard($selectedCommander, 1, DeckCard::SECTION_COMMANDER);
                    $selectedCommanderImported = true;
                }

                $remainingQuantity = max(0, $quantity - 1);
                if ($remainingQuantity > 0) {
                    $deck->addOrIncrementCard($card, $remainingQuantity, (string) $entry['section']);
                }
                continue;
            }

            $deck->addOrIncrementCard($card, $quantity, (string) $entry['section']);
        }

        if ($selectedCommander instanceof Card && !$selectedCommanderImported) {
            $deck->addOrIncrementCard($selectedCommander, 1, DeckCard::SECTION_COMMANDER);
        }

        $entityManager->flush();
        $missingQuantity = array_reduce(
            $preview['missingCards'],
            static fn (int $total, array $missingCard): int => $total + max(1, (int) ($missingCard['quantity'] ?? 1)),
            0,
        );
        $summary = $this->importSummary($deck, $format, count($entries), $missingQuantity);

        return $this->json([
            'format' => $format,
            'deck' => $deck->toArray(true),
            'missing' => $this->missingNames($preview['missingCards']),
            'summary' => $summary,
            'missingCards' => $preview['missingCards'],
        ]);
    }

    #[Route('/decks/{id}/export', methods: ['GET'])]
    public function export(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, DecklistParser $parser, DecklistExporter $exporter): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $format = $parser->normalizeFormat($request->query->get('format'));
        if ($format === null) {
            return $this->fail('Decklist format is invalid.');
        }

        return $this->json($exporter->export($deck, $format));
    }

    #[Route('/decks/{id}/cards', methods: ['POST'])]
    public function addCard(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, CardResolver $cardResolver): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $payload = $this->payload($request);
        $section = (string) ($payload['section'] ?? DeckCard::SECTION_MAIN);
        if (!$this->isValidSection($section)) {
            return $this->fail('section must be commander, main, sideboard, or maybeboard.');
        }

        $resolved = $cardResolver->resolveUnique($payload);
        $card = $resolved['card'];
        if (!$card instanceof Card) {
            if ($resolved['error'] === 'ambiguous') {
                return $this->fail('Card resolution is ambiguous.', 409, [
                    'matches' => array_map(static fn (Card $card): array => $card->toArray(), $resolved['matches']),
                ]);
            }

            return $this->fail('Card not found.', 404);
        }

        $deck->addOrIncrementCard($card, (int) ($payload['quantity'] ?? 1), $section);
        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)], 201);
    }

    #[Route('/decks/{id}/cards', methods: ['PATCH'])]
    public function updateCards(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $cards = $this->payload($request)['cards'] ?? null;
        if (!is_array($cards)) {
            return $this->fail('cards must be an array.');
        }

        foreach ($cards as $payload) {
            if (!is_array($payload)) {
                continue;
            }

            $deckCard = $this->deckCard($deck, (string) ($payload['deckCardId'] ?? ''));
            if (!$deckCard) {
                return $this->fail('Deck card not found.', 404);
            }

            if (array_key_exists('quantity', $payload) && (int) $payload['quantity'] <= 0) {
                $deck->removeCard($deckCard);
                $entityManager->remove($deckCard);
                continue;
            }

            if (isset($payload['quantity'])) {
                $deckCard->changeQuantity((int) $payload['quantity']);
            }

            if (isset($payload['section'])) {
                $section = (string) $payload['section'];
                if (!$this->isValidSection($section)) {
                    return $this->fail('section must be commander, main, sideboard, or maybeboard.');
                }

                $merged = $deck->moveOrMergeCard($deckCard, $section);
                if ($merged !== $deckCard) {
                    $entityManager->remove($deckCard);
                }
            }
        }

        $deck->touch();
        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)]);
    }

    #[Route('/decks/{id}/commanders', methods: ['PUT'])]
    public function replaceCommanders(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, CardResolver $cardResolver): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $cards = $this->payload($request)['cards'] ?? null;
        if (!is_array($cards)) {
            return $this->fail('cards must be an array.');
        }
        if (count($cards) > 2) {
            return $this->fail('Commander decks can use at most two commanders.');
        }

        $desiredCards = [];
        foreach ($cards as $payload) {
            if (!is_array($payload)) {
                continue;
            }

            $source = $this->deckCard($deck, (string) ($payload['deckCardId'] ?? ''));
            if ($source instanceof DeckCard) {
                $card = $source->card();
            } else {
                $resolved = $cardResolver->resolveUnique($payload);
                $card = $resolved['card'];
                if (!$card instanceof Card) {
                    if ($resolved['error'] === 'ambiguous') {
                        return $this->fail('Card resolution is ambiguous.', 409, [
                            'matches' => array_map(static fn (Card $card): array => $card->toArray(), $resolved['matches']),
                        ]);
                    }

                    return $this->fail('Card not found.', 404);
                }
            }

            $desiredCards[$card->scryfallId()] = $card;
        }

        if (count($desiredCards) > 2) {
            return $this->fail('Commander decks can use at most two commanders.');
        }

        foreach ($this->deckCardsBySection($deck, DeckCard::SECTION_COMMANDER) as $commander) {
            if (isset($desiredCards[$commander->card()->scryfallId()])) {
                $commander->changeQuantity(1);
                continue;
            }

            $deck->addOrIncrementCard($commander->card(), $commander->quantity(), DeckCard::SECTION_MAIN);
            $deck->removeCard($commander);
            $entityManager->remove($commander);
        }

        foreach ($desiredCards as $card) {
            if ($deck->findCardEntry($card, DeckCard::SECTION_COMMANDER) instanceof DeckCard) {
                continue;
            }

            $mainEntry = $deck->findCardEntry($card, DeckCard::SECTION_MAIN);
            if ($mainEntry instanceof DeckCard) {
                if ($mainEntry->quantity() > 1) {
                    $mainEntry->changeQuantity($mainEntry->quantity() - 1);
                    $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_COMMANDER);
                } else {
                    $mainEntry->moveToSection(DeckCard::SECTION_COMMANDER);
                }
                continue;
            }

            $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_COMMANDER);
        }

        $deck->touch();
        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)]);
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
                return $this->fail('section must be commander, main, sideboard, or maybeboard.');
            }
            $merged = $deck->moveOrMergeCard($deckCard, $section);
            if ($merged !== $deckCard) {
                $entityManager->remove($deckCard);
            }
        }
        $deck->touch();
        $entityManager->flush();

        return $this->json(['deck' => $deck->toArray(true)]);
    }

    #[Route('/decks/{id}/cards/{deckCardId}/printings', methods: ['GET'])]
    public function cardPrintings(string $id, string $deckCardId, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $deck = $this->ownedDeck($id, $user, $entityManager);
        if (!$deck) {
            return $this->fail('Deck not found.', 404);
        }

        $deckCard = $this->deckCard($deck, $deckCardId);
        if (!$deckCard) {
            return $this->fail('Deck card not found.', 404);
        }

        return $this->json([
            'deckCardId' => $deckCard->id(),
            'data' => array_map(static fn (Card $card): array => $card->toArray(), $this->printVersionCards($deckCard->card(), $entityManager)),
        ]);
    }

    #[Route('/decks/{id}/cards/{deckCardId}/printing', methods: ['PATCH'])]
    public function selectCardPrinting(string $id, string $deckCardId, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
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
        $scryfallId = trim((string) ($payload['scryfallId'] ?? ''));
        if ($scryfallId === '') {
            return $this->fail('scryfallId is required.');
        }

        $targetCard = $entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $scryfallId]);
        if (!$targetCard instanceof Card) {
            return $this->fail('Print version not found.', 404);
        }
        if (!$this->isEquivalentPrintVersion($deckCard->card(), $targetCard)) {
            return $this->fail('Selected print version does not match this card.', 422);
        }

        $existing = $deck->findCardEntry($targetCard, $deckCard->section());
        if ($existing instanceof DeckCard && $existing->id() !== $deckCard->id()) {
            $existing->changeQuantity($existing->quantity() + $deckCard->quantity());
            $deck->removeCard($deckCard);
            $entityManager->remove($deckCard);
        } else {
            $deckCard->changeCard($targetCard);
            $deck->touch();
        }

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
        return in_array($section, DeckCard::SECTIONS, true);
    }

    private function visibilityFromPayload(array $payload): string
    {
        return in_array(($payload['visibility'] ?? null), [Deck::VISIBILITY_PRIVATE, Deck::VISIBILITY_PUBLIC], true)
            ? (string) $payload['visibility']
            : Deck::VISIBILITY_PRIVATE;
    }

    private function deckNameError(string $name): ?string
    {
        if ($name === '') {
            return 'Deck name is required.';
        }
        if (mb_strlen($name) > self::MAX_DECK_NAME_LENGTH) {
            return sprintf('Deck name must be %d characters or fewer.', self::MAX_DECK_NAME_LENGTH);
        }

        return null;
    }

    /**
     * @return Card|false|null
     */
    private function commanderFromPayload(array $payload, CardResolver $cardResolver): Card|false|null
    {
        $commanderPayload = $payload['commander'] ?? null;
        if ($commanderPayload === null) {
            $scryfallId = trim((string) ($payload['commanderScryfallId'] ?? ''));
            $commanderPayload = $scryfallId !== '' ? ['scryfallId' => $scryfallId] : null;
        }
        if (!is_array($commanderPayload)) {
            return null;
        }

        $resolved = $cardResolver->resolveUnique($commanderPayload);

        return $resolved['card'] instanceof Card ? $resolved['card'] : false;
    }

    /**
     * @return array<string,int|string>
     */
    private function importSummary(Deck $deck, string $format, int $parsedCards, int $missingCards): array
    {
        $counts = [
            DeckCard::SECTION_COMMANDER => 0,
            DeckCard::SECTION_MAIN => 0,
            DeckCard::SECTION_SIDEBOARD => 0,
            DeckCard::SECTION_MAYBEBOARD => 0,
        ];
        $importedCards = 0;

        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            $quantity = $deckCard->quantity();
            $counts[$deckCard->section()] = ($counts[$deckCard->section()] ?? 0) + $quantity;
            $importedCards += $quantity;
        }

        return [
            'format' => $format,
            'parsedCards' => $parsedCards,
            'totalCards' => $importedCards + $missingCards,
            'resolvedCards' => $importedCards,
            'importedCards' => $importedCards,
            'missingCards' => $missingCards,
            'commanderCount' => $counts[DeckCard::SECTION_COMMANDER],
            'mainCount' => $counts[DeckCard::SECTION_MAIN],
            'sideboardCount' => $counts[DeckCard::SECTION_SIDEBOARD],
            'maybeboardCount' => $counts[DeckCard::SECTION_MAYBEBOARD],
            'playableTotal' => $counts[DeckCard::SECTION_COMMANDER] + $counts[DeckCard::SECTION_MAIN],
        ];
    }

    private function isSameCommanderCard(Card $importedCard, Card $selectedCommander): bool
    {
        return $importedCard->scryfallId() === $selectedCommander->scryfallId()
            || count(array_intersect($this->cardNameIdentities($importedCard), $this->cardNameIdentities($selectedCommander))) > 0;
    }

    /**
     * @return list<Card>
     */
    private function printVersionCards(Card $card, EntityManagerInterface $entityManager): array
    {
        $candidates = $entityManager->getRepository(Card::class)
            ->createQueryBuilder('card')
            ->andWhere('card.normalizedName IN (:names)')
            ->setParameter('names', [$card->normalizedName()])
            ->orderBy('card.setCode', 'ASC')
            ->addOrderBy('card.collectorNumber', 'ASC')
            ->getQuery()
            ->getResult();

        $cards = array_values(array_filter(
            $candidates,
            fn (Card $candidate): bool => $this->isEquivalentPrintVersion($card, $candidate),
        ));

        usort($cards, static function (Card $left, Card $right) use ($card): int {
            if ($left->scryfallId() === $card->scryfallId()) {
                return -1;
            }
            if ($right->scryfallId() === $card->scryfallId()) {
                return 1;
            }

            return [$left->name(), $left->setCode() ?? '', $left->collectorNumber() ?? '']
                <=> [$right->name(), $right->setCode() ?? '', $right->collectorNumber() ?? ''];
        });

        return $cards;
    }

    private function isEquivalentPrintVersion(Card $source, Card $candidate): bool
    {
        return $source->normalizedName() === $candidate->normalizedName();
    }

    /**
     * @return list<string>
     */
    private function cardNameIdentities(Card $card): array
    {
        $names = [Card::normalizeName($card->name())];
        foreach (explode('//', $card->name()) as $namePart) {
            $names[] = Card::normalizeName($namePart);
        }
        foreach ($card->cardFaces() as $face) {
            $faceName = $face['name'] ?? null;
            if (is_string($faceName)) {
                $names[] = Card::normalizeName($faceName);
            }
        }

        return array_values(array_filter(array_unique($names)));
    }

    /**
     * @return list<DeckCard>
     */
    private function deckCardsBySection(Deck $deck, string $section): array
    {
        $cards = [];
        foreach ($deck->cards() as $deckCard) {
            if ($deckCard instanceof DeckCard && $deckCard->section() === $section) {
                $cards[] = $deckCard;
            }
        }

        return $cards;
    }

    /**
     * @param array<int, array{name:string}> $missingCards
     * @return list<string>
     */
    private function missingNames(array $missingCards): array
    {
        return array_values(array_unique(array_map(static fn (array $card): string => $card['name'], $missingCards)));
    }

    /**
     * @param list<Card> $matches
     * @return array<string,mixed>
     */
    private function missingCardPayload(array $payload, int $line, string $reason, array $matches = []): array
    {
        return [
            'name' => (string) ($payload['name'] ?? $payload['scryfallId'] ?? 'Unknown card'),
            'quantity' => max(1, (int) ($payload['quantity'] ?? 1)),
            'section' => $this->isValidSection((string) ($payload['section'] ?? DeckCard::SECTION_MAIN)) ? (string) ($payload['section'] ?? DeckCard::SECTION_MAIN) : DeckCard::SECTION_MAIN,
            'setCode' => isset($payload['setCode']) ? (string) $payload['setCode'] : null,
            'collectorNumber' => isset($payload['collectorNumber']) ? (string) $payload['collectorNumber'] : null,
            'line' => $line,
            'rawLine' => '',
            'reason' => $reason,
            'matches' => array_map(static fn (Card $card): array => $card->toArray(), $matches),
        ];
    }

    /**
     * @return array{data:list<array<string,mixed>>,unresolved:list<array<string,mixed>>}
     */
    private function derivedTokens(Deck $deck, EntityManagerInterface $entityManager): array
    {
        $data = [];
        $unresolved = [];
        $seen = [];

        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            $source = $deckCard->card();
            foreach ($source->allParts() as $part) {
                if (!is_array($part) || ($part['component'] ?? null) !== 'token') {
                    continue;
                }

                $tokenScryfallId = (string) ($part['id'] ?? '');
                if ($tokenScryfallId === '') {
                    continue;
                }

                $key = $source->scryfallId().'|'.$tokenScryfallId;
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;

                $token = $entityManager->getRepository(Card::class)->findOneBy(['scryfallId' => $tokenScryfallId]);
                $sourcePayload = [
                    'scryfallId' => $source->scryfallId(),
                    'name' => $source->name(),
                    'section' => $deckCard->section(),
                ];

                if ($token instanceof Card) {
                    $data[] = [
                        'sourceCard' => $sourcePayload,
                        'token' => $token->toArray(),
                        'resolved' => true,
                    ];
                    continue;
                }

                $unresolved[] = [
                    'sourceCard' => $sourcePayload,
                    'token' => [
                        'scryfallId' => $tokenScryfallId,
                        'name' => (string) ($part['name'] ?? 'Unknown token'),
                        'uri' => $part['uri'] ?? null,
                    ],
                    'resolved' => false,
                ];
            }
        }

        return ['data' => $data, 'unresolved' => $unresolved];
    }
}
