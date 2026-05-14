import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';
import { CardPreviewEvent, CardPreviewSourceRect } from '../card-preview.model';
import {
  MiniBattlefieldCardLayout,
  MiniBattlefieldSize,
  layoutOpponentMiniBattlefield,
} from './opponent-mini-battlefield-layout';

@Component({
  selector: 'app-opponent-mini-battlefield',
  imports: [GameCardViewComponent],
  templateUrl: './opponent-mini-battlefield.component.html',
  styleUrl: './opponent-mini-battlefield.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpponentMiniBattlefieldComponent implements AfterViewInit, OnDestroy {
  private resizeObserver: ResizeObserver | null = null;
  private activePreviewInstanceId: string | null = null;

  @ViewChild('viewport', { static: true }) private readonly viewport?: ElementRef<HTMLElement>;

  readonly playerId = input.required<string>();
  readonly cards = input.required<readonly GameCardInstance[]>();
  readonly backgroundImage = input<string>('');
  readonly battlefieldSize = input<MiniBattlefieldSize>({ width: 900, height: 520 });
  readonly cardPosition = input.required<(card: GameCardInstance) => { x: number; y: number } | null>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly isCardDropSettling = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly isManaDropSettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isBattlefieldEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCommanderEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCardTransferPending = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);

  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();

  readonly viewportSize = signal<MiniBattlefieldSize>({ width: 240, height: 172 });
  readonly cardLayouts = computed(() =>
    layoutOpponentMiniBattlefield(this.cards(), this.viewportSize(), {
      boardSize: this.battlefieldSize(),
      getPosition: this.cardPosition(),
    }),
  );
  readonly cardLayoutById = computed(() => new Map(this.cardLayouts().map((layout) => [layout.instanceId, layout])));
  readonly backgroundImageCss = computed(() => {
    const image = this.backgroundImage().trim();

    return image ? `url("${image.replace(/"/g, '\\"')}")` : null;
  });

  ngAfterViewInit(): void {
    const element = this.viewport?.nativeElement;
    if (!element) {
      return;
    }

    this.updateViewportSize(element.getBoundingClientRect());
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(([entry]) => {
      const size = entry?.contentRect ?? element.getBoundingClientRect();
      this.updateViewportSize(size);
    });
    this.resizeObserver.observe(element);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  cardLayout(card: GameCardInstance): MiniBattlefieldCardLayout | null {
    return this.cardLayoutById().get(card.instanceId) ?? null;
  }

  miniCardZIndex(layout: MiniBattlefieldCardLayout, index: number): number {
    return Math.round((layout.top + layout.height) * 10) + index;
  }

  showCardPreview(event: CardPreviewEvent): void {
    this.cardPreviewShown.emit({ ...event, playerId: this.playerId(), zone: 'battlefield' });
  }

  handlePointerMove(event: PointerEvent): void {
    const target = this.cardAtPoint(event);
    if (!target) {
      this.clearActivePreview();
      return;
    }

    if (target.card.instanceId === this.activePreviewInstanceId) {
      return;
    }

    this.activePreviewInstanceId = target.card.instanceId;
    this.cardPreviewShown.emit({
      card: target.card,
      playerId: this.playerId(),
      zone: 'battlefield',
      sourceRect: target.sourceRect,
    });
  }

  handlePointerLeave(): void {
    this.clearActivePreview();
  }

  private updateViewportSize(size: Pick<DOMRectReadOnly, 'width' | 'height'>): void {
    const width = Math.round(size.width);
    const height = Math.round(size.height);
    const current = this.viewportSize();
    if (width <= 0 || height <= 0 || (current.width === width && current.height === height)) {
      return;
    }

    this.viewportSize.set({ width, height });
  }

  private clearActivePreview(): void {
    if (this.activePreviewInstanceId === null) {
      return;
    }

    this.activePreviewInstanceId = null;
    this.cardPreviewHidden.emit();
  }

  private cardAtPoint(event: PointerEvent): { card: GameCardInstance; sourceRect: CardPreviewSourceRect } | null {
    const viewport = this.viewport?.nativeElement;
    if (!viewport) {
      return null;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const x = event.clientX - viewportRect.left;
    const y = event.clientY - viewportRect.top;
    const cardsById = new Map(this.cards().map((card) => [card.instanceId, card]));
    const candidates = this.cardLayouts()
      .filter((layout) => x >= layout.left && x <= layout.left + layout.width && y >= layout.top && y <= layout.top + layout.height)
      .map((layout) => ({
        layout,
        card: cardsById.get(layout.instanceId),
        distance: Math.hypot(x - (layout.left + layout.width / 2), y - (layout.top + layout.height / 2)),
      }))
      .filter((candidate): candidate is { layout: MiniBattlefieldCardLayout; card: GameCardInstance; distance: number } =>
        Boolean(candidate.card)
      )
      .sort((left, right) => left.distance - right.distance);

    const target = candidates[0];
    if (!target) {
      return null;
    }

    return {
      card: target.card,
      sourceRect: this.sourceRectFromLayout(viewportRect, target.layout),
    };
  }

  private sourceRectFromLayout(viewportRect: DOMRect, layout: MiniBattlefieldCardLayout): CardPreviewSourceRect {
    const left = viewportRect.left + layout.left;
    const top = viewportRect.top + layout.top;

    return {
      left,
      top,
      right: left + layout.width,
      bottom: top + layout.height,
      width: layout.width,
      height: layout.height,
    };
  }
}
