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
import { GameAttachment, GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';
import { BattlefieldMechanicsOverlayComponent } from '../battlefield-mechanics-overlay/battlefield-mechanics-overlay.component';
import { CardPreviewEvent, CardPreviewSourceRect } from '../../models/card-preview.model';
import { AttachmentStackView, attachmentStackViewFor, buildAttachmentStackGroups } from '../../utils/attachment-stack';
import { isBattlefieldMechanicOverlayCard } from '../../utils/gameplay-card-kind';
import {
  MiniBattlefieldCardLayout,
  MiniBattlefieldSize,
  layoutOpponentMiniBattlefield,
} from './opponent-mini-battlefield-layout';

@Component({
  selector: 'app-opponent-mini-battlefield',
  imports: [GameCardViewComponent, BattlefieldMechanicsOverlayComponent],
  templateUrl: './opponent-mini-battlefield.component.html',
  styleUrl: './opponent-mini-battlefield.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpponentMiniBattlefieldComponent implements AfterViewInit, OnDestroy {
  private resizeObserver: ResizeObserver | null = null;

  @ViewChild('viewport', { static: true }) private readonly viewport?: ElementRef<HTMLElement>;

  readonly playerId = input.required<string>();
  readonly cards = input.required<readonly GameCardInstance[]>();
  readonly mechanicCards = input<readonly GameCardInstance[]>([]);
  readonly attachments = input<readonly GameAttachment[]>([]);
  readonly backgroundImage = input<string>('');
  readonly battlefieldSize = input<MiniBattlefieldSize>({ width: 900, height: 520 });
  readonly cardPosition = input.required<(card: GameCardInstance) => { x: number; y: number } | null>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly isCardDropSettling = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly isManaDropSettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isBattlefieldEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCommanderEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCardTransferPending = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly arrowTargeting = input(false);

  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly battlefieldCardClicked = output<{ event: MouseEvent; playerId: string; card: GameCardInstance }>();

  readonly viewportSize = signal<MiniBattlefieldSize>({ width: 240, height: 172 });
  readonly activePreviewInstanceId = signal<string | null>(null);
  readonly layoutCards = computed(() => this.cards().filter((card) => !isBattlefieldMechanicOverlayCard(card)));
  readonly attachmentStackGroups = computed(() => buildAttachmentStackGroups(
    this.layoutCards(),
    this.attachments(),
    (candidate) => this.cardPosition()(candidate),
  ));
  readonly attachmentStackViews = computed<ReadonlyMap<string, AttachmentStackView>>(() => {
    const views = new Map<string, AttachmentStackView>();

    for (const group of this.attachmentStackGroups()) {
      for (const member of group.members) {
        const view = attachmentStackViewFor([group], member.card.instanceId);
        if (view) {
          views.set(member.card.instanceId, view);
        }
      }
    }

    return views;
  });
  readonly cardLayouts = computed(() => {
    const baseLayouts = layoutOpponentMiniBattlefield(this.layoutCards(), this.viewportSize(), {
      boardSize: this.battlefieldSize(),
      getPosition: this.cardPosition(),
    });

    return this.withAttachmentStackLayouts(baseLayouts);
  });
  readonly mechanicMiniCardWidthPx = computed(() => {
    const referenceLayout = this.cardLayouts()[0];
    if (referenceLayout) {
      return roundMiniPixel(Math.max(16, referenceLayout.width * 0.92));
    }

    return roundMiniPixel(clamp(this.viewportSize().width * 0.09, 20, 46));
  });
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
    const baseZIndex = Math.round((layout.top + layout.height) * 10) + index;
    if (layout.instanceId === this.activePreviewInstanceId()) {
      return baseZIndex + 1000;
    }

    const attachmentView = this.attachmentStackView(layout.instanceId);
    if (attachmentView?.role === 'target') {
      return baseZIndex + 20;
    }
    if (attachmentView?.role === 'equipment') {
      return baseZIndex + Math.max(1, 12 - attachmentView.layer);
    }

    return baseZIndex;
  }

  attachmentStackView(instanceId: string): AttachmentStackView | null {
    return this.attachmentStackViews().get(instanceId) ?? null;
  }

  showCardPreview(event: CardPreviewEvent): void {
    this.cardPreviewShown.emit({
      ...event,
      playerId: this.playerId(),
      zone: 'battlefield',
    });
  }

  clickBattlefieldCard(event: MouseEvent, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();
    this.battlefieldCardClicked.emit({ event, playerId: this.playerId(), card });
  }

  handlePointerMove(event: PointerEvent): void {
    const target = this.cardAtPoint(event);
    if (!target) {
      this.clearActivePreview();
      return;
    }

    if (target.card.instanceId === this.activePreviewInstanceId()) {
      return;
    }

    this.activePreviewInstanceId.set(target.card.instanceId);
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
    if (this.activePreviewInstanceId() === null) {
      return;
    }

    this.activePreviewInstanceId.set(null);
    this.cardPreviewHidden.emit();
  }

  private withAttachmentStackLayouts(baseLayouts: readonly MiniBattlefieldCardLayout[]): MiniBattlefieldCardLayout[] {
    const layoutsById = new Map(baseLayouts.map((layout) => [layout.instanceId, { ...layout }]));
    const viewport = this.viewportSize();

    for (const group of this.attachmentStackGroups()) {
      const targetLayout = layoutsById.get(group.targetCard.instanceId);
      if (!targetLayout) {
        continue;
      }

      const offsetX = Math.max(3, targetLayout.width * 0.1);
      const offsetY = Math.max(4, targetLayout.height * 0.09);
      const proposed = group.members.map((member) => {
        const currentLayout = layoutsById.get(member.card.instanceId);

        return currentLayout
          ? {
              ...currentLayout,
              left: targetLayout.left + offsetX * member.layer,
              top: targetLayout.top - offsetY * member.layer,
            }
          : null;
      }).filter((layout): layout is MiniBattlefieldCardLayout => layout !== null);

      const shift = miniStackViewportShift(proposed, viewport);
      for (const layout of proposed) {
        layoutsById.set(layout.instanceId, {
          ...layout,
          left: roundMiniPixel(layout.left + shift.x),
          top: roundMiniPixel(layout.top + shift.y),
        });
      }
    }

    return baseLayouts.map((layout) => layoutsById.get(layout.instanceId) ?? layout);
  }

  private cardAtPoint(event: PointerEvent): { card: GameCardInstance; sourceRect: CardPreviewSourceRect } | null {
    const viewport = this.viewport?.nativeElement;
    if (!viewport) {
      return null;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const x = event.clientX - viewportRect.left;
    const y = event.clientY - viewportRect.top;
    const cardsById = new Map(this.layoutCards().map((card) => [card.instanceId, card]));
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

function miniStackViewportShift(
  layouts: readonly MiniBattlefieldCardLayout[],
  viewport: MiniBattlefieldSize,
): { x: number; y: number } {
  if (layouts.length === 0) {
    return { x: 0, y: 0 };
  }

  const minLeft = Math.min(...layouts.map((layout) => layout.left));
  const minTop = Math.min(...layouts.map((layout) => layout.top));
  const maxRight = Math.max(...layouts.map((layout) => layout.left + layout.width));
  const maxBottom = Math.max(...layouts.map((layout) => layout.top + layout.height));
  const x = minLeft < 0 ? -minLeft : maxRight > viewport.width ? viewport.width - maxRight : 0;
  const y = minTop < 0 ? -minTop : maxBottom > viewport.height ? viewport.height - maxBottom : 0;

  return { x, y };
}

function roundMiniPixel(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
