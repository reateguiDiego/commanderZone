<?php

namespace App\Application\Game;

use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\Contract\V2\GameplayV2Flags;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Game\GameSnapshotCompact;
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

        $snapshot = $this->rebuildSnapshot(
            $game,
            $this->latestCompactSnapshot($game),
            $this->eventsForGame($game),
        );
        $game->replaceRuntimeSnapshot($snapshot);

        return $snapshot;
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

        if ($latestCompactSnapshot instanceof GameSnapshotCompact) {
            $expectedChecksum = $this->checksum($latestCompactSnapshot->snapshot());
            if (!hash_equals($expectedChecksum, $latestCompactSnapshot->checksum())) {
                throw new \RuntimeException('Compact snapshot checksum mismatch.');
            }

            if ($latestCompactSnapshot->version() >= $legacyVersion) {
                $baseSnapshot = $this->hydrateCompactSnapshot($latestCompactSnapshot->snapshot(), $legacySnapshot);
                $baseVersion = $latestCompactSnapshot->version();
            }
        }

        $snapshot = $this->normalizer->normalizeSnapshot($baseSnapshot);
        $eventsToReplay = array_values(array_filter(
            $events,
            static fn (mixed $event): bool => $event instanceof GameEvent && $event->version() > $baseVersion,
        ));
        $replayStartedAt = microtime(true);
        $snapshot = $this->replayService()->replay($snapshot, $eventsToReplay);
        $this->lastReplayMetrics = [
            'mulligan.replay_ms' => round(max(0, (microtime(true) - $replayStartedAt) * 1000), 2),
            'mulligan.replay_event_count' => count(array_filter(
                $eventsToReplay,
                static fn (GameEvent $event): bool => str_starts_with($event->type(), 'mulligan.'),
            )),
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

        $latestSnapshot = $this->latestCompactSnapshot($game);
        if (!$this->shouldPersistCompactSnapshot($latestSnapshot, $game, $runtimeSnapshot)) {
            return null;
        }

        $compactSnapshot = $this->compactStateMapper()->compactSnapshot($runtimeSnapshot, $game->id(), $game->status());
        unset($compactSnapshot['cardCatalog']);
        $record = new GameSnapshotCompact(
            $game,
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
    private function eventsForGame(Game $game): array
    {
        $manager = $this->manager();
        $repository = $manager->getRepository(GameEvent::class);
        $events = $repository->findBy(['game' => $game], ['version' => 'ASC']);

        return array_values(array_filter($events, static fn (mixed $event): bool => $event instanceof GameEvent));
    }

    private function latestCompactSnapshot(Game $game): ?GameSnapshotCompact
    {
        $manager = $this->manager();
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
