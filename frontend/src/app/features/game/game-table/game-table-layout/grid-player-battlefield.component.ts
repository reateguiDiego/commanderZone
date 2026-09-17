import { NgTemplateOutlet } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, NgZone, OnChanges, OnDestroy, SimpleChanges, computed, inject, input, output, signal } from '@angular/core';
import { gsap } from 'gsap';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { PlayerSummaryPanelComponent } from '../components/player-summary-panel/player-summary-panel.component';
import { BattlefieldConcedeButtonComponent } from '../components/battlefield-concede-button/battlefield-concede-button.component';
import type {
  BattlefieldLayoutRect,
  GridPlayerCount,
  GridPlayerSummaryBindings,
  GridSeat,
  PlayerBattlefieldSize,
  PlayerRegionContext,
  PlayerRegionTemplates,
} from './game-table-grid-seat.model';

interface GridTurnStatus {
  readonly distance: number;
  readonly isActive: boolean;
  readonly key: string;
  readonly labelKey: string;
}

@Component({
  selector: 'app-grid-player-battlefield',
  imports: [NgTemplateOutlet, PlayerSummaryPanelComponent, BattlefieldConcedeButtonComponent, RuntimeTranslatePipe],
  templateUrl: './grid-player-battlefield.component.html',
  styleUrl: './grid-player-battlefield.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridPlayerBattlefieldComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ngZone = inject(NgZone);
  private battlefieldLayoutFingerprint: string | null = null;
  private collisionCheckFrame: number | null = null;
  private battlefieldMutationObserver: MutationObserver | null = null;
  private layoutResizeObserver: ResizeObserver | null = null;
  private summaryProtectedArea: DOMRect | null = null;
  private handDragPreviewVisible = false;
  private turnStatusAnimationFrame: number | null = null;

  readonly playerSeat = input.required<GridSeat>();
  readonly playerCount = input.required<GridPlayerCount>();
  readonly regions = input.required<PlayerRegionTemplates>();
  readonly summaryBindings = input.required<GridPlayerSummaryBindings>();
  readonly playmatImage = input<(player: GridSeat['player']) => string>(() => '');
  readonly isPlayerDropHighlighted = input<(playerId: string) => boolean>(() => false);
  readonly canConcede = input<(playerId: string) => boolean>(() => false);
  readonly summaryCompact = signal(false);
  readonly useSquareZonePresentation = signal(false);
  // Keep this input while the development server replaces the old header template.
  // The previous template reads it during HMR; the Grid layout no longer renders
  // any turn-owner header UI.
  readonly isTurnOwner = input(false);
  readonly turnDistance = input<number | null>(null);
  // Kept alongside isTurnOwner for the stale development template during HMR.
  // Neither value produces header UI in the current Grid template.
  readonly defeated = () => false;
  readonly playerMenuOpened = output<{ event: MouseEvent; playerId: string }>();
  readonly dropAllowed = output<DragEvent>();
  readonly playerDropped = output<{ event: DragEvent; playerId: string }>();
  readonly battlefieldSizeChanged = output<PlayerBattlefieldSize>();
  readonly concedeRequested = output<MouseEvent>();
  readonly isTopRow = computed(() => {
    const seat = this.playerSeat().seat;

    return seat === 'opponent-1' || (seat === 'opponent-2' && this.playerCount() > 2);
  });
  // Every seat keeps its pill mounted. On a turn change, the pill changes
  // state in place instead of the old active pill disappearing while a new
  // one is created in another battlefield.
  readonly turnStatus = computed<GridTurnStatus | null>(() => {
    const distance = this.turnDistance();
    const isActive = this.isTurnOwner();
    if (distance === null || (!isActive && this.playerCount() <= 2)) {
      return null;
    }

    return {
      distance,
      isActive,
      key: isActive ? 'active' : `upcoming-${distance}`,
      labelKey: distance === 1 ? 'shared.text.next' : 'game.playersOrder.upcomingTurnLabel',
    };
  });
  readonly reportSize = (rect: BattlefieldLayoutRect): void => {
    this.battlefieldSizeChanged.emit({ playerId: this.playerSeat().player.id, rect });
  };
  readonly playerPlaymatImageCss = computed(() => {
    const image = this.playmatImage()(this.playerSeat().player).trim();

    return image ? `url("${image}")` : 'none';
  });
  readonly isSinglePlayerRow = computed(() => {
    const playerCount = this.playerCount();

    return playerCount <= 2 || (playerCount === 3 && this.playerSeat().seat === 'current');
  });
  readonly isRightColumn = computed(() => {
    const seat = this.playerSeat().seat;

    return seat === 'opponent-2' || (this.playerCount() === 4 && seat === 'current');
  });
  readonly context = computed<PlayerRegionContext>(() => ({
    $implicit: this.playerSeat().player,
    grid: true,
    battlefieldVerticallyInverted: this.isTopRow(),
    isTurnOwner: this.isTurnOwner(),
    handPosition: this.isTopRow() ? 'top' : 'bottom',
    zoneCompact: !this.useSquareZonePresentation(),
    reportSize: this.reportSize,
  }));

  ngAfterViewInit(): void {
    const playerCell = this.host.nativeElement.querySelector<HTMLElement>('.player-cell');
    const playerGrid = this.host.nativeElement.closest<HTMLElement>('.player-grid');
    if (playerGrid && typeof ResizeObserver !== 'undefined') {
      this.layoutResizeObserver = new ResizeObserver(([entry]) => {
        if (entry) {
          this.syncZonePresentation(entry.contentRect.height);
        }
      });
      this.layoutResizeObserver.observe(playerGrid);
      this.syncZonePresentation(playerGrid.getBoundingClientRect().height);
    }

    const battlefield = this.host.nativeElement.querySelector<HTMLElement>('.player-cell-battlefield');
    if (!battlefield || typeof MutationObserver === 'undefined') {
      return;
    }

    this.battlefieldMutationObserver = new MutationObserver(() => this.scheduleSummaryCollisionCheck());
    this.battlefieldMutationObserver.observe(battlefield, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    this.scheduleSummaryCollisionCheck();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const turnStatusChanged = [changes['isTurnOwner'], changes['turnDistance']]
      .some((change) => change !== undefined && !change.firstChange);
    if (turnStatusChanged) {
      this.scheduleTurnStatusAnimation();
    }
  }

  ngDoCheck(): void {
    const fingerprint = this.currentBattlefieldLayoutFingerprint();
    const hasHandDragPreview = this.hasHandDragPreview();
    const handDragPreviewVisibilityChanged = hasHandDragPreview !== this.handDragPreviewVisible;
    this.handDragPreviewVisible = hasHandDragPreview;

    if (this.battlefieldLayoutFingerprint === null) {
      this.battlefieldLayoutFingerprint = fingerprint;
      return;
    }
    if (fingerprint === this.battlefieldLayoutFingerprint && !hasHandDragPreview && !handDragPreviewVisibilityChanged) {
      return;
    }

    this.battlefieldLayoutFingerprint = fingerprint;
    this.scheduleSummaryCollisionCheck();
  }

  ngOnDestroy(): void {
    this.battlefieldMutationObserver?.disconnect();
    this.battlefieldMutationObserver = null;
    this.layoutResizeObserver?.disconnect();
    this.layoutResizeObserver = null;
    if (this.collisionCheckFrame !== null) {
      window.cancelAnimationFrame(this.collisionCheckFrame);
      this.collisionCheckFrame = null;
    }
    if (this.turnStatusAnimationFrame !== null) {
      window.cancelAnimationFrame(this.turnStatusAnimationFrame);
      this.turnStatusAnimationFrame = null;
    }
    gsap.killTweensOf(this.turnStatusElements());
  }

  @HostListener('window:pointermove')
  syncSummaryWithHandDragPreview(): void {
    if (this.hasHandDragPreview()) {
      this.scheduleSummaryCollisionCheck();
    }
  }

  @HostListener('window:pointerup')
  syncSummaryAfterHandDragPreview(): void {
    this.scheduleSummaryCollisionCheck();
  }

  private currentBattlefieldLayoutFingerprint(): string {
    return this.playerSeat().player.state.zones.battlefield
      .map((card) => `${card.instanceId}:${card.position?.x ?? ''}:${card.position?.y ?? ''}:${card.position?.unit ?? ''}`)
      .join('|');
  }

  private syncZonePresentation(cellHeight: number): void {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const useSquarePresentation = cellHeight <= rootFontSize * 60;
    if (this.useSquareZonePresentation() !== useSquarePresentation) {
      this.ngZone.run(() => this.useSquareZonePresentation.set(useSquarePresentation));
    }
  }

  private scheduleTurnStatusAnimation(): void {
    if (this.prefersReducedMotion()) {
      return;
    }
    if (this.turnStatusAnimationFrame !== null) {
      window.cancelAnimationFrame(this.turnStatusAnimationFrame);
    }

    this.turnStatusAnimationFrame = window.requestAnimationFrame(() => {
      this.turnStatusAnimationFrame = null;
      const pill = this.host.nativeElement.querySelector<HTMLElement>('.player-cell-turn-status');
      const content = pill?.querySelector<HTMLElement>('.player-cell-turn-status-content');
      if (!pill || !content) {
        return;
      }

      this.ngZone.runOutsideAngular(() => {
        gsap.killTweensOf([pill, content]);
        gsap.timeline()
          .fromTo(
            pill,
            { filter: 'brightness(0.9) saturate(0.78)' },
            { filter: 'brightness(1.24) saturate(1.18)', duration: 0.14, ease: 'power2.out', yoyo: true, repeat: 1, clearProps: 'filter' },
          )
          .fromTo(
            content,
            { autoAlpha: 0, x: -10, y: 4, scale: 0.82, filter: 'blur(4px)' },
            {
              autoAlpha: 1,
              x: 0,
              y: 0,
              scale: 1,
              filter: 'blur(0px)',
              duration: 0.56,
              ease: 'back.out(1.6)',
              clearProps: 'transform,opacity,visibility,filter',
            },
            0,
          );
      });
    });
  }

  private turnStatusElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(
      '.player-cell-turn-status, .player-cell-turn-status-content',
    ));
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private scheduleSummaryCollisionCheck(): void {
    if (this.collisionCheckFrame !== null) {
      return;
    }

    this.collisionCheckFrame = window.requestAnimationFrame(() => {
      this.collisionCheckFrame = window.requestAnimationFrame(() => {
        this.collisionCheckFrame = null;
        this.syncSummaryModeWithBattlefieldOccupation();
      });
    });
  }

  private syncSummaryModeWithBattlefieldOccupation(): void {
    const summary = this.host.nativeElement.querySelector<HTMLElement>('.player-cell-summary');
    if (!summary) {
      return;
    }

    const protectedArea = this.summaryProtectedArea ?? this.expandRect(summary.getBoundingClientRect(), 16);
    const cards = this.host.nativeElement.querySelectorAll<HTMLElement>(
      '[data-testid="battlefield-zone"] [data-testid="game-card"]',
    );
    const nearbyCards = [
      ...Array.from(cards),
      ...this.handDragPreviewElements(),
    ];
    const hasNearbyCard = nearbyCards.some((card) =>
      this.rectanglesOverlap(protectedArea, card.getBoundingClientRect()),
    );

    if (hasNearbyCard) {
      this.summaryProtectedArea = protectedArea;
      this.summaryCompact.set(true);
      return;
    }

    this.summaryProtectedArea = null;
    this.summaryCompact.set(false);
  }

  private hasHandDragPreview(): boolean {
    return this.handDragPreviewElements().length > 0;
  }

  private handDragPreviewElements(): HTMLElement[] {
    if (typeof document === 'undefined') {
      return [];
    }

    return Array.from(document.querySelectorAll<HTMLElement>('.hand-floating-card'));
  }

  private expandRect(rect: DOMRect, padding: number): DOMRect {
    return new DOMRect(
      rect.left - padding,
      rect.top - padding,
      rect.width + padding * 2,
      rect.height + padding * 2,
    );
  }

  private rectanglesOverlap(left: DOMRect, right: DOMRect): boolean {
    return left.left < right.right
      && left.right > right.left
      && left.top < right.bottom
      && left.bottom > right.top;
  }
}
