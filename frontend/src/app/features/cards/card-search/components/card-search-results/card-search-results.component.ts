import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, input, signal } from '@angular/core';
import { Card } from '../../../../../core/models/card.model';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { bestCardImage } from '../../../../../shared/utils/card-image';
import { CardSearchViewMode } from '../../card-search.models';

interface CardContextMenuState {
  readonly card: Card;
  readonly top: number;
  readonly left: number;
}

interface CardHoverPreviewState {
  readonly card: Card;
  readonly imageUrl: string | null;
  readonly top: number;
  readonly left: number;
}

interface PendingCardHoverPreview {
  readonly card: Card;
  readonly clientX: number;
  readonly clientY: number;
}

const HOVER_PREVIEW_WIDTH_PX = 360;
const HOVER_PREVIEW_HEIGHT_PX = 502;
const HOVER_PREVIEW_DELAY_MS = 180;

@Component({
  selector: 'app-card-search-results',
  imports: [RuntimeTranslatePipe],
  templateUrl: './card-search-results.component.html',
  styleUrl: './card-search-results.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearchResultsComponent implements OnDestroy {
  readonly results = input.required<readonly Card[]>();
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly searched = input(false);
  readonly viewMode = input<CardSearchViewMode>('list');
  readonly contextMenu = signal<CardContextMenuState | null>(null);
  readonly hoverPreview = signal<CardHoverPreviewState | null>(null);
  private hoverPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingHoverPreview: PendingCardHoverPreview | null = null;

  ngOnDestroy(): void {
    this.clearHoverPreviewTimer();
  }

  image(card: Card): string | null {
    return bestCardImage(card);
  }

  isBattleCard(card: Card): boolean {
    return this.cardTypeLine(card).startsWith('battle');
  }

  openContextMenu(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    this.hideHoverPreview();

    const currentMenu = this.contextMenu();
    if (currentMenu?.card.scryfallId === card.scryfallId) {
      this.contextMenu.set(null);
      return;
    }

    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const sourceElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const sourceRect = sourceElement?.getBoundingClientRect();
    const menuWidth = 12 * rootFontSize;
    const menuHeight = 3.5 * rootFontSize;
    const sourceCenterX = sourceRect ? sourceRect.left + (sourceRect.width / 2) : event.clientX;
    const sourceCenterY = sourceRect ? sourceRect.top + (sourceRect.height / 2) : event.clientY;
    const margin = 12;

    this.contextMenu.set({
      card,
      left: Math.max(margin, Math.min(sourceCenterX - (menuWidth / 2), window.innerWidth - menuWidth - margin)),
      top: Math.max(margin, Math.min(sourceCenterY - (menuHeight / 2), window.innerHeight - menuHeight - margin)),
    });
  }

  showHoverPreview(event: MouseEvent, card: Card): void {
    if (this.viewMode() !== 'list' || this.contextMenu()) {
      return;
    }

    this.scheduleHoverPreview(event, card);
  }

  moveHoverPreview(event: MouseEvent, card: Card): void {
    if (this.contextMenu()) {
      return;
    }

    if (this.hoverPreview()) {
      this.updateHoverPreview(event.clientX, event.clientY, card);
      return;
    }

    if (this.pendingHoverPreview?.card.scryfallId === card.scryfallId) {
      this.pendingHoverPreview = this.pendingPreviewFromEvent(event, card);
    }
  }

  hideHoverPreview(): void {
    this.clearHoverPreviewTimer();
    this.pendingHoverPreview = null;
    this.hoverPreview.set(null);
  }

  selectTodo(event: MouseEvent): void {
    event.stopPropagation();
    this.contextMenu.set(null);
  }

  @HostListener('document:pointerdown', ['$event'])
  handleDocumentPointerDown(event: PointerEvent): void {
    this.hideHoverPreview();

    if (!this.contextMenu()) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      this.contextMenu.set(null);
      return;
    }

    if (target.closest('.card-result-context-menu') || target.closest('.mtg-card-result')) {
      return;
    }

    this.contextMenu.set(null);
  }

  @HostListener('document:click')
  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  @HostListener('window:scroll')
  @HostListener('document:scroll')
  closeContextMenuFromScroll(): void {
    this.contextMenu.set(null);
    this.hideHoverPreview();
  }

  @HostListener('document:keydown.escape')
  closeContextMenuFromKeyboard(): void {
    this.contextMenu.set(null);
  }

  private scheduleHoverPreview(event: MouseEvent, card: Card): void {
    this.pendingHoverPreview = this.pendingPreviewFromEvent(event, card);
    this.clearHoverPreviewTimer();
    this.hoverPreviewTimer = setTimeout(() => {
      const pending = this.pendingHoverPreview;
      this.hoverPreviewTimer = null;
      if (!pending || this.viewMode() !== 'list' || this.contextMenu()) {
        return;
      }

      this.updateHoverPreview(pending.clientX, pending.clientY, pending.card);
    }, HOVER_PREVIEW_DELAY_MS);
  }

  private updateHoverPreview(clientX: number, clientY: number, card: Card): void {
    const imageUrl = this.image(card);
    const previewWidth = HOVER_PREVIEW_WIDTH_PX;
    const previewHeight = HOVER_PREVIEW_HEIGHT_PX;
    const margin = 12;
    const gap = 18;
    const preferRight = clientX + gap + previewWidth <= window.innerWidth - margin;
    const left = preferRight
      ? clientX + gap
      : clientX - previewWidth - gap;
    const top = clientY - (previewHeight / 2);

    this.hoverPreview.set({
      card,
      imageUrl,
      left: Math.max(margin, Math.min(left, window.innerWidth - previewWidth - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - previewHeight - margin)),
    });
  }

  private pendingPreviewFromEvent(event: MouseEvent, card: Card): PendingCardHoverPreview {
    return {
      card,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }

  private clearHoverPreviewTimer(): void {
    if (this.hoverPreviewTimer === null) {
      return;
    }

    clearTimeout(this.hoverPreviewTimer);
    this.hoverPreviewTimer = null;
  }

  private cardTypeLine(card: Card): string {
    const faceTypeLine = card.cardFaces?.[0]?.typeLine?.trim().toLowerCase();
    if (faceTypeLine) {
      return faceTypeLine;
    }

    return card.typeLine?.trim().toLowerCase() ?? '';
  }
}
