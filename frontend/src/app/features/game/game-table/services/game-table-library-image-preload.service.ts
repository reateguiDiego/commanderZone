import { Injectable, OnDestroy } from '@angular/core';
import { GameCardInstance, GameSnapshot, GamePlayerState } from '../../../../core/models/game.model';
import {
  ImagePreloadQueueService,
  type ImagePreloadQueuePriority,
  type ImagePreloadRequest,
} from '../../../../shared/services/image-preload-queue.service';
import {
  LIBRARY_INITIAL_OVERSCAN_CARD_COUNT,
  LIBRARY_INITIAL_VISIBLE_CARD_COUNT,
} from '../utils/library-image-preload-plan';
import { GameTableSnapshotSelectors } from '../state/core/game-table-snapshot-selectors';
import { GameTablePlayersStore } from '../state/players/game-table-players.store';

const LIBRARY_PRELOAD_STORAGE_KEY = 'cz_perf_library_preload';

interface KnownLibraryImage {
  readonly instanceId: string;
  readonly url: string;
  readonly revealedTo: readonly string[] | undefined;
}

interface LibraryImagePreloadPlan {
  readonly fingerprint: string;
  readonly entries: readonly PlannedLibraryImagePreload[];
}

interface PlannedLibraryImagePreload {
  readonly url: string;
  readonly priority: ImagePreloadQueuePriority;
}

/**
 * Preloads only card identities that the current viewer already knows.
 *
 * A fully revealed library may use its authorized order to prioritize its
 * initial virtual window. A normal own-library projection can include card
 * identities while keeping its order secret, so that branch is deliberately
 * URL/instance sorted and background-only.
 */
@Injectable()
export class GameTableLibraryImagePreloadService implements OnDestroy {
  private readonly preloadEnabled =
    typeof window !== 'undefined'
    && window.localStorage.getItem(LIBRARY_PRELOAD_STORAGE_KEY) === '1';
  private readonly pendingRequests = new Set<ImagePreloadRequest>();
  private readonly requestGenerations = new Map<ImagePreloadRequest, number>();
  private activePlanFingerprint: string | null = null;
  private libraryPreloadGeneration = 0;

  constructor(
    private readonly imagePreloadQueue: ImagePreloadQueueService,
    private readonly playersStore: GameTablePlayersStore,
    private readonly selectors: GameTableSnapshotSelectors,
  ) {}

  sync(snapshot: GameSnapshot | null): void {
    if (!this.preloadEnabled) {
      this.invalidatePlan();
      return;
    }

    const currentPlayerId = this.playersStore.currentPlayer()?.id ?? null;
    const plan = this.planFor(snapshot, currentPlayerId);
    if (plan.fingerprint === this.activePlanFingerprint) {
      return;
    }

    this.libraryPreloadGeneration += 1;
    this.cancelPendingRequests();
    this.activePlanFingerprint = plan.fingerprint;

    for (const entry of plan.entries) {
      this.schedule(entry, this.libraryPreloadGeneration);
    }
  }

  ngOnDestroy(): void {
    this.invalidatePlan();
  }

  private planFor(snapshot: GameSnapshot | null, currentPlayerId: string | null): LibraryImagePreloadPlan {
    if (!snapshot || !currentPlayerId) {
      return { fingerprint: '[]', entries: [] };
    }

    const fingerprintGroups: unknown[] = [];
    const plannedImages = new Map<string, ImagePreloadQueuePriority>();
    const playerEntries = Object.entries(snapshot.players).sort(([leftPlayerId], [rightPlayerId]) =>
      leftPlayerId.localeCompare(rightPlayerId),
    );

    for (const [playerId, player] of playerEntries) {
      const knownImages = this.knownLibraryImages(player.zones.library);
      if (knownImages.length === 0) {
        continue;
      }

      if (this.isLibraryOrderAuthorized(player, currentPlayerId)) {
        fingerprintGroups.push({
          kind: 'ordered',
          playerId,
          revision: player.libraryShuffleRevision ?? null,
          images: knownImages,
        });
        this.addOrderedImages(plannedImages, knownImages);
        continue;
      }

      const neutralImages = playerId === currentPlayerId
        ? knownImages
        : knownImages.filter((image) => this.isRevealedToViewer(image.revealedTo, currentPlayerId));
      if (neutralImages.length === 0) {
        continue;
      }

      const sortedNeutralImages = this.sortNeutralImages(neutralImages);
      fingerprintGroups.push({
        kind: 'neutral',
        playerId,
        images: sortedNeutralImages,
      });
      this.addBackgroundImages(plannedImages, sortedNeutralImages);
    }

    return {
      fingerprint: JSON.stringify(fingerprintGroups),
      entries: [...plannedImages.entries()].map(([url, priority]) => ({ url, priority })),
    };
  }

  private knownLibraryImages(cards: readonly GameCardInstance[]): KnownLibraryImage[] {
    const images: KnownLibraryImage[] = [];

    for (const card of cards) {
      if (card.hidden === true || card.faceDown === true || card.staticCardPending === true) {
        continue;
      }

      const url = this.selectors.publicCardImage(card)?.trim();
      if (!url) {
        continue;
      }

      images.push({ instanceId: card.instanceId, url, revealedTo: card.revealedTo });
    }

    return images;
  }

  private isLibraryOrderAuthorized(player: GamePlayerState, currentPlayerId: string): boolean {
    return this.isRevealedToViewer(player.revealedLibraryTo, currentPlayerId);
  }

  private isRevealedToViewer(recipients: readonly string[] | undefined, currentPlayerId: string): boolean {
    return recipients?.includes(currentPlayerId) === true || recipients?.includes('all') === true;
  }

  private addOrderedImages(
    plannedImages: Map<string, ImagePreloadQueuePriority>,
    images: readonly KnownLibraryImage[],
  ): void {
    for (const [index, image] of images.entries()) {
      const priority = index < LIBRARY_INITIAL_VISIBLE_CARD_COUNT
        ? 'interaction'
        : index < LIBRARY_INITIAL_VISIBLE_CARD_COUNT + LIBRARY_INITIAL_OVERSCAN_CARD_COUNT
          ? 'visible'
          : 'background';
      this.addImage(plannedImages, image.url, priority);
    }
  }

  private addBackgroundImages(
    plannedImages: Map<string, ImagePreloadQueuePriority>,
    images: readonly KnownLibraryImage[],
  ): void {
    for (const image of images) {
      this.addImage(plannedImages, image.url, 'background');
    }
  }

  private addImage(
    plannedImages: Map<string, ImagePreloadQueuePriority>,
    url: string,
    priority: ImagePreloadQueuePriority,
  ): void {
    const existing = plannedImages.get(url);
    if (!existing || this.priorityWeight(priority) < this.priorityWeight(existing)) {
      plannedImages.set(url, priority);
    }
  }

  private sortNeutralImages(images: readonly KnownLibraryImage[]): KnownLibraryImage[] {
    return [...images].sort((left, right) =>
      left.url.localeCompare(right.url) || left.instanceId.localeCompare(right.instanceId),
    );
  }

  private priorityWeight(priority: ImagePreloadQueuePriority): number {
    switch (priority) {
      case 'critical':
        return 0;
      case 'interaction':
        return 1;
      case 'visible':
        return 2;
      case 'background':
        return 3;
    }
  }

  private schedule(entry: PlannedLibraryImagePreload, generation: number): void {
    const request = this.imagePreloadQueue.request(entry.url, entry.priority);
    this.pendingRequests.add(request);
    this.requestGenerations.set(request, generation);
    void request.completed.then(
      () => this.completeRequest(request, generation),
      () => this.completeRequest(request, generation),
    );
  }

  private completeRequest(request: ImagePreloadRequest, generation: number): void {
    if (this.requestGenerations.get(request) !== generation) {
      return;
    }

    this.requestGenerations.delete(request);
    this.pendingRequests.delete(request);
  }

  private invalidatePlan(): void {
    if (this.activePlanFingerprint === null && this.pendingRequests.size === 0) {
      return;
    }

    this.libraryPreloadGeneration += 1;
    this.cancelPendingRequests();
    this.activePlanFingerprint = null;
  }

  private cancelPendingRequests(): void {
    for (const request of this.pendingRequests) {
      this.requestGenerations.delete(request);
      request.cancel();
    }
    this.pendingRequests.clear();
  }
}
