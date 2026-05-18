import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { GameArrow, GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { PlayerView } from '../game-table.store';

type ArrowCardSurface = 'battlefield' | 'mini-battlefield' | 'cards-target';
type ArrowRenderMode = 'focused-battlefield' | 'mini-battlefield';

interface ArrowCardLocation {
  readonly playerId: string;
  readonly username: string;
  readonly card: GameCardInstance;
}

interface ArrowEndpoint {
  readonly playerId: string;
  readonly username: string;
  readonly card: GameCardInstance;
  readonly renderMode: ArrowRenderMode;
  readonly center: Point;
}

interface ArrowSurfaceCenter {
  readonly center: Point;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface ArrowViewport {
  readonly width: number;
  readonly height: number;
}

interface GameArrowView {
  readonly id: string;
  readonly markerId: string;
  readonly arrowOwnerPlayerId: string;
  readonly ownerPlayerId: string;
  readonly ownerUsername: string;
  readonly ownerCard: GameCardInstance;
  readonly ownerRenderMode: ArrowRenderMode;
  readonly targetPlayerId: string;
  readonly targetUsername: string;
  readonly targetCard: GameCardInstance;
  readonly targetRenderMode: ArrowRenderMode;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly color: string;
}

export interface GameArrowMenuEvent {
  readonly event: MouseEvent;
  readonly playerId: string;
  readonly arrowId: string;
}

@Component({
  selector: 'app-game-arrow-layer',
  templateUrl: './game-arrow-layer.component.html',
  styleUrl: './game-arrow-layer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameArrowLayerComponent implements AfterViewInit, OnDestroy {
  readonly snapshot = input<GameSnapshot | null>(null);
  readonly focusedPlayerId = input<string | null>(null);
  readonly players = input<readonly PlayerView[]>([]);
  readonly rootElement = input<HTMLElement | null>(null);

  readonly arrowMenuOpened = output<GameArrowMenuEvent>();
  readonly viewport = signal<ArrowViewport>({ width: 1, height: 1 });
  readonly arrowViews = signal<readonly GameArrowView[]>([]);

  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private measureFrame: number | null = null;
  private followUpMeasureFrames = 0;
  private deferredPublishFrames = 0;
  private settlingMeasureFrames = 0;
  private lastFocusedPlayerId: string | null = null;
  private observedRoot: HTMLElement | null = null;
  private destroyed = false;
  private readonly queueMeasureFromScroll = (): void => this.queueMeasure();
  private readonly queueMeasureFromTransition = (): void => this.queueMeasure(2, 0, 14);
  private readonly measureKey = computed(() => {
    const snapshot = this.snapshot();
    const focusedPlayerId = this.focusedPlayerId() ?? '';
    const playersKey = this.players()
      .map((player) => `${player.id}:${player.state.zones.battlefield.map((card) => `${card.instanceId}:${card.position?.x ?? 0}:${card.position?.y ?? 0}:${card.position?.unit ?? 'pixel'}:${card.tapped ? 1 : 0}`).join(',')}`)
      .join('|');
    const arrowsKey = snapshot?.arrows.map((arrow) => `${arrow.id}:${arrow.fromInstanceId}:${arrow.toInstanceId}:${arrow.color}`).join('|') ?? '';

    return `${snapshot?.version ?? 0}:${focusedPlayerId}:${arrowsKey}:${playersKey}`;
  });

  constructor(private readonly changeDetector: ChangeDetectorRef) {
    effect(() => {
      const root = this.rootElement();
      untracked(() => this.observeRoot(root));
    });

    effect(() => {
      this.measureKey();
      const focusedPlayerId = this.focusedPlayerId();
      this.rootElement();
      untracked(() => {
        const focusChanged = this.lastFocusedPlayerId !== null && this.lastFocusedPlayerId !== focusedPlayerId;
        this.lastFocusedPlayerId = focusedPlayerId;
        if (focusChanged) {
          this.arrowViews.set([]);
          this.queueMeasure(0, 10, 24);
          return;
        }

        this.queueMeasure(2);
      });
    });
  }

  ngAfterViewInit(): void {
    document.addEventListener('scroll', this.queueMeasureFromScroll, true);
    this.queueMeasure();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    document.removeEventListener('scroll', this.queueMeasureFromScroll, true);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.clearQueuedMeasure();
  }

  @HostListener('window:resize')
  handleWindowResize(): void {
    this.queueMeasure(2);
  }

  openArrowMenu(event: MouseEvent, arrow: GameArrowView): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrowMenuOpened.emit({ event, playerId: arrow.arrowOwnerPlayerId, arrowId: arrow.id });
  }

  private observeRoot(root: HTMLElement | null): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.observedRoot?.removeEventListener('transitionrun', this.queueMeasureFromTransition, true);
    this.observedRoot?.removeEventListener('transitionstart', this.queueMeasureFromTransition, true);
    this.observedRoot?.removeEventListener('transitionend', this.queueMeasureFromTransition, true);
    this.observedRoot = null;
    if (!root || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.observedRoot = root;
    root.addEventListener('transitionrun', this.queueMeasureFromTransition, true);
    root.addEventListener('transitionstart', this.queueMeasureFromTransition, true);
    root.addEventListener('transitionend', this.queueMeasureFromTransition, true);
    this.resizeObserver = new ResizeObserver(() => this.queueMeasure(2));
    this.resizeObserver.observe(root);
    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => this.queueMeasure(2));
      this.mutationObserver.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'class',
          'style',
          'data-arrow-card-player-id',
          'data-arrow-card-instance-id',
          'data-arrow-card-surface',
        ],
      });
    }
  }

  private queueMeasure(followUpFrames = 0, deferredPublishFrames = 0, settlingFrames = 0): void {
    this.followUpMeasureFrames = Math.max(this.followUpMeasureFrames, followUpFrames);
    this.deferredPublishFrames = Math.max(this.deferredPublishFrames, deferredPublishFrames);
    this.settlingMeasureFrames = Math.max(this.settlingMeasureFrames, settlingFrames);
    if (this.measureFrame !== null) {
      return;
    }

    this.measureFrame = window.requestAnimationFrame(() => {
      this.measureFrame = null;
      const shouldDeferPublish = this.deferredPublishFrames > 0;
      this.measureArrows(!shouldDeferPublish);
      if (this.deferredPublishFrames > 0) {
        this.deferredPublishFrames -= 1;
      }
      if (this.followUpMeasureFrames > 0) {
        this.followUpMeasureFrames -= 1;
      }
      if (this.settlingMeasureFrames > 0) {
        this.settlingMeasureFrames -= 1;
      }
      if (shouldDeferPublish || this.deferredPublishFrames > 0 || this.followUpMeasureFrames > 0 || this.settlingMeasureFrames > 0) {
        this.queueMeasure();
      }
    });
  }

  private clearQueuedMeasure(): void {
    if (this.measureFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.measureFrame);
    this.measureFrame = null;
    this.followUpMeasureFrames = 0;
    this.deferredPublishFrames = 0;
    this.settlingMeasureFrames = 0;
  }

  private measureArrows(publish = true): void {
    const root = this.rootElement();
    const snapshot = this.snapshot();
    if (!root || !snapshot?.arrows.length) {
      if (publish) {
        this.setArrowViews([]);
        this.renderMeasuredState();
      }
      return;
    }

    const rootRect = root.getBoundingClientRect();
    this.viewport.set({
      width: Math.max(1, Math.round(rootRect.width)),
      height: Math.max(1, Math.round(rootRect.height)),
    });

    const locations = this.battlefieldLocations(snapshot);
    const surfaceCenters = this.arrowSurfaceCenters(root, rootRect);
    const views = snapshot.arrows
      .map((arrow) => this.arrowView(surfaceCenters, locations, arrow))
      .filter((view): view is GameArrowView => view !== null);
    if (publish) {
      this.setArrowViews(views);
      this.renderMeasuredState();
    }
  }

  private arrowView(
    surfaceCenters: ReadonlyMap<string, ArrowSurfaceCenter>,
    locations: ReadonlyMap<string, ArrowCardLocation>,
    arrow: GameArrow,
  ): GameArrowView | null {
    const ownerLocation = locations.get(arrow.fromInstanceId);
    const targetLocation = locations.get(arrow.toInstanceId);
    if (!ownerLocation || !targetLocation) {
      return null;
    }

    const ownerEndpoint = this.endpoint(surfaceCenters, ownerLocation);
    const targetEndpoint = this.endpoint(surfaceCenters, targetLocation);
    if (!ownerEndpoint || !targetEndpoint) {
      return null;
    }

    return {
      id: arrow.id,
      markerId: `game-arrow-head-${this.safeDomId(arrow.id)}`,
      arrowOwnerPlayerId: arrow.ownerId ?? ownerEndpoint.playerId,
      ownerPlayerId: ownerEndpoint.playerId,
      ownerUsername: ownerEndpoint.username,
      ownerCard: ownerEndpoint.card,
      ownerRenderMode: ownerEndpoint.renderMode,
      targetPlayerId: targetEndpoint.playerId,
      targetUsername: targetEndpoint.username,
      targetCard: targetEndpoint.card,
      targetRenderMode: targetEndpoint.renderMode,
      x1: ownerEndpoint.center.x,
      y1: ownerEndpoint.center.y,
      x2: targetEndpoint.center.x,
      y2: targetEndpoint.center.y,
      color: this.arrowColor(arrow.color),
    };
  }

  private endpoint(surfaceCenters: ReadonlyMap<string, ArrowSurfaceCenter>, location: ArrowCardLocation): ArrowEndpoint | null {
    const renderMode = this.renderMode(location.playerId);
    const surfaceCenter = this.preferredSurfaceCenter(surfaceCenters, location, renderMode);
    if (!surfaceCenter) {
      return null;
    }

    return {
      ...location,
      renderMode,
      center: surfaceCenter.center,
    };
  }

  private preferredSurfaceCenter(
    surfaceCenters: ReadonlyMap<string, ArrowSurfaceCenter>,
    location: ArrowCardLocation,
    renderMode: ArrowRenderMode,
  ): ArrowSurfaceCenter | null {
    const surfaces: readonly ArrowCardSurface[] = renderMode === 'focused-battlefield'
      ? ['battlefield']
      : ['cards-target', 'mini-battlefield'];

    for (const surface of surfaces) {
      const center = surfaceCenters.get(this.surfaceCenterKey(location.playerId, location.card.instanceId, surface));
      if (center) {
        return center;
      }
    }

    return null;
  }

  private battlefieldLocations(snapshot: GameSnapshot): ReadonlyMap<string, ArrowCardLocation> {
    const locations = new Map<string, ArrowCardLocation>();
    for (const [playerId, player] of Object.entries(snapshot.players)) {
      const username = player.user.displayName || player.user.email || playerId;
      for (const card of player.zones.battlefield) {
        locations.set(card.instanceId, { playerId, username, card });
      }
    }

    return locations;
  }

  private renderMode(playerId: string): ArrowRenderMode {
    return playerId === this.focusedPlayerId() ? 'focused-battlefield' : 'mini-battlefield';
  }

  private arrowSurfaceCenters(root: HTMLElement, rootRect: DOMRect): ReadonlyMap<string, ArrowSurfaceCenter> {
    const centers = new Map<string, ArrowSurfaceCenter>();
    for (const element of root.querySelectorAll<HTMLElement>(
      '[data-arrow-card-player-id][data-arrow-card-instance-id][data-arrow-card-surface]',
    )) {
      const playerId = element.dataset['arrowCardPlayerId'];
      const instanceId = element.dataset['arrowCardInstanceId'];
      const surface = element.dataset['arrowCardSurface'];
      if (!playerId || !instanceId || !this.isArrowCardSurface(surface)) {
        continue;
      }

      const center = this.elementCenter(element, rootRect);
      if (!center) {
        continue;
      }

      centers.set(this.surfaceCenterKey(playerId, instanceId, surface), { center });
    }

    return centers;
  }

  private elementCenter(element: HTMLElement, rootRect: DOMRect): Point | null {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return null;
    }

    return {
      x: Math.round(rect.left - rootRect.left + rect.width / 2),
      y: Math.round(rect.top - rootRect.top + rect.height / 2),
    };
  }

  private surfaceCenterKey(playerId: string, instanceId: string, surface: ArrowCardSurface): string {
    return `${playerId}:${instanceId}:${surface}`;
  }

  private isArrowCardSurface(value: string | undefined): value is ArrowCardSurface {
    return value === 'battlefield' || value === 'mini-battlefield' || value === 'cards-target';
  }

  private setArrowViews(views: readonly GameArrowView[]): void {
    const nextKey = views.map((view) => `${view.id}:${view.x1}:${view.y1}:${view.x2}:${view.y2}:${view.color}:${view.ownerRenderMode}:${view.targetRenderMode}`).join('|');
    const currentKey = this.arrowViews()
      .map((view) => `${view.id}:${view.x1}:${view.y1}:${view.x2}:${view.y2}:${view.color}:${view.ownerRenderMode}:${view.targetRenderMode}`)
      .join('|');
    if (nextKey === currentKey) {
      return;
    }

    this.arrowViews.set(views);
  }

  private renderMeasuredState(): void {
    if (this.destroyed) {
      return;
    }

    this.changeDetector.detectChanges();
  }

  private arrowColor(color: string): string {
    const colors: Record<string, string> = {
      white: '#f8f1d8',
      yellow: '#d7b46a',
      red: '#ef4444',
      green: '#22c55e',
      blue: '#38bdf8',
      black: '#d1d5db',
    };

    return colors[color] ?? colors['yellow'];
  }

  private safeDomId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-');
  }
}
