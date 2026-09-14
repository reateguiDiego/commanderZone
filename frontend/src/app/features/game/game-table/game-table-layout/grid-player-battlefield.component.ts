import { NgTemplateOutlet } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { PlayerSummaryPanelComponent } from '../components/player-summary-panel/player-summary-panel.component';
import type {
  BattlefieldLayoutRect,
  GridPlayerCount,
  GridPlayerSummaryBindings,
  GridSeat,
  PlayerBattlefieldSize,
  PlayerRegionContext,
  PlayerRegionTemplates,
} from './game-table-grid-seat.model';

@Component({
  selector: 'app-grid-player-battlefield',
  imports: [NgTemplateOutlet, PlayerSummaryPanelComponent, RuntimeTranslatePipe],
  templateUrl: './grid-player-battlefield.component.html',
  styleUrl: './grid-player-battlefield.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridPlayerBattlefieldComponent implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private battlefieldLayoutFingerprint: string | null = null;
  private collisionCheckFrame: number | null = null;
  private battlefieldMutationObserver: MutationObserver | null = null;
  private summaryProtectedArea: DOMRect | null = null;
  private handDragPreviewVisible = false;

  readonly playerSeat = input.required<GridSeat>();
  readonly playerCount = input.required<GridPlayerCount>();
  readonly regions = input.required<PlayerRegionTemplates>();
  readonly summaryBindings = input.required<GridPlayerSummaryBindings>();
  readonly isPlayerDropHighlighted = input<(playerId: string) => boolean>(() => false);
  readonly summaryCompact = signal(false);
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
  readonly isTopRow = computed(() => {
    const seat = this.playerSeat().seat;

    return seat === 'opponent-1' || (seat === 'opponent-2' && this.playerCount() > 2);
  });
  readonly showTurnStatusPill = computed(() =>
    this.isTurnOwner() || (this.playerCount() > 2 && this.turnDistance() !== null),
  );
  readonly reportSize = (rect: BattlefieldLayoutRect): void => {
    this.battlefieldSizeChanged.emit({ playerId: this.playerSeat().player.id, rect });
  };
  readonly context = computed<PlayerRegionContext>(() => ({
    $implicit: this.playerSeat().player,
    grid: true,
    battlefieldVerticallyInverted: this.isTopRow(),
    isTurnOwner: this.isTurnOwner(),
    handPosition: this.isTopRow() ? 'top' : 'bottom',
    reportSize: this.reportSize,
  }));

  ngAfterViewInit(): void {
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
    if (this.collisionCheckFrame !== null) {
      window.cancelAnimationFrame(this.collisionCheckFrame);
      this.collisionCheckFrame = null;
    }
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
