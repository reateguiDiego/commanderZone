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
    )
    {
    }

    public function project(Game $game, User $viewer): array
    {
        $snapshot = $this->normalizer->normalizeSnapshot($game->snapshot());

        return $this->projectSnapshot($this->withCurrentPlayerUsers($game, $snapshot), $viewer, $game->room()->hasPlayer($viewer));
    }

    public function projectSnapshot(array $snapshot, User $viewer, bool $viewerCanUseOwnHiddenZones = true, ?array $localizedCardsByLanguage = null): array
    {
        $viewerId = $viewer->id();
        $requestedLanguage = $viewer->cardLanguage();

        if (!isset($snapshot['players']) || !is_array($snapshot['players'])) {
            return $snapshot;
        }

        if ($localizedCardsByLanguage === null && $this->cardLocalization instanceof CardLocalizationService) {
            $localizedCardsByLanguage = $this->cardLocalization->localizedImagePayloadLookupForScryfallIds(
                $this->snapshotScryfallIds($snapshot),
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
                    $cards = $this->projectOpponentHand($cards, $viewerId, (string) $playerId, $requestedLanguage, $localizedCardsByLanguage);
                } elseif ((string) $zone === 'library' && !$isOwnHiddenZone) {
                    $cards = $this->projectOpponentLibrary(
                        $cards,
                        $viewerId,
                        (string) $playerId,
                        ($player['playTopLibraryRevealed'] ?? false) === true,
                        $requestedLanguage,
                        $localizedCardsByLanguage,
                    );
                } elseif ($this->zoneIsHidden((string) $zone) && !$isOwnHiddenZone) {
                    $cards = array_values(array_filter(
                        $cards,
                        fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
                    ));
                } else {
                    $cards = array_values(array_map(
                        fn (array $card): array => $this->projectCard($card, $viewerId, $playerId === $viewerId, $requestedLanguage, $localizedCardsByLanguage),
                        $cards,
                    ));
                }
            }
            unset($cards);
            $player['zoneCounts'] = $zoneCounts;
        }
        unset($player);

        return $snapshot;
    }

    public function projectZone(array $cards, string $ownerId, string $zone, User $viewer, bool $playTopLibraryRevealed = false, ?array $localizedCardsByLanguage = null): array
    {
        $viewerId = $viewer->id();
        $requestedLanguage = $viewer->cardLanguage();
        if ($localizedCardsByLanguage === null && $this->cardLocalization instanceof CardLocalizationService) {
            $localizedCardsByLanguage = $this->cardLocalization->localizedImagePayloadLookupForScryfallIds(
                $this->cardsScryfallIds($cards),
                $this->requestedLanguages($requestedLanguage),
            );
        }

        if ($ownerId !== $viewerId && $this->zoneIsHidden($zone)) {
            if ($zone === 'hand') {
                return $this->projectOpponentHand($cards, $viewerId, $ownerId, $requestedLanguage, $localizedCardsByLanguage);
            }
            if ($zone === 'library') {
                return $this->projectOpponentLibraryZone($cards, $viewerId, $ownerId, $playTopLibraryRevealed, $requestedLanguage, $localizedCardsByLanguage);
            }

            $cards = array_values(array_filter($cards, fn (array $card): bool => $this->isVisibleCard($card, $viewerId)));
        }

        return array_values(array_map(
            fn (array $card): array => $this->projectCard($card, $viewerId, $ownerId === $viewerId, $requestedLanguage, $localizedCardsByLanguage),
            $cards,
        ));
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
    private function projectOpponentHand(array $cards, string $viewerId, string $ownerId, ?string $requestedLanguage = null, ?array $localizedCardsByLanguage = null): array
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
            $projected[$startIndex + $offset] = $this->projectCard($card, $viewerId, false, $requestedLanguage, $localizedCardsByLanguage);
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
    private function projectOpponentLibrary(array $cards, string $viewerId, string $ownerId, bool $playTopRevealed = false, ?string $requestedLanguage = null, ?array $localizedCardsByLanguage = null): array
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

            return [$this->projectCard($topCard, $viewerId, false, $requestedLanguage, $localizedCardsByLanguage)];
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
    private function projectOpponentLibraryZone(array $cards, string $viewerId, string $ownerId, bool $playTopRevealed = false, ?string $requestedLanguage = null, ?array $localizedCardsByLanguage = null): array
    {
        $visibleCards = array_values(array_filter(
            $cards,
            fn (array $card): bool => $this->isVisibleCard($card, $viewerId),
        ));

        if (count($visibleCards) > 1) {
            return array_values(array_map(
                fn (array $card): array => $this->projectCard($this->faceUpLibraryCard($card), $viewerId, false, $requestedLanguage, $localizedCardsByLanguage),
                $visibleCards,
            ));
        }

        return $this->projectOpponentLibrary($cards, $viewerId, $ownerId, $playTopRevealed, $requestedLanguage, $localizedCardsByLanguage);
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

    private function projectCard(array $card, string $viewerId, bool $ownerView, ?string $requestedLanguage = null, ?array $localizedCardsByLanguage = null): array
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

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return list<string>
     */
    private function snapshotScryfallIds(array $snapshot): array
    {
        $scryfallIds = [];
        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return [];
        }

        foreach ($players as $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            foreach ($player['zones'] as $cards) {
                if (!is_array($cards)) {
                    continue;
                }

                foreach ($cards as $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
                    if ($scryfallId !== '') {
                        $scryfallIds[$scryfallId] = true;
                    }
                }
            }
        }

        return array_keys($scryfallIds);
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
