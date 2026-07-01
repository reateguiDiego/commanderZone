<?php

namespace App\Application\Game;

use App\Application\Game\Compact\CardStaticBundle;
use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Game\GameSnapshotCompact;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

final class GameEventStoreV2
{
    /**
     * @var array<string,int|float>
     */
    private array $lastReplayMetrics = [];

    public function __construct(
        private ManagerRegistry $managerRegistry,
        private GameCommandHandler $normalizer,
        private ?CompactGameCardStateMapper $compactStateMapper = null,
        private ?GameEventReplayService $replayService = null,
        private ?GameplayV2Flags $flagsV2 = null,
        private ?GameVisibilityIndex $visibilityIndex = null,
        #[Autowire('%gameplay_v2_snapshot_every_events%')]
        private int $snapshotEveryEvents = 25,
        #[Autowire('%gameplay_v2_snapshot_every_seconds%')]
        private int $snapshotEverySeconds = 30,
    ) {
    }

    public function enabled(): bool
    {
        return $this->flagsV2?->eventEnabled() ?? false;
    }

    public function hydrateGame(Game $game): array
    {
        if (!$this->enabled()) {
            return $game->snapshot();
        }

        $manager = $this->manager();
        $managedGame = $this->managedGameReference($manager, $game);
        $latestCompactSnapshot = $this->latestCompactSnapshot($managedGame, $manager);
        $snapshot = $this->rebuildSnapshot(
            $game,
            $latestCompactSnapshot,
            $this->eventsForGame($managedGame, $manager),
        );
        $this->detachReadOnlyCompactSnapshot($manager, $latestCompactSnapshot);
        $game->replaceRuntimeSnapshot($snapshot);

        return $snapshot;
    }

    public function initializeStartedGame(EntityManagerInterface $entityManager, Game $game, User $actor): ?GameEvent
    {
        if (!$this->enabled()) {
            return null;
        }

        $snapshot = $game->snapshot();
        $version = max(1, (int) ($snapshot['version'] ?? 1));
        $event = new GameEvent(
            $game,
            'game.started',
            [
                'status' => $game->status(),
                'phase' => is_string($snapshot['gamePhase'] ?? null) ? $snapshot['gamePhase'] : null,
                'snapshotVersion' => $version,
            ],
            $actor,
            'game-started-'.$game->id(),
            $version,
        );
        $game->addEvent($event);
        $entityManager->persist($event);
        $this->persistCompactSnapshotIfDue($entityManager, $game, $snapshot);

        return $event;
    }

    /**
     * @param list<GameEvent> $events
     *
     * @return array<string,mixed>
     */
    public function rebuildSnapshot(Game $game, ?GameSnapshotCompact $latestCompactSnapshot, array $events): array
    {
        $legacySnapshot = $game->persistedSnapshot();
        $legacyVersion = max(1, (int) ($legacySnapshot['version'] ?? 1));
        $baseSnapshot = $legacySnapshot;
        $baseVersion = $legacyVersion;
        $compactChecksumMismatch = false;

        if ($latestCompactSnapshot instanceof GameSnapshotCompact) {
            $expectedChecksum = $this->checksum($latestCompactSnapshot->snapshot());
            if (!hash_equals($expectedChecksum, $latestCompactSnapshot->checksum())) {
                $compactChecksumMismatch = true;
            } elseif ($latestCompactSnapshot->version() >= $legacyVersion) {
                $baseSnapshot = $this->hydrateCompactSnapshot($latestCompactSnapshot->snapshot(), $legacySnapshot);
                $baseVersion = $latestCompactSnapshot->version();
            }
        }

        $snapshot = $this->normalizer->normalizeSnapshot($baseSnapshot);
        $eventsToReplay = array_values(array_filter(
            $events,
            static fn (mixed $event): bool => $event instanceof GameEvent && $event->version() > $baseVersion,
        ));
        $runtimeStaticCards = [
            ...$this->runtimeStaticCardsFromSnapshot($snapshot),
            ...$this->runtimeStaticCardsFromEvents($events),
        ];
        if ($runtimeStaticCards !== []) {
            $snapshot['cardCatalog'] = [
                ...(is_array($snapshot['cardCatalog'] ?? null) ? $snapshot['cardCatalog'] : []),
                ...$runtimeStaticCards,
            ];
        }
        $replayStartedAt = microtime(true);
        $snapshot = $this->replayService()->replay($snapshot, $eventsToReplay);
        $this->lastReplayMetrics = [
            'mulligan.replay_ms' => round(max(0, (microtime(true) - $replayStartedAt) * 1000), 2),
            'mulligan.replay_event_count' => count(array_filter(
                $eventsToReplay,
                static fn (GameEvent $event): bool => str_starts_with($event->type(), 'mulligan.'),
            )),
            'gameplay.compact_snapshot_checksum_mismatch' => $compactChecksumMismatch ? 1 : 0,
        ];
        $snapshot = $this->normalizer->normalizeSnapshot($snapshot);
        if ($this->flagsV2?->visibilityEnabled() ?? false) {
            ($this->visibilityIndex ?? new GameVisibilityIndex())->rebuild($snapshot);
        }

        return $snapshot;
    }

    /**
     * @return array<string,int|float>
     */
    public function consumeLastReplayMetrics(): array
    {
        $metrics = $this->lastReplayMetrics;
        $this->lastReplayMetrics = [];

        return $metrics;
    }

    /**
     * @param array<string,mixed> $runtimeSnapshot
     */
    public function persistCompactSnapshotIfDue(EntityManagerInterface $entityManager, Game $game, array $runtimeSnapshot): ?GameSnapshotCompact
    {
        if (!$this->enabled()) {
            return null;
        }

        $managedGame = $this->managedGameReference($entityManager, $game);
        $latestSnapshot = $this->latestCompactSnapshot($managedGame, $entityManager);
        $shouldPersist = $this->shouldPersistCompactSnapshot($latestSnapshot, $managedGame, $runtimeSnapshot);
        $this->detachReadOnlyCompactSnapshot($entityManager, $latestSnapshot);
        if (!$shouldPersist) {
            return null;
        }

        $compactSnapshot = $this->compactStateMapper()->compactSnapshot($runtimeSnapshot, $managedGame->id(), $managedGame->status());
        unset($compactSnapshot['cardCatalog']);
        $record = new GameSnapshotCompact(
            $managedGame,
            max(1, (int) ($runtimeSnapshot['version'] ?? 1)),
            $compactSnapshot,
            $this->checksum($compactSnapshot),
        );
        $entityManager->persist($record);

        return $record;
    }

    /**
     * @param array<string,mixed> $runtimeSnapshot
     */
    public function shouldPersistCompactSnapshot(?GameSnapshotCompact $latestSnapshot, Game $game, array $runtimeSnapshot): bool
    {
        $currentVersion = max(1, (int) ($runtimeSnapshot['version'] ?? 1));
        if ($latestSnapshot === null) {
            return true;
        }
        if ($currentVersion <= $latestSnapshot->version()) {
            return false;
        }
        if ($game->status() === Game::STATUS_FINISHED) {
            return true;
        }
        if (($currentVersion - $latestSnapshot->version()) >= max(1, $this->snapshotEveryEvents)) {
            return true;
        }

        return $latestSnapshot->createdAt()->getTimestamp() <= (time() - max(1, $this->snapshotEverySeconds));
    }

    private function managedGameReference(EntityManagerInterface $entityManager, Game $game): Game
    {
        try {
            if ($entityManager->contains($game)) {
                return $game;
            }
        } catch (\Throwable) {
            return $game;
        }

        try {
            $reference = $entityManager->getReference(Game::class, $game->id());
        } catch (\Throwable) {
            return $game;
        }

        return $reference instanceof Game ? $reference : $game;
    }

    private function detachReadOnlyCompactSnapshot(EntityManagerInterface $entityManager, ?GameSnapshotCompact $snapshot): void
    {
        if (!$snapshot instanceof GameSnapshotCompact) {
            return;
        }

        try {
            $entityManager->detach($snapshot);
        } catch (\Throwable) {
        }
    }

    /**
     * @param array<string,mixed> $snapshot
     */
    public function checksum(array $snapshot): string
    {
        return hash('sha256', json_encode($snapshot, JSON_THROW_ON_ERROR));
    }

    /**
     * @return list<GameEvent>
     */
    private function eventsForGame(Game $game, ?EntityManagerInterface $entityManager = null): array
    {
        $manager = $entityManager ?? $this->manager();
        $repository = $manager->getRepository(GameEvent::class);
        $events = $repository->findBy(['game' => $game], ['version' => 'ASC']);

        return array_values(array_filter($events, static fn (mixed $event): bool => $event instanceof GameEvent));
    }

    private function latestCompactSnapshot(Game $game, ?EntityManagerInterface $entityManager = null): ?GameSnapshotCompact
    {
        $manager = $entityManager ?? $this->manager();
        $snapshot = $manager->getRepository(GameSnapshotCompact::class)->findOneBy(['game' => $game], ['version' => 'DESC']);

        return $snapshot instanceof GameSnapshotCompact ? $snapshot : null;
    }

    private function manager(): EntityManagerInterface
    {
        $manager = $this->managerRegistry->getManagerForClass(Game::class)
            ?? $this->managerRegistry->getManager();
        \assert($manager instanceof EntityManagerInterface);

        return $manager;
    }

    private function compactStateMapper(): CompactGameCardStateMapper
    {
        return $this->compactStateMapper ?? new CompactGameCardStateMapper();
    }

    private function replayService(): GameEventReplayService
    {
        return $this->replayService ?? new GameEventReplayService();
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,array<string,mixed>>
     */
    private function runtimeStaticCardsFromSnapshot(array $snapshot): array
    {
        $staticCards = [];
        foreach (is_array($snapshot['players'] ?? null) ? $snapshot['players'] : [] as $player) {
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
                    $cardKey = $this->runtimeCardKey($card);
                    if ($cardKey === '') {
                        continue;
                    }
                    $staticCards[$cardKey] ??= $this->runtimeStaticCard($cardKey, $card);
                }
            }
        }

        return $staticCards;
    }

    /**
     * @param list<GameEvent> $events
     *
     * @return array<string,array<string,mixed>>
     */
    private function runtimeStaticCardsFromEvents(array $events): array
    {
        $staticCards = [];
        foreach ($events as $event) {
            if (!$event instanceof GameEvent) {
                continue;
            }
            $payload = $event->payload();
            $eventStaticCards = is_array($payload['staticCards'] ?? null) ? $payload['staticCards'] : [];
            foreach ($eventStaticCards as $cardKey => $card) {
                if (!is_string($cardKey) || !is_array($card) || trim($cardKey) === '') {
                    continue;
                }
                $staticCards[$cardKey] = $this->runtimeStaticCard($cardKey, $card);
            }
        }

        return $staticCards;
    }

    /**
     * @param array<string,mixed> $card
     */
    private function runtimeCardKey(array $card): string
    {
        foreach (['cardKey', 'cardRef'] as $field) {
            if (is_string($card[$field] ?? null) && trim($card[$field]) !== '') {
                return trim($card[$field]);
            }
        }

        $scryfallId = is_string($card['scryfallId'] ?? null) ? trim($card['scryfallId']) : '';
        if ($scryfallId !== '') {
            return $scryfallId.(($card['isToken'] ?? false) === true ? ':token' : ':card');
        }

        return '';
    }

    /**
     * @param array<string,mixed> $card
     *
     * @return array<string,mixed>
     */
    private function runtimeStaticCard(string $cardKey, array $card): array
    {
        unset($card['oracleText']);
        if (is_array($card['cardFaces'] ?? null)) {
            $card['cardFaces'] = array_values(array_map(
                static function (mixed $face): mixed {
                    if (is_array($face)) {
                        unset($face['oracleText']);
                    }

                    return $face;
                },
                $card['cardFaces'],
            ));
        }

        $bundle = CardStaticBundle::fromLegacyCard([
            ...$card,
            'cardKey' => $cardKey,
        ]);
        $staticCard = $bundle->toArray();
        $staticCard['cardKey'] = $cardKey;

        return $staticCard;
    }

    /**
     * @param array<string,mixed> $compactSnapshot
     * @param array<string,mixed> $legacySnapshot
     *
     * @return array<string,mixed>
     */
    private function hydrateCompactSnapshot(array $compactSnapshot, array $legacySnapshot): array
    {
        if (!isset($compactSnapshot['cardCatalog']) || !is_array($compactSnapshot['cardCatalog'])) {
            $legacyCompact = $this->compactStateMapper()->compactSnapshot($legacySnapshot);
            $compactSnapshot['cardCatalog'] = is_array($legacyCompact['cardCatalog'] ?? null)
                ? $legacyCompact['cardCatalog']
                : [];
        }

        return $this->compactStateMapper()->hydrateSnapshot($compactSnapshot);
    }
}
