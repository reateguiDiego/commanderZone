import { Injectable, computed, signal, type Signal, type WritableSignal } from '@angular/core';

export type BattlefieldZoomPercent = number;

export const MIN_BATTLEFIELD_ZOOM_PERCENT = 70;
export const MAX_BATTLEFIELD_ZOOM_PERCENT = 140;
export const DEFAULT_BATTLEFIELD_ZOOM_PERCENT = 100;
export const BATTLEFIELD_ZOOM_STEP_PERCENT = 1;
export const MIN_GRID_BATTLEFIELD_ZOOM_PERCENT = 40;
export const MAX_GRID_BATTLEFIELD_ZOOM_PERCENT = 70;
export const DEFAULT_GRID_BATTLEFIELD_ZOOM_PERCENT = 60;
const BASE_CARD_WIDTH_REM = 7.2;
const BASE_GAP_REM = 0.75;
const BASE_MANA_LANE_MIN_HEIGHT_REM = 11.2;

interface BattlefieldZoomConfiguration {
  readonly minZoomPercent: BattlefieldZoomPercent;
  readonly maxZoomPercent: BattlefieldZoomPercent;
  readonly defaultZoomPercent: BattlefieldZoomPercent;
  readonly storageKey: string;
}

class BattlefieldZoomState {
  private readonly configuration: BattlefieldZoomConfiguration;
  readonly zoomPercent: WritableSignal<BattlefieldZoomPercent>;
  readonly minZoomPercent: BattlefieldZoomPercent;
  readonly maxZoomPercent: BattlefieldZoomPercent;
  readonly defaultZoomPercent: BattlefieldZoomPercent;
  readonly zoomStepPercent: BattlefieldZoomPercent;
  readonly canZoomIn: Signal<boolean>;
  readonly canZoomOut: Signal<boolean>;
  readonly canResetZoom: Signal<boolean>;
  readonly cardWidthRem: Signal<string>;
  readonly gapRem: Signal<string>;
  readonly manaLaneMinHeightRem: Signal<string>;

  constructor(configuration: BattlefieldZoomConfiguration) {
    this.configuration = configuration;
    this.minZoomPercent = configuration.minZoomPercent;
    this.maxZoomPercent = configuration.maxZoomPercent;
    this.defaultZoomPercent = configuration.defaultZoomPercent;
    this.zoomStepPercent = BATTLEFIELD_ZOOM_STEP_PERCENT;
    this.zoomPercent = signal<BattlefieldZoomPercent>(this.readStoredZoomPercent());
    this.canZoomIn = computed(() => this.zoomPercent() < this.maxZoomPercent);
    this.canZoomOut = computed(() => this.zoomPercent() > this.minZoomPercent);
    this.canResetZoom = computed(() => this.zoomPercent() !== this.defaultZoomPercent);
    this.cardWidthRem = computed(() => this.cardWidthRemFor(this.zoomPercent()));
    this.gapRem = computed(() => this.gapRemFor(this.zoomPercent()));
    this.manaLaneMinHeightRem = computed(() => this.manaLaneMinHeightRemFor(this.zoomPercent()));
  }

  zoomIn(): void {
    this.setZoomPercent(this.zoomPercent() + BATTLEFIELD_ZOOM_STEP_PERCENT);
  }

  zoomOut(): void {
    this.setZoomPercent(this.zoomPercent() - BATTLEFIELD_ZOOM_STEP_PERCENT);
  }

  resetZoom(): void {
    this.setZoomPercent(this.defaultZoomPercent);
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
    const storedValue = this.storage()?.getItem(this.configuration.storageKey);
    const parsedValue = Number(storedValue);

    return this.isSupportedZoomPercent(parsedValue)
      ? parsedValue
      : this.defaultZoomPercent;
  }

  private persistZoomPercent(percent: BattlefieldZoomPercent): void {
    try {
      this.storage()?.setItem(this.configuration.storageKey, String(percent));
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
      return this.defaultZoomPercent;
    }

    return Math.max(
      this.minZoomPercent,
      Math.min(this.maxZoomPercent, Math.round(value)),
    );
  }

  private isSupportedZoomPercent(value: number): value is BattlefieldZoomPercent {
    return Number.isInteger(value)
      && value >= this.minZoomPercent
      && value <= this.maxZoomPercent;
  }
}

@Injectable()
export class GameTableBattlefieldZoomState extends BattlefieldZoomState {
  constructor() {
    super({
      minZoomPercent: MIN_BATTLEFIELD_ZOOM_PERCENT,
      maxZoomPercent: MAX_BATTLEFIELD_ZOOM_PERCENT,
      defaultZoomPercent: DEFAULT_BATTLEFIELD_ZOOM_PERCENT,
      storageKey: 'commanderZone.gameTable.battlefieldZoomPercent',
    });
  }
}

@Injectable()
export class GameTableGridBattlefieldZoomState extends BattlefieldZoomState {
  constructor() {
    super({
      minZoomPercent: MIN_GRID_BATTLEFIELD_ZOOM_PERCENT,
      maxZoomPercent: MAX_GRID_BATTLEFIELD_ZOOM_PERCENT,
      defaultZoomPercent: DEFAULT_GRID_BATTLEFIELD_ZOOM_PERCENT,
      storageKey: 'commanderZone.gameTable.gridBattlefieldZoomPercent',
    });
  }
}
