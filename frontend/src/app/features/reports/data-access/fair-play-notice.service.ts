import { Injectable, signal } from '@angular/core';

const FAIR_PLAY_NOTICE_STORAGE_PREFIX = 'commanderzone.fair-play-notice';

@Injectable({ providedIn: 'root' })
export class FairPlayNoticeService {
  private readonly memoryAcknowledgements = new Set<string>();
  private readonly activeKeyState = signal<string | null>(null);

  readonly activeKey = this.activeKeyState.asReadonly();

  showIfNeeded(userId: string | null | undefined, gameId: string | null | undefined): void {
    const key = this.keyFor(userId, gameId);
    if (!key || this.isAcknowledged(key)) {
      return;
    }

    this.activeKeyState.set(key);
  }

  acknowledge(): void {
    const key = this.activeKeyState();
    if (!key) {
      return;
    }

    this.memoryAcknowledgements.add(key);
    try {
      globalThis.localStorage?.setItem(key, '1');
    } catch {
      // Private browsing or strict browser settings still retain this notice in memory.
    }
    this.activeKeyState.set(null);
  }

  private keyFor(userId: string | null | undefined, gameId: string | null | undefined): string | null {
    const normalizedUserId = userId?.trim();
    const normalizedGameId = gameId?.trim();

    return normalizedUserId && normalizedGameId
      ? `${FAIR_PLAY_NOTICE_STORAGE_PREFIX}.${normalizedUserId}.${normalizedGameId}`
      : null;
  }

  private isAcknowledged(key: string): boolean {
    if (this.memoryAcknowledgements.has(key)) {
      return true;
    }

    try {
      return globalThis.localStorage?.getItem(key) === '1';
    } catch {
      return false;
    }
  }
}
