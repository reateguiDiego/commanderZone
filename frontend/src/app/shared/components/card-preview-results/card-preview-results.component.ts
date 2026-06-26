import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, input, output, signal } from '@angular/core';
import { CardPreviewItem } from '../../../core/models/card-preview.model';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CardFaceImageComponent } from '../card-face-image/card-face-image.component';
import { CardFaceToggleButtonComponent } from '../card-face-toggle-button/card-face-toggle-button.component';
import { ManaIconComponent } from '../../mana/mana-icon/mana-icon.component';
import { ManaSymbolsComponent } from '../../mana/mana-symbols/mana-symbols.component';
import { CommonCardMenuAction, CommonCardMenuComponent } from '../../ui/common-card-menu/common-card-menu.component';
import { cardPreviewFaceSource, primaryCardPreviewTypeLabel, resolveCardPreviewTypeIcon } from '../../utils/card-preview-item';
import { cardFaceImage, hasAlternateCardFace } from '../../utils/card-faces';

type CardPreviewResultAction = 'details' | 'addToDeck' | 'rulings' | 'printings';
export type CardPreviewResultsViewMode = 'list' | 'spoiler';

export interface CardPreviewResultActionEvent {
  readonly action: CardPreviewResultAction;
  readonly item: CardPreviewItem;
}

interface CardPreviewResultMenuState {
  readonly item: CardPreviewItem;
  readonly top: number;
  readonly left: number;
}

interface CardPreviewHoverState {
  readonly item: CardPreviewItem;
  readonly imageUrl: string | null;
  readonly top: number;
  readonly left: number;
}

interface PendingCardPreviewHover {
  readonly item: CardPreviewItem;
  readonly clientX: number;
  readonly clientY: number;
}

const CARD_PREVIEW_RESULT_MENU_WIDTH_REM = 12;
const CARD_PREVIEW_RESULT_MENU_HEIGHT_REM = 10.5;
const HOVER_PREVIEW_WIDTH_PX = 360;
const HOVER_PREVIEW_HEIGHT_PX = 502;
const HOVER_PREVIEW_DELAY_MS = 180;

@Component({
  selector: 'app-card-preview-results',
  imports: [
    RuntimeTranslatePipe,
    CardFaceImageComponent,
    CardFaceToggleButtonComponent,
    ManaSymbolsComponent,
    ManaIconComponent,
    CommonCardMenuComponent,
  ],
  templateUrl: './card-preview-results.component.html',
  styleUrl: './card-preview-results.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardPreviewResultsComponent implements OnDestroy {
  readonly items = input.required<readonly CardPreviewItem[]>();
  readonly emptyLabel = input('community.preview.empty');
  readonly contextMenuEnabled = input(false);
  readonly showAddToDeckAction = input(false);
  readonly viewMode = input<CardPreviewResultsViewMode>('spoiler');
  readonly actionSelected = output<CardPreviewResultActionEvent>();
  readonly contextMenu = signal<CardPreviewResultMenuState | null>(null);
  readonly hoverPreview = signal<CardPreviewHoverState | null>(null);
  readonly flippedFaces = signal<Record<string, boolean>>({});
  readonly contextMenuActions: ReadonlyArray<CommonCardMenuAction<CardPreviewResultAction>> = [
    { id: 'details', label: 'deckBuilder.cards.cardSearch.actions.showDetails' },
    { id: 'addToDeck', label: 'deckBuilder.cards.cardSearch.actions.addToDeck' },
    { id: 'rulings', label: 'deckBuilder.cards.cardSearch.actions.showRulings' },
    { id: 'printings', label: 'deckBuilder.cards.cardSearch.actions.viewPrintings' },
  ];
  private hoverPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingHoverPreview: PendingCardPreviewHover | null = null;

  ngOnDestroy(): void {
    this.clearHoverPreviewTimer();
  }

  trackByItem(index: number, item: CardPreviewItem): string {
    return `${item.id}:${item.rank ?? index}`;
  }

  openContextMenu(event: MouseEvent, item: CardPreviewItem): void {
    if (!this.contextMenuEnabled()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.hideHoverPreview();

    const currentMenu = this.contextMenu();
    if (currentMenu?.item.id === item.id) {
      this.contextMenu.set(null);
      return;
    }

    this.contextMenu.set(this.contextMenuState(event.currentTarget, item));
  }

  openContextMenuFromKeyboard(event: KeyboardEvent, item: CardPreviewItem): void {
    if (!this.contextMenuEnabled() || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }

    event.preventDefault();
    this.openContextMenu(event as unknown as MouseEvent, item);
  }

  updateHoverSpotlight(event: MouseEvent): void {
    if (!this.contextMenuEnabled()) {
      return;
    }

    const currentTarget = event.currentTarget;
    if (!(currentTarget instanceof HTMLElement)) {
      return;
    }

    const rect = currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    currentTarget.style.setProperty('--hover-x', `${x}px`);
    currentTarget.style.setProperty('--hover-y', `${y}px`);
  }

  clearHoverSpotlight(event: MouseEvent): void {
    const currentTarget = event.currentTarget;
    if (!(currentTarget instanceof HTMLElement)) {
      return;
    }

    currentTarget.style.removeProperty('--hover-x');
    currentTarget.style.removeProperty('--hover-y');
  }

  image(item: CardPreviewItem): string | null {
    return cardFaceImage(this.faceSource(item), this.isFaceFlipped(item));
  }

  actionsFor(item: CardPreviewItem): ReadonlyArray<CommonCardMenuAction<CardPreviewResultAction>> {
    const hasScryfallId = item.scryfallId.trim() !== '';

    return this.contextMenuActions
      .filter((action) => this.showAddToDeckAction() || action.id !== 'addToDeck')
      .map((action) => (
      action.id === 'details' || action.id === 'printings' || action.id === 'addToDeck'
        ? { ...action, disabled: !hasScryfallId }
        : action
      ));
  }

  resolveTypeIcon(item: CardPreviewItem): string | null {
    return resolveCardPreviewTypeIcon(item);
  }

  faceSource(item: CardPreviewItem) {
    return cardPreviewFaceSource(item);
  }

  isBattle(item: CardPreviewItem): boolean {
    return this.itemTypeLine(item).startsWith('battle');
  }

  hasAlternateFace(item: CardPreviewItem): boolean {
    return hasAlternateCardFace(this.faceSource(item));
  }

  handleFaceFlipped(item: CardPreviewItem, flipped: boolean): void {
    this.flippedFaces.update((state) => ({
      ...state,
      [item.id]: flipped,
    }));
  }

  formatTimesPlayed(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? new Intl.NumberFormat().format(Math.trunc(value))
      : '';
  }

  showHoverPreview(event: MouseEvent, item: CardPreviewItem): void {
    if (this.viewMode() !== 'list' || this.contextMenu()) {
      return;
    }

    this.scheduleHoverPreview(event, item);
  }

  moveHoverPreview(event: MouseEvent, item: CardPreviewItem): void {
    if (this.contextMenu()) {
      return;
    }

    if (this.hoverPreview()) {
      this.updateHoverPreview(event.clientX, event.clientY, item);
      return;
    }

    if (this.pendingHoverPreview?.item.id === item.id) {
      this.pendingHoverPreview = this.pendingPreviewFromEvent(event, item);
    }
  }

  hideHoverPreview(): void {
    this.clearHoverPreviewTimer();
    this.pendingHoverPreview = null;
    this.hoverPreview.set(null);
  }

  selectMenuAction(action: CardPreviewResultAction, item: CardPreviewItem): void {
    this.contextMenu.set(null);
    this.actionSelected.emit({ action, item });
  }

  @HostListener('document:pointerdown', ['$event'])
  handleDocumentPointerDown(event: PointerEvent): void {
    this.hideHoverPreview();

    const currentMenu = this.contextMenu();
    if (!currentMenu) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      this.contextMenu.set(null);
      return;
    }

    if (target.closest('app-common-card-menu') || target.closest('.card-preview-result--interactive')) {
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

  private contextMenuState(source: EventTarget | null, item: CardPreviewItem): CardPreviewResultMenuState {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const sourceElement = source instanceof HTMLElement ? source : null;
    const sourceRect = sourceElement?.getBoundingClientRect();
    const menuWidth = CARD_PREVIEW_RESULT_MENU_WIDTH_REM * rootFontSize;
    const menuHeight = CARD_PREVIEW_RESULT_MENU_HEIGHT_REM * rootFontSize;
    const sourceCenterX = sourceRect ? sourceRect.left + (sourceRect.width / 2) : window.innerWidth / 2;
    const sourceCenterY = sourceRect ? sourceRect.top + (sourceRect.height / 2) : window.innerHeight / 2;
    const margin = 12;

    return {
      item,
      left: Math.max(margin, Math.min(sourceCenterX - (menuWidth / 2), window.innerWidth - menuWidth - margin)),
      top: Math.max(margin, Math.min(sourceCenterY - (menuHeight / 2), window.innerHeight - menuHeight - margin)),
    };
  }

  private scheduleHoverPreview(event: MouseEvent, item: CardPreviewItem): void {
    this.pendingHoverPreview = this.pendingPreviewFromEvent(event, item);
    this.clearHoverPreviewTimer();
    this.hoverPreviewTimer = setTimeout(() => {
      const pending = this.pendingHoverPreview;
      this.hoverPreviewTimer = null;
      if (!pending || this.viewMode() !== 'list' || this.contextMenu()) {
        return;
      }

      this.updateHoverPreview(pending.clientX, pending.clientY, pending.item);
    }, HOVER_PREVIEW_DELAY_MS);
  }

  private updateHoverPreview(clientX: number, clientY: number, item: CardPreviewItem): void {
    const imageUrl = this.image(item);
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
      item,
      imageUrl,
      left: Math.max(margin, Math.min(left, window.innerWidth - previewWidth - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - previewHeight - margin)),
    });
  }

  private pendingPreviewFromEvent(event: MouseEvent, item: CardPreviewItem): PendingCardPreviewHover {
    return {
      item,
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

  private itemTypeLine(item: CardPreviewItem): string {
    const faceIndex = this.isFaceFlipped(item) ? 1 : 0;
    const faceTypeLine = item.cardFaces?.[faceIndex]?.typeLine?.trim().toLowerCase();
    if (faceTypeLine) {
      return faceTypeLine;
    }

    return primaryCardPreviewTypeLabel(item)?.trim().toLowerCase() ?? '';
  }

  private isFaceFlipped(item: CardPreviewItem): boolean {
    return this.flippedFaces()[item.id] ?? false;
  }
}
