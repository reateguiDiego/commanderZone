import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameSnapshot } from '../../../../core/models/game.model';
import { GameTableCoreState } from '../state/core/game-table-core.state';
import { GameTableNormalizedV2Store } from '../state/realtime/game-table-normalized-v2.store';

const PAGE_SIZE = 50;

@Injectable()
export class GameTableLogHistoryService {
  private readonly gamesApi = inject(GamesApi);
  private readonly core = inject(GameTableCoreState);
  private readonly normalizedV2Store = inject(GameTableNormalizedV2Store);
  private readonly loadingOlderState = signal(false);
  private readonly hasOlderState = signal(false);
  private readonly nextBeforeState = signal<string | null>(null);
  private readonly loadingNewerState = signal(false);
  private readonly hasNewerState = signal(false);
  private readonly nextAfterState = signal<string | null>(null);
  private readonly viewingOlderHistoryState = signal(false);
  private readonly restoringLatestState = signal(false);

  readonly loadingOlder = this.loadingOlderState.asReadonly();
  readonly hasOlder = this.hasOlderState.asReadonly();
  readonly canLoadOlder = computed(() => this.hasOlderState() && !this.loadingOlderState());
  readonly loadingNewer = this.loadingNewerState.asReadonly();
  readonly canLoadNewer = computed(() => this.hasNewerState() && !this.loadingNewerState());
  readonly viewingOlderHistory = this.viewingOlderHistoryState.asReadonly();

  reset(snapshot: GameSnapshot): void {
    const oldestEntryId = snapshot.eventLog[0]?.id ?? null;
    this.nextBeforeState.set(oldestEntryId);
    this.nextAfterState.set(snapshot.eventLog.at(-1)?.id ?? null);
    this.hasOlderState.set(snapshot.eventLog.length === PAGE_SIZE && oldestEntryId !== null);
    this.hasNewerState.set(false);
    this.viewingOlderHistoryState.set(false);
    this.loadingOlderState.set(false);
    this.loadingNewerState.set(false);
  }

  async loadOlder(): Promise<void> {
    const gameId = this.core.gameId();
    const before = this.nextBeforeState();
    if (!gameId || !before || !this.canLoadOlder()) {
      return;
    }

    this.loadingOlderState.set(true);
    try {
      const latestEntryId = this.core.snapshot()?.eventLog.at(-1)?.id ?? null;
      const page = await firstValueFrom(this.gamesApi.logHistoryPage(gameId, before, PAGE_SIZE));
      const snapshot = this.normalizedV2Store.prependLogEntries(page.data, PAGE_SIZE * 5);
      if (snapshot) {
        this.core.snapshot.set(snapshot);
        this.viewingOlderHistoryState.set(true);
        const retainedLatestEntryId = snapshot.eventLog.at(-1)?.id ?? null;
        if (latestEntryId !== retainedLatestEntryId && retainedLatestEntryId) {
          this.nextAfterState.set(retainedLatestEntryId);
          this.hasNewerState.set(true);
        }
      }
      const nextBefore = page.nextBefore ?? null;
      this.nextBeforeState.set(nextBefore);
      this.hasOlderState.set(page.hasMore && nextBefore !== null);
    } catch {
      // The next scroll can safely retry a transient history request.
    } finally {
      this.loadingOlderState.set(false);
    }
  }

  async loadNewer(): Promise<void> {
    const gameId = this.core.gameId();
    const after = this.nextAfterState();
    if (!gameId || !after || !this.canLoadNewer()) {
      return;
    }

    this.loadingNewerState.set(true);
    try {
      const page = await firstValueFrom(this.gamesApi.logForwardPage(gameId, after, PAGE_SIZE));
      const snapshot = this.normalizedV2Store.appendLogEntries(page.data, PAGE_SIZE * 5);
      if (snapshot) {
        this.core.snapshot.set(snapshot);
      }
      const nextAfter = page.nextAfter ?? null;
      this.nextAfterState.set(nextAfter);
      this.hasNewerState.set(page.hasMore && nextAfter !== null);
    } catch {
      // The next scroll can safely retry a transient history request.
    } finally {
      this.loadingNewerState.set(false);
    }
  }

  async restoreLatest(): Promise<void> {
    const gameId = this.core.gameId();
    if (!gameId || !this.viewingOlderHistoryState() || this.restoringLatestState()) {
      return;
    }

    this.restoringLatestState.set(true);
    try {
      const page = await firstValueFrom(this.gamesApi.logLatestPage(gameId, PAGE_SIZE));
      const snapshot = this.normalizedV2Store.replaceLogEntries(page.data);
      if (snapshot) {
        this.core.snapshot.set(snapshot);
        this.reset(snapshot);
      }
    } finally {
      this.restoringLatestState.set(false);
    }
  }
}
