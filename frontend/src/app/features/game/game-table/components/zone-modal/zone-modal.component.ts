import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { DOCUMENT } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { BodyScrollLockService } from '../../../../../shared/services/body-scroll-lock.service';
import { CardSpoilerGridComponent, CardSpoilerKeyboardInteraction, CardSpoilerPointerInteraction } from '../card-spoiler-grid/card-spoiler-grid.component';
import { ZoneModalState } from '../../state/zones/game-table-zone-modal.state';
import { LibrarySelectionBatchAction, LibrarySelectionBatchRequest, LibraryTopFaceDownRequest } from '../../state/zones/library-batch-action.model';
import {
  clearViewXSelection,
  emptyViewXSelection,
  focusViewXCard,
  reconcileViewXSelection,
  selectAllViewXCards,
  selectViewXRange,
  toggleViewXSelection,
} from './view-x-selection.model';

type ZoneModalInteractionMode = 'select' | 'reorder';
type LibraryBatchConfirmation =
  | { kind: 'selection'; action: LibrarySelectionBatchAction; orderedInstanceIds: readonly string[] }
  | { kind: 'top-face-down'; count: number };

@Component({
  selector: 'app-zone-modal',
  imports: [RuntimeTranslatePipe, FormsModule, LucideAngularModule, CardSpoilerGridComponent],
  templateUrl: './zone-modal.component.html',
  styleUrl: './zone-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLElement>;
  @ViewChild('confirmationDialog') private confirmationDialogRef?: ElementRef<HTMLElement>;
  @ViewChild(CardSpoilerGridComponent) private cardGrid?: CardSpoilerGridComponent;

  private readonly bodyScrollLock = inject(BodyScrollLockService);
  private readonly documentRef = inject(DOCUMENT);
  private searchDebounceHandle?: number;
  private readonly searchDebounceMs = 250;
  private returnFocusTarget: HTMLElement | null = null;
  private initiallyFocusedRevision: string | null = null;
  private confirmationTrigger: HTMLElement | null = null;

  readonly modal = input.required<ZoneModalState>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();

  readonly close = output<void>();
  readonly filterChanged = output<Partial<Pick<ZoneModalState, 'type' | 'search'>>>();
  readonly cardSelected = output<GameCardInstance>();
  readonly cardsReordered = output<readonly GameCardInstance[]>();
  readonly cardMenuOpened = output<{ event: MouseEvent; card: GameCardInstance }>();
  readonly selectionBatchRequested = output<LibrarySelectionBatchRequest>();
  readonly topFaceDownRequested = output<LibraryTopFaceDownRequest>();
  readonly selection = signal(emptyViewXSelection());
  readonly interactionMode = signal<ZoneModalInteractionMode>('select');
  readonly selectedCount = computed(() => this.selection().selectionOrder.length);
  readonly selectedIds = computed(() => [...this.selection().selectedIds]);
  readonly confirmation = signal<LibraryBatchConfirmation | null>(null);
  readonly selectionEnabled = computed(() => {
    const modal = this.modal();
    return modal.localMultiSelect && modal.lifecycle === 'ready' && this.interactionMode() === 'select';
  });

  constructor() {
    effect(() => {
      const modal = this.modal();
      const visibleIds = modal.localMultiSelect && modal.lifecycle === 'ready'
        ? modal.cards.map((card) => card.instanceId)
        : [];
      const current = untracked(this.selection);
      this.selection.set(reconcileViewXSelection(current, visibleIds, modal.selectionRevision));
      if (!modal.allowReorder && untracked(this.interactionMode) === 'reorder') {
        this.interactionMode.set('select');
      }
      if (modal.lifecycle === 'ready' && this.initiallyFocusedRevision !== modal.selectionRevision) {
        this.initiallyFocusedRevision = modal.selectionRevision;
        queueMicrotask(() => {
          const currentModal = this.modal();
          if (currentModal.lifecycle === 'ready' && currentModal.selectionRevision === modal.selectionRevision) {
            this.focusInitialTarget();
          }
        });
      }
      if (modal.lifecycle === 'stale' || modal.lifecycle === 'error') {
        queueMicrotask(() => this.focusCloseButton());
      }
    });
  }

  ngOnInit(): void {
    const activeElement = this.documentRef.activeElement;
    this.returnFocusTarget = activeElement instanceof HTMLElement
      && activeElement !== this.documentRef.body
      && activeElement !== this.documentRef.documentElement
      ? activeElement
      : null;
    this.bodyScrollLock.lock();
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.focusInitialTarget());
  }

  ngOnDestroy(): void {
    if (this.searchDebounceHandle !== undefined) {
      window.clearTimeout(this.searchDebounceHandle);
    }
    this.bodyScrollLock.unlock();
    const fallbackTarget = this.returnFocusFallback();
    queueMicrotask(() => {
      if (this.returnFocusTarget?.isConnected) {
        this.returnFocusTarget.focus({ preventScroll: true });
        if (this.documentRef.activeElement === this.returnFocusTarget) {
          return;
        }
      }
      fallbackTarget?.focus({ preventScroll: true });
    });
  }

  stopClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  handleBackdropClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.confirmation()) {
        this.cancelConfirmation();
        return;
      }
      this.close.emit();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const focusable = this.focusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      this.dialogRef?.nativeElement.focus();
      return;
    }
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = this.documentRef.activeElement;
    if (event.shiftKey && (active === first || active === this.dialogRef?.nativeElement)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  handleCardInteraction(interaction: CardSpoilerPointerInteraction): void {
    if (!this.selectionEnabled()) {
      return;
    }

    const visibleIds = this.visibleIds();
    this.selection.update((state) => interaction.event.shiftKey
      ? selectViewXRange(state, interaction.card.instanceId, visibleIds, 'pointer')
      : toggleViewXSelection(state, interaction.card.instanceId, visibleIds, 'pointer'));
  }

  handleCardKey(interaction: CardSpoilerKeyboardInteraction): void {
    if (!this.selectionEnabled()) {
      return;
    }

    if (interaction.event.key === ' ') {
      this.selection.update((state) => interaction.event.shiftKey
        ? selectViewXRange(state, interaction.card.instanceId, this.visibleIds(), 'keyboard')
        : toggleViewXSelection(state, interaction.card.instanceId, this.visibleIds(), 'keyboard'));
      this.cardSelected.emit(interaction.card);
      return;
    }
    if (interaction.event.key === 'Enter') {
      this.cardSelected.emit(interaction.card);
    }
  }

  handleCardFocused(card: GameCardInstance): void {
    if (!this.modal().localMultiSelect) {
      return;
    }
    this.selection.update((state) => focusViewXCard(state, card.instanceId, this.visibleIds()));
  }

  selectAll(): void {
    if (!this.selectionEnabled()) {
      return;
    }
    this.selection.update((state) => selectAllViewXCards(state, this.visibleIds()));
  }

  clearAll(): void {
    this.selection.update(clearViewXSelection);
  }

  handleBatchActionFocus(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || typeof target.scrollIntoView !== 'function') {
      return;
    }
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  requestSelectionAction(event: Event, action: LibrarySelectionBatchAction): void {
    if (!this.selectionEnabled() || this.modal().mutationPending || this.selection().selectionOrder.length === 0) {
      return;
    }
    this.confirmationTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.confirmation.set({ kind: 'selection', action, orderedInstanceIds: [...this.selection().selectionOrder] });
    queueMicrotask(() => this.focusConfirmation());
  }

  requestTopFaceDown(event: Event): void {
    const modal = this.modal();
    if (!this.selectionEnabled() || modal.mutationPending || modal.cards.length === 0) {
      return;
    }
    this.confirmationTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.confirmation.set({ kind: 'top-face-down', count: modal.viewTopCount ?? modal.cards.length });
    queueMicrotask(() => this.focusConfirmation());
  }

  confirmBatchAction(): void {
    const confirmation = this.confirmation();
    if (!confirmation || this.modal().mutationPending) {
      return;
    }
    this.confirmation.set(null);
    if (confirmation.kind === 'selection') {
      this.selectionBatchRequested.emit({ action: confirmation.action, orderedInstanceIds: confirmation.orderedInstanceIds });
    } else {
      this.topFaceDownRequested.emit({ count: confirmation.count });
    }
  }

  cancelConfirmation(): void {
    this.confirmation.set(null);
    const target = this.confirmationTrigger;
    this.confirmationTrigger = null;
    queueMicrotask(() => target?.isConnected && target.focus({ preventScroll: true }));
  }

  confirmationActionKey(confirmation: LibraryBatchConfirmation): string {
    return confirmation.kind === 'top-face-down'
      ? 'game.zoneModal.action.playTopFaceDown'
      : `game.zoneModal.action.${confirmation.action}`;
  }

  toggleInteractionMode(): void {
    if (!this.modal().allowReorder) {
      return;
    }
    const nextMode: ZoneModalInteractionMode = this.interactionMode() === 'select' ? 'reorder' : 'select';
    this.interactionMode.set(nextMode);
    this.selection.update(clearViewXSelection);
    queueMicrotask(() => this.cardGrid?.focusCardById(this.modal().cards[0]?.instanceId ?? null));
  }

  updateType(type: string): void {
    this.filterChanged.emit({ type });
  }

  updateSearch(search: string): void {
    if (this.searchDebounceHandle !== undefined) {
      window.clearTimeout(this.searchDebounceHandle);
    }

    this.searchDebounceHandle = window.setTimeout(() => {
      this.searchDebounceHandle = undefined;
      this.filterChanged.emit({ search });
    }, this.searchDebounceMs);
  }

  private visibleIds(): string[] {
    return this.modal().cards.map((card) => card.instanceId);
  }

  private focusInitialTarget(): void {
    const modal = this.modal();
    if (modal.lifecycle === 'ready' && modal.cards.length > 0 && this.cardGrid?.focusCardById(modal.cards[0]?.instanceId ?? null)) {
      return;
    }
    this.focusCloseButton();
  }

  private focusCloseButton(): void {
    this.dialogRef?.nativeElement.querySelector<HTMLElement>('[data-testid="zone-modal-close"]')?.focus({ preventScroll: true });
  }

  private focusableElements(): HTMLElement[] {
    const dialog = this.confirmationDialogRef?.nativeElement ?? this.dialogRef?.nativeElement;
    if (!dialog) {
      return [];
    }

    return Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null);
  }

  private focusConfirmation(): void {
    this.confirmationDialogRef?.nativeElement.querySelector<HTMLElement>('[data-testid="zone-modal-batch-cancel"]')?.focus({ preventScroll: true });
  }

  private returnFocusFallback(): HTMLElement | null {
    const modal = this.modal();
    const libraryTargets = Array.from(this.documentRef.querySelectorAll<HTMLElement>(
      `[data-testid="drop-zone"][data-player-id="${this.escapeAttribute(modal.playerId)}"][data-zone="library"]`,
    ));
    return libraryTargets.find((element) => element.offsetParent !== null)
      ?? this.documentRef.querySelector<HTMLElement>('[data-testid="game-screen"]');
  }

  private escapeAttribute(value: string): string {
    return value.replace(/["\\]/g, '\\$&');
  }
}
