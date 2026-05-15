import {
  AfterViewInit,
  ChangeDetectionStrategy,
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

type ArrowCardSurface = 'battlefield' | 'mini-battlefield';
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
  private measureFrame: number | null = null;
  private readonly queueMeasureFromScroll = (): void => this.queueMeasure();
  private readonly measureKey = computed(() => {
    const snapshot = this.snapshot();
    const focusedPlayerId = this.focusedPlayerId() ?? '';
    const playersKey = this.players()
      .map((player) => `${player.id}:${player.state.zones.battlefield.map((card) => `${card.instanceId}:${card.position?.x ?? 0}:${card.position?.y ?? 0}:${card.tapped ? 1 : 0}`).join(',')}`)
      .join('|');
    const arrowsKey = snapshot?.arrows.map((arrow) => `${arrow.id}:${arrow.fromInstanceId}:${arrow.toInstanceId}:${arrow.color}`).join('|') ?? '';

    return `${snapshot?.version ?? 0}:${focusedPlayerId}:${arrowsKey}:${playersKey}`;
  });

  constructor() {
    effect(() => {
      const root = this.rootElement();
      untracked(() => this.observeRoot(root));
    });

    effect(() => {
      this.measureKey();
      this.rootElement();
      untracked(() => this.queueMeasure());
    });
  }

  ngAfterViewInit(): void {
    document.addEventListener('scroll', this.queueMeasureFromScroll, true);
    this.queueMeasure();
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.queueMeasureFromScroll, true);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearQueuedMeasure();
  }

  @HostListener('window:resize')
  handleWindowResize(): void {
    this.queueMeasure();
  }

  openArrowMenu(event: MouseEvent, arrow: GameArrowView): void {
    event.preventDefault();
    event.stopPropagation();
    this.arrowMenuOpened.emit({ event, playerId: arrow.ownerPlayerId, arrowId: arrow.id });
  }

  private observeRoot(root: HTMLElement | null): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (!root || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.queueMeasure());
    this.resizeObserver.observe(root);
  }

  private queueMeasure(): void {
    if (this.measureFrame !== null) {
      return;
    }

    this.measureFrame = window.requestAnimationFrame(() => {
      this.measureFrame = null;
      this.measureArrows();
    });
  }

  private clearQueuedMeasure(): void {
    if (this.measureFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.measureFrame);
    this.measureFrame = null;
  }

  private measureArrows(): void {
    const root = this.rootElement();
    const snapshot = this.snapshot();
    if (!root || !snapshot?.arrows.length) {
      this.setArrowViews([]);
      return;
    }

    const rootRect = root.getBoundingClientRect();
    this.viewport.set({
      width: Math.max(1, Math.round(rootRect.width)),
      height: Math.max(1, Math.round(rootRect.height)),
    });

    const locations = this.battlefieldLocations(snapshot);
    const views = snapshot.arrows
      .map((arrow) => this.arrowView(root, rootRect, locations, arrow))
      .filter((view): view is GameArrowView => view !== null);
    this.setArrowViews(views);
  }

  private arrowView(
    root: HTMLElement,
    rootRect: DOMRect,
    locations: ReadonlyMap<string, ArrowCardLocation>,
    arrow: GameArrow,
  ): GameArrowView | null {
    const ownerLocation = locations.get(arrow.fromInstanceId);
    const targetLocation = locations.get(arrow.toInstanceId);
    if (!ownerLocation || !targetLocation) {
      return null;
    }

    const ownerEndpoint = this.endpoint(root, rootRect, ownerLocation);
    const targetEndpoint = this.endpoint(root, rootRect, targetLocation);
    if (!ownerEndpoint || !targetEndpoint) {
      return null;
    }

    return {
      id: arrow.id,
      markerId: `game-arrow-head-${this.safeDomId(arrow.id)}`,
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

  private endpoint(root: HTMLElement, rootRect: DOMRect, location: ArrowCardLocation): ArrowEndpoint | null {
    const renderMode = this.renderMode(location.playerId);
    const surface: ArrowCardSurface = renderMode === 'focused-battlefield' ? 'battlefield' : 'mini-battlefield';
    const element = this.cardElement(root, location.playerId, location.card.instanceId, surface);
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return null;
    }

    return {
      ...location,
      renderMode,
      center: {
        x: Math.round(rect.left - rootRect.left + rect.width / 2),
        y: Math.round(rect.top - rootRect.top + rect.height / 2),
      },
    };
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

  private cardElement(root: HTMLElement, playerId: string, instanceId: string, surface: ArrowCardSurface): HTMLElement | null {
    return root.querySelector<HTMLElement>(
      `[data-arrow-card-player-id="${this.escapeAttributeValue(playerId)}"]`
      + `[data-arrow-card-instance-id="${this.escapeAttributeValue(instanceId)}"]`
      + `[data-arrow-card-surface="${surface}"]`,
    );
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

  private arrowColor(color: string): string {
    const colors: Record<string, string> = {
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

  private escapeAttributeValue(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }

    return value.replace(/["\\]/g, '\\$&');
  }
}
