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
import { CardPreviewEvent } from '../card-preview.model';
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

  private updateViewportSize(size: Pick<DOMRectReadOnly, 'width' | 'height'>): void {
    const width = Math.round(size.width);
    const height = Math.round(size.height);
    const current = this.viewportSize();
    if (width <= 0 || height <= 0 || (current.width === width && current.height === height)) {
      return;
    }

    this.viewportSize.set({ width, height });
  }
}
