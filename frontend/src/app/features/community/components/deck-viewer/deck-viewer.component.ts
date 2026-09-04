import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  PLATFORM_ID,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { Card } from '../../../../core/models/card.model';
import { Deck } from '../../../../core/models/deck.model';
import { DeckEditorViewMode } from '../../../decks/models/deck-editor.models';
import { DeckCardSpoilerViewComponent } from '../../../decks/deck-editor/deck-card-spoiler-view/deck-card-spoiler-view.component';
import { DeckCardTextViewComponent } from '../../../decks/deck-editor/deck-card-text-view/deck-card-text-view.component';
import {
  CommunityDeckCardAction,
  CommunityDeckCardActionEvent,
  CommunityDeckViewerStore,
} from './community-deck-viewer.store';
import { CommonCardMenuComponent } from '../../../../shared/ui/common-card-menu/common-card-menu.component';
import { DeviceProfileService } from '../../../../shared/services/device-profile.service';
import { CardFaceImageComponent } from '../../../../shared/components/card-face-image/card-face-image.component';
import { DeckBracketEstimate } from '../../../../core/models/deck-analysis.model';
import { BracketPillComponent } from '../../../../shared/ui/bracket-pill/bracket-pill.component';
import { DeckViewModeSelectComponent } from '../../../decks/deck-editor/deck-view-mode-select/deck-view-mode-select.component';

const COMMUNITY_DECK_VIEWER_SESSION_KEY = 'community.deckViewer.viewMode';

@Component({
  selector: 'app-deck-viewer',
  imports: [
    RuntimeTranslatePipe,
    BracketPillComponent,
    DeckCardTextViewComponent,
    DeckCardSpoilerViewComponent,
    DeckViewModeSelectComponent,
    CommonCardMenuComponent,
    CardFaceImageComponent,
  ],
  templateUrl: './deck-viewer.component.html',
  styleUrl: './deck-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckViewerComponent {
  readonly deck = input.required<Deck>();
  readonly bracket = input<DeckBracketEstimate | null>(null);
  readonly cardActionsEnabled = input(true);
  readonly cardActionSelected = output<CommunityDeckCardActionEvent>();
  readonly store = inject(CommunityDeckViewerStore);
  private readonly device = inject(DeviceProfileService);
  private readonly documentRef = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly viewMode = signal<DeckEditorViewMode>(this.resolveInitialViewMode());

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.store.closeContextMenu();
  }

  @HostListener('document:pointerdown', ['$event'])
  handleDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      this.store.closeContextMenu();
      return;
    }

    if (
      target.closest('app-common-card-menu') ||
      target.closest('.deck-card-row') ||
      target.closest('.spoiler-card')
    ) {
      return;
    }

    this.store.closeContextMenu();
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  closeContextMenuOnViewportChange(): void {
    this.store.closeContextMenu();
  }

  @HostListener('document:keydown.escape')
  closeContextMenuFromKeyboard(): void {
    this.store.closeContextMenu();
  }

  selectViewMode(value: DeckEditorViewMode): void {
    this.viewMode.set(value);
    this.rememberViewMode(value);
  }

  isBattlePreviewCard(card: Card): boolean {
    return (this.store.displayCardTypeLine(card) ?? '').trim().toLowerCase().startsWith('battle');
  }

  handleContextAction(action: CommunityDeckCardAction): void {
    if (!this.cardActionsEnabled()) {
      this.store.closeContextMenu();
      return;
    }

    const menu = this.store.contextMenu();
    if (!menu) {
      return;
    }

    this.store.closeContextMenu();
    this.cardActionSelected.emit({ action, card: menu.card });
  }

  private resolveInitialViewMode(): DeckEditorViewMode {
    const remembered = this.readRememberedViewMode();
    if (remembered) {
      return remembered;
    }

    return this.shouldDefaultToSpoilerView() ? 'spoiler' : 'text';
  }

  private shouldDefaultToSpoilerView(): boolean {
    return !this.device.hasHover() && !this.device.isDesktopLayout();
  }

  private readRememberedViewMode(): DeckEditorViewMode | null {
    const storage = this.sessionStorage();
    const storedValue = storage?.getItem(COMMUNITY_DECK_VIEWER_SESSION_KEY);

    return storedValue === 'text' || storedValue === 'spoiler' ? storedValue : null;
  }

  private rememberViewMode(value: DeckEditorViewMode): void {
    this.sessionStorage()?.setItem(COMMUNITY_DECK_VIEWER_SESSION_KEY, value);
  }

  private sessionStorage(): Storage | null {
    if (!this.isBrowser) {
      return null;
    }

    return this.documentRef.defaultView?.sessionStorage ?? null;
  }
}
