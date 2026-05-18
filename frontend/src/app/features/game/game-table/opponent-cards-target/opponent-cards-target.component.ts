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
import { GameCardInstance } from '../../../../core/models/game.model';
import { CardPreviewEvent, previewRectFromElement } from '../card-preview.model';
import { OpponentCardsTargetCard, OpponentCardsTargetRole } from '../opponent-cards-target-card.model';
import {
  MiniBattlefieldCardLayout,
  MiniBattlefieldSize,
  layoutOpponentMiniBattlefield,
} from '../opponent-mini-battlefield/opponent-mini-battlefield-layout';

@Component({
  selector: 'app-opponent-cards-target',
  templateUrl: './opponent-cards-target.component.html',
  styleUrl: './opponent-cards-target.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpponentCardsTargetComponent implements AfterViewInit, OnDestroy {
  private resizeObserver: ResizeObserver | null = null;

  @ViewChild('viewport', { static: true }) private readonly viewport?: ElementRef<HTMLElement>;

  readonly playerId = input.required<string>();
  readonly cards = input.required<readonly OpponentCardsTargetCard[]>();
  readonly battlefieldSize = input<MiniBattlefieldSize>({ width: 900, height: 520 });
  readonly cardPosition = input.required<(card: GameCardInstance) => { x: number; y: number } | null>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly arrowTargeting = input(false);

  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly battlefieldCardClicked = output<{ event: MouseEvent; playerId: string; card: GameCardInstance }>();

  readonly viewportSize = signal<MiniBattlefieldSize>({ width: 240, height: 172 });
  readonly arrowAnchorLayouts = computed(() =>
    layoutOpponentMiniBattlefield(this.cards().map((item) => item.card), this.viewportSize(), {
      boardSize: this.battlefieldSize(),
      getPosition: this.cardPosition(),
    }),
  );
  readonly arrowAnchorLayoutById = computed(() => new Map(this.arrowAnchorLayouts().map((layout) => [layout.instanceId, layout])));

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

  roleLabel(role: OpponentCardsTargetRole): string {
    const labels: Record<OpponentCardsTargetRole, string> = {
      source: 'Origen',
      target: 'Objetivo',
      both: 'Origen/objetivo',
    };

    return labels[role];
  }

  arrowAnchorLayout(card: GameCardInstance): MiniBattlefieldCardLayout | null {
    return this.arrowAnchorLayoutById().get(card.instanceId) ?? null;
  }

  showCardPreview(event: MouseEvent, card: GameCardInstance): void {
    this.cardPreviewShown.emit({
      card,
      playerId: this.playerId(),
      zone: 'battlefield',
      sourceRect: previewRectFromElement(event.currentTarget as Element | null),
    });
  }

  clickBattlefieldCard(event: MouseEvent, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();
    this.battlefieldCardClicked.emit({ event, playerId: this.playerId(), card });
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
