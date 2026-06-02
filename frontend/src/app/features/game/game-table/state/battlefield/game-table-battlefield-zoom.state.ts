import { Injectable, computed, signal } from '@angular/core';

export type BattlefieldZoomPercent = number;

export const MIN_BATTLEFIELD_ZOOM_PERCENT = 70;
export const MAX_BATTLEFIELD_ZOOM_PERCENT = 140;
export const DEFAULT_BATTLEFIELD_ZOOM_PERCENT = 100;
export const BATTLEFIELD_ZOOM_STEP_PERCENT = 1;
const BATTLEFIELD_ZOOM_STORAGE_KEY = 'commanderZone.gameTable.battlefieldZoomPercent';
const BASE_CARD_WIDTH_REM = 7.2;
const BASE_GAP_REM = 0.75;
const BASE_MANA_LANE_MIN_HEIGHT_REM = 11.2;

@Injectable()
export class GameTableBattlefieldZoomState {
  readonly zoomPercent = signal<BattlefieldZoomPercent>(this.readStoredZoomPercent());
  readonly minZoomPercent = MIN_BATTLEFIELD_ZOOM_PERCENT;
  readonly maxZoomPercent = MAX_BATTLEFIELD_ZOOM_PERCENT;
  readonly defaultZoomPercent = DEFAULT_BATTLEFIELD_ZOOM_PERCENT;
  readonly zoomStepPercent = BATTLEFIELD_ZOOM_STEP_PERCENT;
  readonly canZoomIn = computed(() => this.zoomPercent() < MAX_BATTLEFIELD_ZOOM_PERCENT);
  readonly canZoomOut = computed(() => this.zoomPercent() > MIN_BATTLEFIELD_ZOOM_PERCENT);
  readonly canResetZoom = computed(() => this.zoomPercent() !== DEFAULT_BATTLEFIELD_ZOOM_PERCENT);
  readonly cardWidthRem = computed(() => this.cardWidthRemFor(this.zoomPercent()));
  readonly gapRem = computed(() => this.gapRemFor(this.zoomPercent()));
  readonly manaLaneMinHeightRem = computed(() => this.manaLaneMinHeightRemFor(this.zoomPercent()));

  zoomIn(): void {
    this.setZoomPercent(this.zoomPercent() + BATTLEFIELD_ZOOM_STEP_PERCENT);
  }

  zoomOut(): void {
    this.setZoomPercent(this.zoomPercent() - BATTLEFIELD_ZOOM_STEP_PERCENT);
  }

  resetZoom(): void {
    this.setZoomPercent(DEFAULT_BATTLEFIELD_ZOOM_PERCENT);
  }

  setZoomPercent(percent: number): void {
    const nextPercent = this.normalizeRequestedZoomPercent(percent);
    if (this.zoomPercent() === nextPercent) {
      return;
    }

    this.zoomPercent.set(nextPercent);
    this.persistZoomPercent(nextPercent);
  }

  cardWidthRemFor(percent: BattlefieldZoomPercent): string {
    return this.scaledRem(BASE_CARD_WIDTH_REM, percent);
  }

  gapRemFor(percent: BattlefieldZoomPercent): string {
    return this.scaledRem(BASE_GAP_REM, percent);
  }

  manaLaneMinHeightRemFor(percent: BattlefieldZoomPercent): string {
    return this.scaledRem(BASE_MANA_LANE_MIN_HEIGHT_REM, percent);
  }

  private scaledRem(baseRem: number, percent: BattlefieldZoomPercent): string {
    const rem = baseRem * (percent / 100);

    return `${Number(rem.toFixed(3))}rem`;
  }

  private readStoredZoomPercent(): BattlefieldZoomPercent {
    const storedValue = this.storage()?.getItem(BATTLEFIELD_ZOOM_STORAGE_KEY);
    const parsedValue = Number(storedValue);

    return this.isSupportedZoomPercent(parsedValue)
      ? parsedValue
      : DEFAULT_BATTLEFIELD_ZOOM_PERCENT;
  }

  private persistZoomPercent(percent: BattlefieldZoomPercent): void {
    try {
      this.storage()?.setItem(BATTLEFIELD_ZOOM_STORAGE_KEY, String(percent));
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    }
  }

  private storage(): Storage | null {
    try {
      return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      return null;
    }
  }

  private normalizeRequestedZoomPercent(value: number): BattlefieldZoomPercent {
    if (!Number.isFinite(value)) {
      return DEFAULT_BATTLEFIELD_ZOOM_PERCENT;
    }

    return Math.max(
      MIN_BATTLEFIELD_ZOOM_PERCENT,
      Math.min(MAX_BATTLEFIELD_ZOOM_PERCENT, Math.round(value)),
    );
  }

  private isSupportedZoomPercent(value: number): value is BattlefieldZoomPercent {
    return Number.isInteger(value)
      && value >= MIN_BATTLEFIELD_ZOOM_PERCENT
      && value <= MAX_BATTLEFIELD_ZOOM_PERCENT;
  }
}
