<?php

namespace App\Application\Game;

use App\Application\Card\CardLocalizationService;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Application\Game\TokenGroup\TokenGroupCanonicalizer;
use App\Application\Game\TokenGroup\TokenGroupContractException;
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
        private readonly ?GameLibraryOps $libraryOps = null,
        private readonly ?GameVisibilityIndex $visibilityIndex = null,
        private readonly ?GameplayV2Flags $flagsV2 = null,
        private readonly ?GameActivityStreamService $activityStreams = null,
        private readonly ?GameplayStreamsFlags $streamFlags = null,
        private readonly ?TokenGroupCanonicalizer $tokenGroupCanonicalizer = null,
    )
    {
    }

    public function project(Game $game, User $viewer): array
    {
        $rawSnapshot = $game->snapshot();
        $positionlessBattlefieldInstanceIds = $this->positionlessBattlefieldInstanceIds($rawSnapshot);
        $snapshot = $this->normalizer->normalizeSnapshot($rawSnapshot);
        $this->restorePositionlessBattlefieldInstances($snapshot, $positionlessBattlefieldInstanceIds);
        if (($this->streamFlags?->enabled() ?? false) && $this->activityStreams instanceof GameActivityStreamService) {
            $snapshot = $this->activityStreams->decorateSnapshotForViewer($game, $snapshot, $viewer);
        }

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
        $isMulliganPhase = ($snapshot['gamePhase'] ?? null) === 'MULLIGAN';

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
        $projectedRelationRefs = [];
        $projectedBattlefieldCards = [];

        foreach ($snapshot['players'] as $playerId => &$player) {
            $rawPlayer = $player;
            $zoneCounts = [];
            if (!isset($player['zones']) || !is_array($player['zones'])) {
                $player['zones'] = [];
            }
            $player['playerId'] = (string) $playerId;
            $tailTopLibrary = $this->libraryOps()->usesTailTop(is_array($rawPlayer) ? $rawPlayer : []);

            foreach ($player['zones'] as $zone => &$cards) {
                $rawZoneCards = array_values(is_array($cards) ? $cards : []);
                $zoneCounts[$zone] = count($cards);
                $isOwnHiddenZone = $viewerCanUseOwnHiddenZones && $playerId === $viewerId;
                if ((string) $zone === 'library' && $isOwnHiddenZone && !$isMulliganPhase) {
                    $cards = array_values(array_map(
                        fn (array $card): array => $this->projectCard($card, $viewerId, true, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup),
                        $this->libraryOps()->projectionOrderCards(is_array($rawPlayer) ? $rawPlayer : []),
                    ));
                } elseif ((string) $zone === 'hand' && !$isOwnHiddenZone) {
                    $cards = $this->projectOpponentHand($cards, $viewerId, (string) $playerId, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup);
                } elseif ((string) $zone === 'library' && ($isMulliganPhase || !$isOwnHiddenZone)) {
                    $cards = $this->projectOpponentLibraryZone(
                        $cards,
                        $viewerId,
                        (string) $playerId,
                        ($player['playTopLibraryRevealed'] ?? false) === true,
                        $tailTopLibrary,
                        is_array($rawPlayer) ? $rawPlayer : [],
                        $snapshot,
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
						fn (array $card, int $index): array => $this->projectCard(
							$card,
							$viewerId,
							$playerId === $viewerId,
							$requestedLanguage,
							$localizedCardsByLanguage,
							$rulingsLookup,
							(string) $zone === 'battlefield' ? $index : null,
						),
						$cards,
						array_keys($cards),
					));
                }
                if ((string) $zone === 'battlefield') {
                    foreach ($rawZoneCards as $index => $rawCard) {
                        $canonicalId = is_array($rawCard) ? trim((string) ($rawCard['instanceId'] ?? '')) : '';
                        $projectedCard = $cards[$index] ?? null;
                        $projectedId = is_array($projectedCard) ? trim((string) ($projectedCard['instanceId'] ?? '')) : '';
                        if ($canonicalId !== '' && $projectedId !== '') {
                            $projectedRelationRefs[$canonicalId] = $projectedId;
                            $projectedBattlefieldCards[$projectedId] = $projectedCard;
                        }
                    }
                }
            }
            unset($cards);
            $player['zoneCounts'] = $zoneCounts;
            $player['handCount'] = $zoneCounts['hand'] ?? 0;
            $player[GameLibraryOps::VISIBILITY_EPOCH_KEY] = max(0, (int) ($rawPlayer[GameLibraryOps::VISIBILITY_EPOCH_KEY] ?? 0));
            if ($isMulliganPhase) {
                $player['mulligan'] = $this->projectMulliganState(
                    is_array($player['mulligan'] ?? null) ? $player['mulligan'] : [],
                    is_array($rawPlayer) ? $rawPlayer : [],
                    $viewerCanUseOwnHiddenZones && $playerId === $viewerId,
                    $viewerId,
                    $requestedLanguage,
                    $localizedCardsByLanguage,
                    $rulingsLookup,
                );
            }
        }
        unset($player);

        $snapshot['arrows'] = $this->projectBinaryRelationsForViewer(
            is_array($snapshot['arrows'] ?? null) ? $snapshot['arrows'] : [],
            'fromInstanceId',
            'toInstanceId',
            $projectedRelationRefs,
        );
        $snapshot['attachments'] = $this->projectBinaryRelationsForViewer(
            is_array($snapshot['attachments'] ?? null) ? $snapshot['attachments'] : [],
            'equipmentInstanceId',
            'attachedToInstanceId',
            $projectedRelationRefs,
        );
        $snapshot['battlefieldStacks'] = $this->projectBattlefieldStacksForViewer(
            is_array($snapshot['battlefieldStacks'] ?? null) ? $snapshot['battlefieldStacks'] : [],
            $projectedRelationRefs,
        );
        $snapshot['tokenGroups'] = $this->projectTokenGroupsForViewer(
            is_array($snapshot['tokenGroups'] ?? null) ? $snapshot['tokenGroups'] : [],
            $projectedRelationRefs,
            $projectedBattlefieldCards,
            $viewerId,
        );

        $snapshot['stack'] = $this->projectStackForViewer(
            is_array($snapshot['stack'] ?? null) ? $snapshot['stack'] : [],
            $viewerId,
        );

        $snapshot['specialEntities'] = $this->projectSpecialEntities(
            is_array($snapshot['specialEntities'] ?? null) ? $snapshot['specialEntities'] : [],
            $requestedLanguage,
            $localizedCardsByLanguage,
        );
		if (is_array($snapshot['presence'] ?? null)) {
			foreach ($snapshot['presence'] as &$presence) {
				if (is_array($presence)) {
					unset($presence['connectionEpoch']);
				}
			}
			unset($presence);
		}
        // loc and the mask index are server-authoritative replay/projection
        // structures. Both are keyed by real instance IDs and must never be
        // serialized to a viewer bootstrap after hidden zones are projected
        // to opaque placeholders.
        unset($snapshot['loc'], $snapshot['visibility']);

        return $snapshot;
    }

    /**
     * @param list<array<string,mixed>> $relations
     * @param array<string,string>       $projectedRelationRefs
     *
     * @return list<array<string,mixed>>
     */
    private function projectBinaryRelationsForViewer(
        array $relations,
        string $sourceField,
        string $targetField,
        array $projectedRelationRefs,
    ): array {
        $projected = [];
        foreach ($relations as $relation) {
            if (!is_array($relation)) {
                continue;
            }
            $sourceCanonical = trim((string) ($relation[$sourceField] ?? ''));
            $targetCanonical = trim((string) ($relation[$targetField] ?? ''));
            $sourceProjected = $this->projectRelationInstanceReferenceForViewer($sourceCanonical, $projectedRelationRefs);
            $targetProjected = $this->projectRelationInstanceReferenceForViewer($targetCanonical, $projectedRelationRefs);
            if ($sourceProjected === null || $targetProjected === null) {
                continue;
            }
            $sourceOpaque = $sourceProjected !== $sourceCanonical;
            $targetOpaque = $targetProjected !== $targetCanonical;
            if ($sourceOpaque !== $targetOpaque) {
                // A mixed canonical/opaque edge reveals hidden battlefield structure.
                continue;
            }
            $relation[$sourceField] = $sourceProjected;
            $relation[$targetField] = $targetProjected;
            $projected[] = $relation;
        }

        return $projected;
    }

    /**
     * @param list<array<string,mixed>> $stacks
     * @param array<string,string>       $projectedRelationRefs
     *
     * @return list<array<string,mixed>>
     */
    private function projectBattlefieldStacksForViewer(array $stacks, array $projectedRelationRefs): array
    {
        $projected = [];
        foreach ($stacks as $stack) {
            if (!is_array($stack)) {
                continue;
            }
            $rootCanonical = trim((string) ($stack['rootInstanceId'] ?? ''));
            $members = array_values(array_filter($stack['orderedMemberIds'] ?? [], static fn (mixed $id): bool => is_string($id) && trim($id) !== ''));
            $canonicalRefs = array_values(array_unique([$rootCanonical, ...$members]));
            $projectedRefs = [];
            $opacity = null;
            foreach ($canonicalRefs as $canonicalRef) {
                $resolved = $this->projectRelationInstanceReferenceForViewer($canonicalRef, $projectedRelationRefs);
                if ($resolved === null) {
                    continue 2;
                }
                $currentOpacity = $resolved !== $canonicalRef;
                if ($opacity !== null && $opacity !== $currentOpacity) {
                    continue 2;
                }
                $opacity = $currentOpacity;
                $projectedRefs[$canonicalRef] = $resolved;
            }
            $stack['rootInstanceId'] = $projectedRefs[$rootCanonical];
            $stack['orderedMemberIds'] = array_values(array_map(
                static fn (string $memberId): string => $projectedRefs[$memberId],
                $members,
            ));
            $projected[] = $stack;
        }

        return $projected;
    }

    /**
     * @param list<array<string,mixed>>  $groups
     * @param array<string,string>       $projectedRelationRefs
     * @param array<string,array<string,mixed>> $projectedCards
     * @return list<array<string,mixed>>
     */
    private function projectTokenGroupsForViewer(array $groups, array $projectedRelationRefs, array $projectedCards, string $viewerId): array
    {
        $canonicalizer = $this->tokenGroupCanonicalizer ?? new TokenGroupCanonicalizer();
        $projected = [];
        foreach ($groups as $group) {
            if (!is_array($group)) {
                throw new TokenGroupContractException(TokenGroupCanonicalizer::INVARIANT_FAILED, ['invalidIndex' => count($projected)]);
            }
            $canonical = $canonicalizer->normalizeCanonical($group);
            $canonicalGroupId = $canonical['groupId'];
            $rootCanonical = $canonical['rootInstanceId'];
            $members = $canonical['orderedMemberIds'];
            $rootRef = $this->projectRelationInstanceReferenceForViewer($rootCanonical, $projectedRelationRefs);
            if ($rootRef === null) {
                throw new TokenGroupContractException(TokenGroupCanonicalizer::PROJECTION_INCOMPLETE, [
                    'count' => count($members),
                    'revision' => $canonical['revision'],
                    'invalidIndex' => array_search($rootCanonical, $members, true),
                ]);
            }
            $resolvedByCanonical = [];
            $fullyAuthorized = true;
            foreach ($members as $memberId) {
                $resolved = $this->projectRelationInstanceReferenceForViewer($memberId, $projectedRelationRefs);
                if ($resolved === null) {
                    $fullyAuthorized = false;
                    continue;
                }
                if ($resolved !== $memberId) {
                    $fullyAuthorized = false;
                }
                $resolvedByCanonical[$memberId] = $resolved;
            }
            $rootCard = $projectedCards[$rootRef] ?? [];
            $safeGroupId = !$fullyAuthorized
                ? $canonicalizer->opaqueGroupId($viewerId, $rootRef)
                : $canonicalGroupId;
            $view = [
                'groupId' => $safeGroupId,
                'rootRef' => $rootRef,
                'quantity' => count($members),
                'revision' => $canonical['revision'],
                'position' => is_array($rootCard['position'] ?? null) ? $rootCard['position'] : ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
                'faceDown' => ($rootCard['faceDown'] ?? false) === true,
                'tapped' => ($rootCard['tapped'] ?? false) === true,
                'rotation' => (int) ($rootCard['rotation'] ?? 0),
                'effectVersion' => TokenGroupCanonicalizer::EFFECT_VERSION,
            ];
            if ($fullyAuthorized) {
                $view['memberRefs'] = array_map(static fn (string $memberId): string => $resolvedByCanonical[$memberId], $members);
            }
            $projected[] = $canonicalizer->normalizeProjected($view);
        }

        return $projected;
    }

    /**
     * @param array<string,string> $projectedRelationRefs
     */
    private function projectRelationInstanceReferenceForViewer(string $instanceId, array $projectedRelationRefs): ?string
    {
        if ($instanceId === '' || !array_key_exists($instanceId, $projectedRelationRefs)) {
            return null;
        }

        $projected = trim($projectedRelationRefs[$instanceId]);

        return $projected !== '' ? $projected : null;
    }

    /**
     * @param list<array<string,mixed>> $items
     *
     * @return list<array<string,mixed>>
     */
    private function projectStackForViewer(array $items, string $viewerId): array
    {
        return array_values(array_map(static function (array $item) use ($viewerId): array {
            $visibility = is_string($item['visibility'] ?? null) ? $item['visibility'] : 'public';
            if ($visibility === 'public' || $visibility === 'player:'.$viewerId) {
                return $item;
            }

            unset(
                $item['sourceInstanceId'],
                $item['instanceId'],
                $item['cardKey'],
                $item['cardRef'],
                $item['card'],
                $item['controllerId'],
                $item['ownerId'],
                $item['visibility'],
            );

            return $item;
        }, array_values(array_filter($items, static fn (mixed $item): bool => is_array($item)))));
    }

    public function projectZone(
        array $cards,
        string $ownerId,
        string $zone,
        User $viewer,
        bool $playTopLibraryRevealed = false,
        ?array $localizedCardsByLanguage = null,
        ?array $playerState = null,
    ): array
    {
        $viewerId = $viewer->id();
        $requestedLanguage = $viewer->cardLanguage();
        $visibleScryfallIds = $this->visibleZoneScryfallIds(
            $cards,
            $ownerId,
            $zone,
            $viewerId,
            $playTopLibraryRevealed,
            is_array($playerState) ? $playerState : [],
        );
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
                return $this->projectOpponentLibraryZone(
                    $cards,
                    $viewerId,
                    $ownerId,
                    $playTopLibraryRevealed,
                    $this->libraryOps()->usesTailTop(is_array($playerState) ? $playerState : []),
                    is_array($playerState) ? $playerState : [],
                    [],
                    $requestedLanguage,
                    $localizedCardsByLanguage,
                    $rulingsLookup,
                );
            }

            $cards = array_values(array_filter($cards, fn (array $card): bool => $this->isVisibleCard($card, $viewerId)));
        }

		$orderedCards = $zone === 'library'
			? $this->orderedLibraryCards($cards, $this->libraryOps()->usesTailTop(is_array($playerState) ? $playerState : []))
			: array_values($cards);

		return array_values(array_map(
			fn (array $card, int $index): array => $this->projectCard(
				$card,
				$viewerId,
				$ownerId === $viewerId,
				$requestedLanguage,
				$localizedCardsByLanguage,
				$rulingsLookup,
				$zone === 'battlefield' ? $index : null,
			),
			$orderedCards,
			array_keys($orderedCards),
		));
    }

    /**
     * @param array<string,mixed> $mulligan
     * @param array<string,mixed> $rawPlayer
     *
     * @return array<string,mixed>
     */
    private function projectMulliganState(
        array $mulligan,
        array $rawPlayer,
        bool $isOwnPlayer,
        string $viewerId,
        ?string $requestedLanguage,
        ?array $localizedCardsByLanguage,
        ?array $rulingsLookup,
    ): array {
        $hand = is_array($rawPlayer['zones']['hand'] ?? null) ? $rawPlayer['zones']['hand'] : [];
        $status = is_string($mulligan['status'] ?? null) ? $mulligan['status'] : 'DECIDING';
        $projected = [
            'handCount' => count($hand),
            'mulligansTaken' => max(0, (int) ($mulligan['mulligansTaken'] ?? 0)),
            'effectiveMulligans' => max(0, (int) ($mulligan['effectiveMulligans'] ?? 0)),
            'status' => $status,
            'ready' => ($mulligan['ready'] ?? false) === true || $status === 'READY',
        ];

        if (!$isOwnPlayer) {
            return $projected;
        }

        $private = [
            ...$projected,
            'bottomSelectionCount' => max(0, (int) ($mulligan['bottomSelectionCount'] ?? 0)),
            'needsBottomSelection' => ($mulligan['needsBottomSelection'] ?? false) === true,
            'bottomOrderMode' => is_string($mulligan['bottomOrderMode'] ?? null) ? $mulligan['bottomOrderMode'] : 'NONE',
            'needsScryAfterKeep' => ($mulligan['needsScryAfterKeep'] ?? false) === true,
        ];

        $scryCardInstanceId = is_string($mulligan['scryCardInstanceId'] ?? null) ? $mulligan['scryCardInstanceId'] : '';
        $topCard = $this->libraryTopCard(is_array($rawPlayer) ? $rawPlayer : []);
        if ($status === 'SCRYING' && $scryCardInstanceId !== '' && is_array($topCard) && ($topCard['instanceId'] ?? null) === $scryCardInstanceId) {
            $private['scryCard'] = $this->projectCard(
                $topCard,
                $viewerId,
                true,
                $requestedLanguage,
                $localizedCardsByLanguage,
                $rulingsLookup,
            );
        }

        return $private;
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
    private function orderedLibraryCards(array $cards, bool $tailTop): array
    {
        $cards = $this->cardArrays($cards);

        return $tailTop ? array_values(array_reverse($cards)) : $cards;
    }

    /**
     * @param array<string,mixed> $player
     *
     * @return array<string,mixed>|null
     */
    private function libraryTopCard(array $player): ?array
    {
        return $this->libraryOps()->topCard($player);
    }

    /**
     * @param array<string,mixed> $player
     */
    private function isVisibleLibraryCard(array $card, string $viewerId, array $player): bool
    {
        if (!$this->libraryOps()->usesTailTop($player)) {
            return $this->isVisibleCard($card, $viewerId);
        }

        return $this->libraryOps()->isCardVisibleTo($player, $card, $viewerId);
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

        return array_values(array_map(
            fn (array $card, int $index): array => $this->isVisibleCard($card, $viewerId)
                ? $this->projectCard($card, $viewerId, false, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup)
                : $this->hiddenOpponentHandCard($ownerId, $index),
            $cards,
            array_keys($cards),
        ));
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
        bool $tailTop = false,
        array $playerState = [],
        array $snapshot = [],
        ?string $requestedLanguage = null,
        ?array $localizedCardsByLanguage = null,
        ?array $rulingsLookup = null,
    ): array
    {
        if ($this->usesVisibilityIndex($snapshot) && $playerState !== []) {
            $libraryState = $this->visibilityIndex()->libraryState($snapshot, $ownerId);
            if ($libraryState !== []) {
                $topInstanceId = (string) ($libraryState['topInstanceId'] ?? '');
                if ($topInstanceId !== '' && (
                    ($libraryState['playTopRevealed'] ?? false) === true
                    || $this->visibilityIndex()->canViewerSeeLibraryCard($snapshot, $libraryState, $topInstanceId, $viewerId)
                )) {
                    $topCards = $this->orderedTopLibraryCards($cards, $tailTop, $playerState, 1);
                    $topCard = $topCards[0] ?? null;
                    if (is_array($topCard)) {
                        $topCard['faceDown'] = false;

                        return [$this->projectCard($topCard, $viewerId, false, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup)];
                    }
                }

                if ((is_array($libraryState['topWindowIds'] ?? null) ? $libraryState['topWindowIds'] : []) !== []) {
                    return [$this->hiddenOpponentLibraryTopCard($ownerId)];
                }

                return [];
            }
        }

        $cards = $this->orderedLibraryCards($cards, $tailTop);
        if ($cards === []) {
            return [];
        }

        $topCard = $cards[0];
        if ($playTopRevealed || $this->isVisibleLibraryCard($topCard, $viewerId, $playerState)) {
            $topCard['faceDown'] = false;
            if ($playTopRevealed && !$this->isVisibleLibraryCard($topCard, $viewerId, $playerState)) {
                $topCard['revealedTo'] = ['all'];
            }

            return [$this->projectCard($topCard, $viewerId, false, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup)];
        }

        $topRevealedTo = $topCard['revealedTo'] ?? [];
        $topCardEpoch = (int) ($topCard[GameLibraryOps::CARD_VISIBILITY_EPOCH_KEY] ?? 0);
        $playerEpoch = max(0, (int) ($playerState[GameLibraryOps::VISIBILITY_EPOCH_KEY] ?? 1));
        if (is_array($topRevealedTo) && $topRevealedTo !== [] && (!$tailTop || $topCardEpoch === 0 || $topCardEpoch === $playerEpoch)) {
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
        bool $tailTop = false,
        array $playerState = [],
        array $snapshot = [],
        ?string $requestedLanguage = null,
        ?array $localizedCardsByLanguage = null,
        ?array $rulingsLookup = null,
    ): array
    {
        if ($this->usesVisibilityIndex($snapshot) && $playerState !== []) {
            $libraryState = $this->visibilityIndex()->libraryState($snapshot, $ownerId);
            if ($libraryState !== []) {
                $revealAllMask = (int) ($libraryState['revealAllMask'] ?? 0);
                $viewerMask = $this->visibilityIndex()->maskForViewer($snapshot, $viewerId);
                if ($revealAllMask > 0 && (($revealAllMask & $viewerMask) !== 0)) {
                    return array_values(array_map(
                        fn (array $card): array => $this->projectCard($this->faceUpLibraryCard($card), $viewerId, false, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup),
                        $this->orderedTopLibraryCards($cards, $tailTop, $playerState, null),
                    ));
                }

                $topWindowIds = is_array($libraryState['topWindowIds'] ?? null) ? array_values($libraryState['topWindowIds']) : [];
                if (count($topWindowIds) > 1) {
                    $visibleCards = array_values(array_filter(
                        $this->orderedTopLibraryCards($cards, $tailTop, $playerState, count($topWindowIds)),
                        fn (array $card): bool => $this->visibilityIndex()->canViewerSeeLibraryCard(
                            $snapshot,
                            $libraryState,
                            (string) ($card['instanceId'] ?? ''),
                            $viewerId,
                        ),
                    ));

                    if (count($visibleCards) > 1) {
                        return array_values(array_map(
                            fn (array $card): array => $this->projectCard($this->faceUpLibraryCard($card), $viewerId, false, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup),
                            $visibleCards,
                        ));
                    }
                }
            }
        }

        $visibleCards = array_values(array_filter(
            $this->orderedLibraryCards($cards, $tailTop),
            fn (array $card): bool => $this->isVisibleLibraryCard($card, $viewerId, $playerState),
        ));

        if (count($visibleCards) > 1) {
            return array_values(array_map(
                fn (array $card): array => $this->projectCard($this->faceUpLibraryCard($card), $viewerId, false, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup),
                $visibleCards,
            ));
        }

        return $this->projectOpponentLibrary($cards, $viewerId, $ownerId, $playTopRevealed, $tailTop, $playerState, $snapshot, $requestedLanguage, $localizedCardsByLanguage, $rulingsLookup);
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

    /**
     * @param array<int,array<string,mixed>> $cards
     *
     * @return list<array<string,mixed>>
     */
    private function orderedTopLibraryCards(array $cards, bool $tailTop, array $playerState, ?int $count): array
    {
        if ($playerState !== []) {
            return $this->libraryOps()->projectionOrderCards($playerState, $count);
        }

        $ordered = $this->orderedLibraryCards($cards, $tailTop);

        return $count === null ? $ordered : array_slice($ordered, 0, max(0, $count));
    }

    private function projectCard(
        array $card,
        string $viewerId,
        bool $ownerView,
        ?string $requestedLanguage = null,
        ?array $localizedCardsByLanguage = null,
        ?array $rulingsLookup = null,
		?int $opaqueBattlefieldIndex = null,
    ): array
    {
        $zone = (string) ($card['zone'] ?? '');
        if ($zone !== 'battlefield') {
            $card['tapped'] = false;
            $card['rotation'] = 0;
        }

        $controllerView = $zone === 'battlefield'
            && trim((string) ($card['controllerId'] ?? '')) === $viewerId;
        if (($card['faceDown'] ?? false) === true && !$ownerView && !$controllerView && !$this->isVisibleCard($card, $viewerId)) {
            return [
				'instanceId' => $zone === 'battlefield'
					? sprintf('%s-hidden-battlefield-%d', (string) ($card['ownerId'] ?? 'player'), max(0, $opaqueBattlefieldIndex ?? 0))
					: $card['instanceId'],
                'ownerId' => $card['ownerId'] ?? null,
                'controllerId' => $card['controllerId'] ?? null,
                'name' => 'Face-down card',
                'hidden' => true,
                'tapped' => $zone === 'battlefield' && (bool) ($card['tapped'] ?? false),
                'faceDown' => true,
                'position' => is_array($card['position'] ?? null) ? $card['position'] : null,
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

        if (!$ownerView && $this->zoneIsHidden($zone)) {
            unset($card['cardKey'], $card['cardRef'], $card['printId'], $card['cardVersion'], $card['language'], $card['viewerVisibility']);
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
     * @param array<string,mixed> $snapshot
     */
    private function usesVisibilityIndex(array $snapshot): bool
    {
        return ($this->flagsV2?->visibilityEnabled() ?? false)
            && $this->visibilityIndex instanceof GameVisibilityIndex
            && $this->visibilityIndex->isReady($snapshot);
    }

    private function visibilityIndex(): GameVisibilityIndex
    {
        return $this->visibilityIndex ?? new GameVisibilityIndex();
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
            $tailTopLibrary = $this->libraryOps()->usesTailTop($player);
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
                    $tailTopLibrary,
                    $player,
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
    private function visibleZoneScryfallIds(
        array $cards,
        string $ownerId,
        string $zone,
        string $viewerId,
        bool $playTopLibraryRevealed,
        array $playerState = [],
    ): array
    {
        return $this->cardsScryfallIds(
            $this->visibleCardsForZoneProjection(
                $cards,
                $ownerId,
                $zone,
                $viewerId,
                $playTopLibraryRevealed,
                $this->libraryOps()->usesTailTop($playerState),
                $playerState,
            ),
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
        bool $tailTopLibrary,
        array $playerState = [],
    ): array
    {
        if ($zone === 'hand' && !$isOwnHiddenZone) {
            return $this->visibleCards($cards, $viewerId);
        }

        if ($zone === 'library' && !$isOwnHiddenZone) {
            $normalizedCards = $this->orderedLibraryCards($cards, $tailTopLibrary);
            if ($normalizedCards === []) {
                return [];
            }

            $topCard = $normalizedCards[0];
            if ($playTopLibraryRevealed || $this->isVisibleLibraryCard($topCard, $viewerId, $playerState)) {
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
        bool $tailTopLibrary = false,
        array $playerState = [],
    ): array
    {
        if ($ownerId !== $viewerId && $this->zoneIsHidden($zone)) {
            if ($zone === 'hand') {
                return $this->visibleCards($cards, $viewerId);
            }

            if ($zone === 'library') {
                $visibleCards = array_values(array_filter(
                    $this->orderedLibraryCards($cards, $tailTopLibrary),
                    fn (array $card): bool => $this->isVisibleLibraryCard($card, $viewerId, $playerState),
                ));
                if (count($visibleCards) > 1) {
                    return $visibleCards;
                }

                $normalizedCards = $this->orderedLibraryCards($cards, $tailTopLibrary);
                if ($normalizedCards === []) {
                    return [];
                }

                $topCard = $normalizedCards[0];
                if ($playTopLibraryRevealed || $this->isVisibleLibraryCard($topCard, $viewerId, $playerState)) {
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
        $controllerView = (string) ($card['zone'] ?? '') === 'battlefield'
            && trim((string) ($card['controllerId'] ?? '')) === $viewerId;

        return !(($card['faceDown'] ?? false) === true && !$ownerView && !$controllerView && !$this->isVisibleCard($card, $viewerId));
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

    /**
     * @return array<string,true>
     */
    private function positionlessBattlefieldInstanceIds(array $snapshot): array
    {
        $ids = [];
        foreach (is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [] as $player) {
            if (!is_array($player)) {
                continue;
            }
            foreach (is_array($player['zones']['battlefield'] ?? null) ? $player['zones']['battlefield'] : [] as $card) {
                if (!is_array($card)) {
                    continue;
                }
                $instanceId = is_string($card['instanceId'] ?? null) ? trim($card['instanceId']) : '';
                if ($instanceId !== '' && !is_array($card['position'] ?? null)) {
                    $ids[$instanceId] = true;
                }
            }
        }

        return $ids;
    }

    /**
     * @param array<string,true> $instanceIds
     */
    private function restorePositionlessBattlefieldInstances(array &$snapshot, array $instanceIds): void
    {
        if ($instanceIds === [] || !is_array($snapshot['players'] ?? null)) {
            return;
        }
        foreach ($snapshot['players'] as &$player) {
            if (!is_array($player) || !is_array($player['zones']['battlefield'] ?? null)) {
                continue;
            }
            foreach ($player['zones']['battlefield'] as &$card) {
                if (!is_array($card)) {
                    continue;
                }
                $instanceId = is_string($card['instanceId'] ?? null) ? trim($card['instanceId']) : '';
                if ($instanceId !== '' && isset($instanceIds[$instanceId])) {
                    unset($card['position']);
                }
            }
            unset($card);
        }
        unset($player);
    }

    private function libraryOps(): GameLibraryOps
    {
        return $this->libraryOps ?? new GameLibraryOps();
    }
}
