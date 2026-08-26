import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../../core/api/games.api';
import { GameSnapshot } from '../../../../core/models/game.model';
import { GameTableCoreState } from '../state/core/game-table-core.state';
import { GameTableNormalizedV2Store } from '../state/realtime/game-table-normalized-v2.store';

const PAGE_SIZE = 50;
const MAXIMUM_CACHED_MESSAGES = PAGE_SIZE * 5;

@Injectable()
export class GameTableChatHistoryService {
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
  readonly loadingNewer = this.loadingNewerState.asReadonly();
  readonly canLoadOlder = computed(() => this.hasOlderState() && !this.loadingOlderState());
  readonly canLoadNewer = computed(() => this.hasNewerState() && !this.loadingNewerState());
  readonly viewingOlderHistory = this.viewingOlderHistoryState.asReadonly();

  reset(snapshot: GameSnapshot): void {
    const oldestMessageId = snapshot.chat[0]?.id ?? null;
    this.nextBeforeState.set(oldestMessageId);
    this.nextAfterState.set(snapshot.chat.at(-1)?.id ?? null);
    this.hasOlderState.set(snapshot.chat.length === PAGE_SIZE && oldestMessageId !== null);
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
      const latestMessageId = this.core.snapshot()?.chat.at(-1)?.id ?? null;
      const page = await firstValueFrom(this.gamesApi.chatHistoryPage(gameId, before, PAGE_SIZE));
      const snapshot = this.normalizedV2Store.prependChatMessages(page.data, MAXIMUM_CACHED_MESSAGES);
      if (snapshot) {
        this.core.snapshot.set(snapshot);
        this.viewingOlderHistoryState.set(true);
        const retainedLatestMessageId = snapshot.chat.at(-1)?.id ?? null;
        if (latestMessageId !== retainedLatestMessageId && retainedLatestMessageId) {
          this.nextAfterState.set(retainedLatestMessageId);
          this.hasNewerState.set(true);
        }
      }
      const nextBefore = page.nextBefore ?? null;
      this.nextBeforeState.set(nextBefore);
      this.hasOlderState.set(page.hasMore && nextBefore !== null);
    } catch {
      // A later scroll retries a transient request without retaining stale state.
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
      const page = await firstValueFrom(this.gamesApi.chatForwardPage(gameId, after, PAGE_SIZE));
      const snapshot = this.normalizedV2Store.appendChatMessages(page.data, MAXIMUM_CACHED_MESSAGES);
      if (snapshot) {
        this.core.snapshot.set(snapshot);
      }
      const nextAfter = page.nextAfter ?? null;
      this.nextAfterState.set(nextAfter);
      this.hasNewerState.set(page.hasMore && nextAfter !== null);
    } catch {
      // A later scroll retries a transient request without retaining stale state.
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
      const page = await firstValueFrom(this.gamesApi.chatLatestPage(gameId, PAGE_SIZE));
      const snapshot = this.normalizedV2Store.replaceChatMessages(page.data);
      if (snapshot) {
        this.core.snapshot.set(snapshot);
        this.reset(snapshot);
      }
    } finally {
      this.restoringLatestState.set(false);
    }
  }
}
