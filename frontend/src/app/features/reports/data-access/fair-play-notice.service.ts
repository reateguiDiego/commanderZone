import { Injectable, signal, untracked } from '@angular/core';

const FAIR_PLAY_NOTICE_STORAGE_PREFIX = 'commanderzone.fair-play-notice';

@Injectable({ providedIn: 'root' })
export class FairPlayNoticeService {
  private readonly memoryShownKeys = new Set<string>();
  private readonly activeKeyState = signal<string | null>(null);

  readonly activeKey = this.activeKeyState.asReadonly();

  showIfNeeded(userId: string | null | undefined, gameId: string | null | undefined): void {
    const key = this.keyFor(userId, gameId);
    const activeKey = untracked(() => this.activeKeyState());
    if (activeKey !== key) {
      this.activeKeyState.set(null);
    }

    if (!key || this.isShown(key)) {
      return;
    }

    this.markAsShown(key);
    this.activeKeyState.set(key);
  }

  acknowledge(): void {
    const key = this.activeKeyState();
    if (!key) {
      return;
    }

    this.activeKeyState.set(null);
  }

  private markAsShown(key: string): void {
    this.memoryShownKeys.add(key);
    try {
      globalThis.localStorage?.setItem(key, '1');
    } catch {
      // Private browsing or strict browser settings still retain this notice in memory.
    }
  }

  private keyFor(userId: string | null | undefined, gameId: string | null | undefined): string | null {
    const normalizedUserId = userId?.trim();
    const normalizedGameId = gameId?.trim();

    return normalizedUserId && normalizedGameId
      ? `${FAIR_PLAY_NOTICE_STORAGE_PREFIX}.${normalizedUserId}.${normalizedGameId}`
      : null;
  }

  private isShown(key: string): boolean {
    if (this.memoryShownKeys.has(key)) {
      return true;
    }

    try {
      return globalThis.localStorage?.getItem(key) === '1';
    } catch {
      return false;
    }
  }
}
