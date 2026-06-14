<?php

namespace App\Application\Game;

use App\Application\Card\CardLocalizationService;
use App\Domain\Game\Game;
use App\Domain\Localization\LanguageCatalog;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;

class GameProjectionService
{
    private const HIDDEN_ZONES = ['library', 'hand'];

    public function __construct(
        private readonly GameCommandHandler $normalizer,
        private readonly ?CardLocalizationService $cardLocalization = null,
        private readonly ?GameCardRulingsLookup $cardRulingsLookup = null,
    )
    {
    }

    public function project(Game $game, User $viewer): array
    {
        $snapshot = $this->normalizer->normalizeSnapshot($game->snapshot());

        return $this->projectSnapshot($this->withCurrentPlayerUsers($game, $snapshot), $viewer, $game->room()->hasPlayer($viewer));
    }

    public function projectSnapshot(
        array $snapshot,
        User $viewer,
        bool $viewerCanUseOwnHiddenZones = true,
        ?array $localizedCardsByLanguage = null,
        ?array $rulingsLookup = null,
    ): array
    {
        $viewerId = $viewer->id();
        $requestedLanguage = $viewer->cardLanguage();

        if (!isset($snapshot['players']) || !is_array($snapshot['players'])) {
            return $snapshot;
        }

        $visibleScryfallIds = $this->visibleSnapshotScryfallIds($snapshot, $viewerId, $viewerCanUseOwnHiddenZones);

        if ($rulingsLookup === null && $this->cardRulingsLookup instanceof GameCardRulingsLookup) {
            $rulingsLookup = $this->cardRulingsLookup->hasRulingsByScryfallIds($visibleScryfallIds);
        }

        if ($localizedCardsByLanguage === null && $this->cardLocalization instanceof CardLocalizationService) {
            $localizedCardsByLanguage = $this->cardLocalization->localizedImagePayloadLookupForScryfallIds(
                $visibleScryfallIds,
                $this->requestedLanguages($requestedLanguage),
            );
        }

        $snapshot['chat'] = array_values(array_filter(
            is_array($snapshot['chat'] ?? null) ? $snapshot['chat'] : [],
            fn (mixed $message): bool => is_array($message) && $this->canViewChatMessage($message, $viewerId),
        ));

        foreach ($snapshot['players'] as $playerId => &$player) {
            $zoneCounts = [];
            if (!isset($player['zones']) || !is_array($player['zones'])) {
                $player['zones'] = [];
            }

            foreach ($player['zones'] as $zone => &$cards) {
                $zoneCounts[$zone] = count($cards);
                $isOwnHiddenZone = $viewerCanUseOwnHiddenZones && $playerId === $viewerId;
                if ((string) $zone === 'hand' && !$isOwnHiddenZone) {
                    $cards = $this->projectOpponentHand($cards, $viewerId, (string) $playerId, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup);
                } elseif ((string) $zone === 'library' && !$isOwnHiddenZone) {
                    $cards = $this->projectOpponentLibrary(
                        $cards,
                        $viewerId,
                        (string) $playerId,
                        ($player['playTopLibraryRevealed'] ?? false) === true,
                        $requestedLanguage,
                        $localizedCardsByLanguage,
                        $rulingsLookup,
                    );
                } elseif ($this->zoneIsHidden((string) $zone) && !$isOwnHiddenZone) {
                    $cards = array_values(array_filter(
                        $cards,
                        fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
                    ));
                } else {
                    $cards = array_values(array_map(
                        fn (array $card): array => $this->projectCard($card, $viewerId, $playerId === $viewerId, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup),
                        $cards,
                    ));
                }
            }
            unset($cards);
            $player['zoneCounts'] = $zoneCounts;
        }
        unset($player);

        $snapshot['specialEntities'] = $this->projectSpecialEntities(
            is_array($snapshot['specialEntities'] ?? null) ? $snapshot['specialEntities'] : [],
            $requestedLanguage,
            $localizedCardsByLanguage,
        );

        return $snapshot;
    }

    public function projectZone(array $cards, string $ownerId, string $zone, User $viewer, bool $playTopLibraryRevealed = false, ?array $localizedCardsByLanguage = null): array
    {
        $viewerId = $viewer->id();
        $requestedLanguage = $viewer->cardLanguage();
        $visibleScryfallIds = $this->visibleZoneScryfallIds($cards, $ownerId, $zone, $viewerId, $playTopLibraryRevealed);
        $rulingsLookup = $this->cardRulingsLookup instanceof GameCardRulingsLookup
            ? $this->cardRulingsLookup->hasRulingsByScryfallIds($visibleScryfallIds)
            : [];

        if ($localizedCardsByLanguage === null && $this->cardLocalization instanceof CardLocalizationService) {
            $localizedCardsByLanguage = $this->cardLocalization->localizedImagePayloadLookupForScryfallIds(
                $visibleScryfallIds,
                $this->requestedLanguages($requestedLanguage),
            );
        }

        if ($ownerId !== $viewerId && $this->zoneIsHidden($zone)) {
            if ($zone === 'hand') {
                return $this->projectOpponentHand($cards, $viewerId, $ownerId, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup);
            }
            if ($zone === 'library') {
                return $this->projectOpponentLibraryZone($cards, $viewerId, $ownerId, $playTopLibraryRevealed, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup);
            }

            $cards = array_values(array_filter($cards, fn (array $card): bool => $this->isVisibleCard($card, $viewerId)));
        }

        return array_values(array_map(
            fn (array $card): array => $this->projectCard($card, $viewerId, $ownerId === $viewerId, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup),
            $cards,
        ));
    }

    /**
     * @param list<User> $viewers
     * @param array<string,bool> $viewerCanUseOwnHiddenZonesByUserId
     *
     * @return array<string,bool>
     */
    public function rulingsLookupForViewers(array $snapshot, array $viewers, array $viewerCanUseOwnHiddenZonesByUserId): array
    {
        if (!$this->cardRulingsLookup instanceof GameCardRulingsLookup) {
            return [];
        }

        $scryfallIds = [];
        foreach ($viewers as $viewer) {
            if (!$viewer instanceof User) {
                continue;
            }

            foreach ($this->visibleSnapshotScryfallIds(
                $snapshot,
                $viewer->id(),
                $viewerCanUseOwnHiddenZonesByUserId[$viewer->id()] ?? true,
            ) as $scryfallId) {
                $scryfallIds[$scryfallId] = true;
            }
        }

        return $this->cardRulingsLookup->hasRulingsByScryfallIds(array_keys($scryfallIds));
    }

    private function zoneIsHidden(string $zone): bool
    {
        return in_array($zone, self::HIDDEN_ZONES, true);
    }

    private function canViewChatMessage(array $message, string $viewerId): bool
    {
        $targetPlayerId = $message['targetPlayerId'] ?? null;
        if (!is_string($targetPlayerId) || $targetPlayerId === '' || $targetPlayerId === 'all') {
            return true;
        }

        return $targetPlayerId === $viewerId || ($message['userId'] ?? null) === $viewerId;
    }

    private function isVisibleCard(array $card, string $viewerId): bool
    {
        $revealedTo = $card['revealedTo'] ?? [];
        if (!is_array($revealedTo)) {
            return false;
        }

        return in_array('all', $revealedTo, true) || in_array($viewerId, $revealedTo, true);
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function projectOpponentHand(
        array $cards,
        string $viewerId,
        string $ownerId,
        ?string $requestedLanguage = null,
        ?array $localizedCardsByLanguage = null,
        ?array $rulingsLookup = null,
    ): array
    {
        $cards = array_values($cards);
        $handSize = count($cards);
        if ($handSize === 0) {
            return [];
        }

        $visibleCards = array_values(array_filter(
            $cards,
            fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
        ));
        $projected = array_map(
            fn (int $index): array => $this->hiddenOpponentHandCard($ownerId, $index),
            range(0, $handSize - 1),
        );

        if ($visibleCards === []) {
            return $projected;
        }

        $startIndex = max(0, (int) floor(($handSize - count($visibleCards)) / 2));
        foreach ($visibleCards as $offset => $card) {
            $projected[$startIndex + $offset] = $this->projectCard($card, $viewerId, false, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup);
        }

        return array_values($projected);
    }

    /**
     * @return array<string,mixed>
     */
    private function hiddenOpponentHandCard(string $ownerId, int $index): array
    {
        return [
            'instanceId' => sprintf('%s-hidden-hand-%d', $ownerId, $index),
            'ownerId' => $ownerId,
            'controllerId' => $ownerId,
            'name' => 'Hidden card',
            'hidden' => true,
            'tapped' => false,
            'faceDown' => true,
            'zone' => 'hand',
        ];
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function projectOpponentLibrary(
        array $cards,
        string $viewerId,
        string $ownerId,
        bool $playTopRevealed = false,
        ?string $requestedLanguage = null,
        ?array $localizedCardsByLanguage = null,
        ?array $rulingsLookup = null,
    ): array
    {
        $cards = array_values($cards);
        if ($cards === []) {
            return [];
        }

        $topCard = $cards[0];
        if ($playTopRevealed || $this->isVisibleCard($topCard, $viewerId)) {
            $topCard['faceDown'] = false;
            if ($playTopRevealed && !$this->isVisibleCard($topCard, $viewerId)) {
                $topCard['revealedTo'] = ['all'];
            }

            return [$this->projectCard($topCard, $viewerId, false, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup)];
        }

        $topRevealedTo = $topCard['revealedTo'] ?? [];
        if (is_array($topRevealedTo) && $topRevealedTo !== []) {
            return [$this->hiddenOpponentLibraryTopCard($ownerId)];
        }

        return [];
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function projectOpponentLibraryZone(
        array $cards,
        string $viewerId,
        string $ownerId,
        bool $playTopRevealed = false,
        ?string $requestedLanguage = null,
        ?array $localizedCardsByLanguage = null,
        ?array $rulingsLookup = null,
    ): array
    {
        $visibleCards = array_values(array_filter(
            $cards,
            fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
        ));

        if (count($visibleCards) > 1) {
            return array_values(array_map(
                fn (array $card): array => $this->projectCard($this->faceUpLibraryCard($card), $viewerId, false, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup),
                $visibleCards,
            ));
        }

        return $this->projectOpponentLibrary($cards, $viewerId, $ownerId, $playTopRevealed, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup);
    }

    /**
     * @return array<string,mixed>
     */
    private function faceUpLibraryCard(array $card): array
    {
        $card['faceDown'] = false;

        return $card;
    }

    /**
     * @return array<string,mixed>
     */
    private function hiddenOpponentLibraryTopCard(string $ownerId): array
    {
        return [
            'instanceId' => sprintf('%s-hidden-library-top', $ownerId),
            'ownerId' => $ownerId,
            'controllerId' => $ownerId,
            'name' => 'Hidden card',
            'hidden' => true,
            'tapped' => false,
            'faceDown' => true,
            'zone' => 'library',
        ];
    }

    private function projectCard(
        array $card,
        string $viewerId,
        bool $ownerView,
        ?string $requestedLanguage = null,
        ?array $localizedCardsByLanguage = null,
        ?array $rulingsLookup = null,
    ): array
    {
        $zone = (string) ($card['zone'] ?? '');
        if ($zone !== 'battlefield') {
            $card['tapped'] = false;
            $card['rotation'] = 0;
        }

        if (($card['faceDown'] ?? false) === true && !$ownerView && !$this->isVisibleCard($card, $viewerId)) {
            return [
                'instanceId' => $card['instanceId'],
                'ownerId' => $card['ownerId'] ?? null,
                'controllerId' => $card['controllerId'] ?? null,
                'name' => 'Face-down card',
                'hidden' => true,
                'tapped' => $zone === 'battlefield' && (bool) ($card['tapped'] ?? false),
                'faceDown' => true,
                'position' => $card['position'] ?? ['x' => 0, 'y' => 0],
                'rotation' => $zone === 'battlefield' ? $card['rotation'] ?? 0 : 0,
                'counters' => $card['counters'] ?? [],
                'zone' => $card['zone'] ?? null,
            ];
        }

        if (is_array($rulingsLookup)) {
            $card = $this->applyRulingsLookupToCard($card, $rulingsLookup);
        }

        if (is_array($localizedCardsByLanguage)) {
            $card = $this->localizeCardImagesFromLookup($card, $requestedLanguage, $localizedCardsByLanguage);
        } elseif ($this->cardLocalization instanceof CardLocalizationService) {
            $card = $this->localizeCardImagesFromService($card, $requestedLanguage);
        }

        unset($card['basePower'], $card['baseToughness'], $card['baseLoyalty'], $card['lang'], $card['printedName']);

        return $card;
    }

    /**
     * @param array<string,array<string,array<string,mixed>>> $localizedCardsByLanguage
     *
     * @return array<string,mixed>
     */
    private function localizeCardImagesFromLookup(array $card, ?string $requestedLanguage, array $localizedCardsByLanguage): array
    {
        $requestedLanguage = LanguageCatalog::normalize($requestedLanguage);
        if ($requestedLanguage === null || !LanguageCatalog::isSupported($requestedLanguage)) {
            return $card;
        }

        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
        if ($scryfallId === '') {
            return $card;
        }

        $localized = $localizedCardsByLanguage[$requestedLanguage][$scryfallId] ?? null;
        if (!is_array($localized)) {
            return $card;
        }

        return $this->applyLocalizedImages($card, $localized);
    }

    /**
     * @return array<string,mixed>
     */
    private function localizeCardImagesFromService(array $card, ?string $requestedLanguage): array
    {
        if (!$this->cardLocalization instanceof CardLocalizationService) {
            return $card;
        }

        return $this->cardLocalization->localizeCardPayloadImagesOnly($card, $requestedLanguage);
    }

    /**
     * @param array<string,mixed> $card
     * @param array<string,mixed> $localized
     *
     * @return array<string,mixed>
     */
    private function applyLocalizedImages(array $card, array $localized): array
    {
        if (is_array($localized['imageUris'] ?? null) && $localized['imageUris'] !== []) {
            $card['imageUris'] = $localized['imageUris'];
        }

        if (is_array($card['cardFaces'] ?? null) && is_array($localized['cardFaces'] ?? null)) {
            $card['cardFaces'] = $this->mergeLocalizedFaceImages($card['cardFaces'], $localized['cardFaces']);
        }

        return $card;
    }

    /**
     * @param list<array<string,mixed>> $sourceFaces
     * @param list<array<string,mixed>> $localizedFaces
     *
     * @return list<array<string,mixed>>
     */
    private function mergeLocalizedFaceImages(array $sourceFaces, array $localizedFaces): array
    {
        return array_values(array_map(
            static function (array $face, int $index) use ($localizedFaces): array {
                $localizedFace = $localizedFaces[$index] ?? null;
                if (!is_array($localizedFace) || !is_array($localizedFace['imageUris'] ?? null) || $localizedFace['imageUris'] === []) {
                    return $face;
                }

                $face['imageUris'] = $localizedFace['imageUris'];

                return $face;
            },
            $sourceFaces,
            array_keys($sourceFaces),
        ));
    }

    private function withCurrentPlayerUsers(Game $game, array $snapshot): array
    {
        foreach ($game->room()->orderedPlayers() as $roomPlayer) {
            if (!$roomPlayer instanceof RoomPlayer) {
                continue;
            }

            $userId = $roomPlayer->user()->id();
            if (isset($snapshot['players'][$userId]) && is_array($snapshot['players'][$userId])) {
                $snapshot['players'][$userId]['user'] = $roomPlayer->user()->toArray();
                $snapshot['players'][$userId]['deckName'] = $roomPlayer->deck()?->name();
            }
        }

        return $snapshot;
    }

    private function applyRulingsLookupToCard(array $card, array $lookup): array
    {
        $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
        if ($scryfallId === '' || !isset($lookup[$scryfallId])) {
            return $card;
        }

        if ($lookup[$scryfallId]) {
            $card['hasRulings'] = true;
        } elseif (!array_key_exists('hasRulings', $card)) {
            $card['hasRulings'] = false;
        }

        return $card;
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<string>
     */
    private function visibleSnapshotScryfallIds(array $snapshot, string $viewerId, bool $viewerCanUseOwnHiddenZones): array
    {
        $scryfallIds = [];
        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return [];
        }

        foreach ($players as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            $playTopLibraryRevealed = ($player['playTopLibraryRevealed'] ?? false) === true;
            foreach ($player['zones'] as $zone => $cards) {
                if (!is_array($cards)) {
                    continue;
                }

                $isOwnHiddenZone = $viewerCanUseOwnHiddenZones && $playerId === $viewerId;
                foreach ($this->visibleCardsForSnapshotZone(
                    $cards,
                    (string) $zone,
                    $viewerId,
                    $playerId,
                    $isOwnHiddenZone,
                    $playTopLibraryRevealed,
                ) as $card) {
                    $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
                    if ($scryfallId !== '') {
                        $scryfallIds[$scryfallId] = true;
                    }
                }
            }
        }

        foreach ($this->specialEntityCards($snapshot) as $card) {
            $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
            if ($scryfallId !== '') {
                $scryfallIds[$scryfallId] = true;
            }
        }

        return array_keys($scryfallIds);
    }

    /**
     * @param list<array<string,mixed>> $specialEntities
     * @param array<string,array<string,array<string,mixed>>>|null $localizedCardsByLanguage
     *
     * @return list<array<string,mixed>>
     */
    private function projectSpecialEntities(array $specialEntities, ?string $requestedLanguage, ?array $localizedCardsByLanguage): array
    {
        return array_values(array_map(function (array $entity) use ($requestedLanguage, $localizedCardsByLanguage): array {
            if (!is_array($entity['card'] ?? null)) {
                return $entity;
            }

            $entity['card'] = is_array($localizedCardsByLanguage)
                ? $this->localizeCardImagesFromLookup($entity['card'], $requestedLanguage, $localizedCardsByLanguage)
                : $this->localizeCardImagesFromService($entity['card'], $requestedLanguage);

            unset($entity['card']['lang'], $entity['card']['printedName']);

            return $entity;
        }, $specialEntities));
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function specialEntityCards(array $snapshot): array
    {
        $cards = [];
        foreach (($snapshot['specialEntities'] ?? []) as $entity) {
            if (is_array($entity) && is_array($entity['card'] ?? null)) {
                $cards[] = $entity['card'];
            }
        }

        return $cards;
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<string>
     */
    private function visibleZoneScryfallIds(array $cards, string $ownerId, string $zone, string $viewerId, bool $playTopLibraryRevealed): array
    {
        return $this->cardsScryfallIds(
            $this->visibleCardsForZoneProjection($cards, $ownerId, $zone, $viewerId, $playTopLibraryRevealed),
        );
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function visibleCardsForSnapshotZone(
        array $cards,
        string $zone,
        string $viewerId,
        string $ownerId,
        bool $isOwnHiddenZone,
        bool $playTopLibraryRevealed,
    ): array
    {
        if ($zone === 'hand' && !$isOwnHiddenZone) {
            return $this->visibleCards($cards, $viewerId);
        }

        if ($zone === 'library' && !$isOwnHiddenZone) {
            $normalizedCards = $this->cardArrays($cards);
            if ($normalizedCards === []) {
                return [];
            }

            $topCard = $normalizedCards[0];
            if ($playTopLibraryRevealed || $this->isVisibleCard($topCard, $viewerId)) {
                return [$topCard];
            }

            return [];
        }

        if ($this->zoneIsHidden($zone) && !$isOwnHiddenZone) {
            return $this->visibleCards($cards, $viewerId);
        }

        return $this->cardsVisibleAfterProjection($cards, $viewerId, $ownerId === $viewerId);
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function visibleCardsForZoneProjection(
        array $cards,
        string $ownerId,
        string $zone,
        string $viewerId,
        bool $playTopLibraryRevealed,
    ): array
    {
        if ($ownerId !== $viewerId && $this->zoneIsHidden($zone)) {
            if ($zone === 'hand') {
                return $this->visibleCards($cards, $viewerId);
            }

            if ($zone === 'library') {
                $visibleCards = $this->visibleCards($cards, $viewerId);
                if (count($visibleCards) > 1) {
                    return $visibleCards;
                }

                $normalizedCards = $this->cardArrays($cards);
                if ($normalizedCards === []) {
                    return [];
                }

                $topCard = $normalizedCards[0];
                if ($playTopLibraryRevealed || $this->isVisibleCard($topCard, $viewerId)) {
                    return [$topCard];
                }

                return [];
            }

            return $this->visibleCards($cards, $viewerId);
        }

        return $this->cardsVisibleAfterProjection($cards, $viewerId, $ownerId === $viewerId);
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function visibleCards(array $cards, string $viewerId): array
    {
        return array_values(array_filter(
            $this->cardArrays($cards),
            fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
        ));
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function cardsVisibleAfterProjection(array $cards, string $viewerId, bool $ownerView): array
    {
        return array_values(array_filter(
            $this->cardArrays($cards),
            fn (array $card): bool => $this->cardRetainsIdentityForViewer($card, $viewerId, $ownerView),
        ));
    }

    private function cardRetainsIdentityForViewer(array $card, string $viewerId, bool $ownerView): bool
    {
        return !(($card['faceDown'] ?? false) === true && !$ownerView && !$this->isVisibleCard($card, $viewerId));
    }

    /**
     * @param array<int,mixed> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function cardArrays(array $cards): array
    {
        return array_values(array_filter($cards, static fn (mixed $card): bool => is_array($card)));
    }

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<string>
     */
    private function cardsScryfallIds(array $cards): array
    {
        $scryfallIds = [];
        foreach ($cards as $card) {
            if (!is_array($card)) {
                continue;
            }

            $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
            if ($scryfallId !== '') {
                $scryfallIds[$scryfallId] = true;
            }
        }

        return array_keys($scryfallIds);
    }

    /**
     * @return list<string>
     */
    private function requestedLanguages(?string $requestedLanguage): array
    {
        return is_string($requestedLanguage) && trim($requestedLanguage) !== '' ? [$requestedLanguage] : [];
    }
}
