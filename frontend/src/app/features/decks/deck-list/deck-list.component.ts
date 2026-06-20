import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { type DeckVisibility } from '../../../core/models/deck.model';
import { CardAutocompleteComponent } from '../../../shared/components/card-autocomplete/card-autocomplete.component';
import { VisibilityChoiceComponent } from '../../../shared/components/visibility-choice/visibility-choice.component';
import { FormatSelectComponent, type FormatSelectOption } from '../../../shared/components/format-select/format-select.component';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { Card } from '../../../core/models/card.model';
import { type DeckListColorFilter, type DeckListSortMode, DeckListStore } from '../data-access/deck-list.store';
import { DeckListCardComponent } from './components/deck-list-card/deck-list-card.component';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { CompactCheckboxComponent } from '../../../shared/ui/compact-checkbox/compact-checkbox.component';

interface CommanderHoverPreview {
  imageUrl: string;
  x: number;
  y: number;
}

@Component({
  selector: 'app-deck-list',
  imports: [
    RuntimeTranslatePipe,
    FormsModule,
    LucideAngularModule,
    AppModalComponent,
    CardAutocompleteComponent,
    PrettyScrollDirective,
    VisibilityChoiceComponent,
    FormatSelectComponent,
    ManaSymbolsComponent,
    DeckListCardComponent,
    CzButtonDirective,
    CompactCheckboxComponent,
  ],
  templateUrl: './deck-list.component.html',
  styleUrl: './deck-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DeckListStore],
})
export class DeckListComponent implements OnInit, OnDestroy {
  readonly store = inject(DeckListStore);
  private readonly route = inject(ActivatedRoute);
  readonly commanderHoverPreview = signal<CommanderHoverPreview | null>(null);
  readonly searchPanelOpen = signal(false);
  readonly colorFilterOptions = computed<readonly FormatSelectOption[]>(() =>
    this.store.colorFilterOptions.map((option) => ({ id: option.value, labelKey: option.labelKey })),
  );
  readonly sortModeOptions: readonly FormatSelectOption[] = [
    { id: 'name-asc', labelKey: 'deckBuilder.deckList.sortMode.nameAsc' },
    { id: 'name-desc', labelKey: 'deckBuilder.deckList.sortMode.nameDesc' },
  ];
  readonly folderOptions = computed<readonly FormatSelectOption[]>(() => [
    { id: '', labelKey: 'deckBuilder.deckList.noFolder' },
    ...this.store.folders().map((folder) => ({ id: folder.id, name: folder.name })),
  ]);
  readonly importDecklistDisclaimerKey = computed(() => (
    this.store.selectedCommanders().length === 2
      ? 'deckBuilder.deckList.ifYouIncludeYourCommandersInThe'
      : 'deckBuilder.deckList.ifYouIncludeYourCommanderInThe'
  ));

  private commanderHoverTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCommanderPreview: CommanderHoverPreview | null = null;

  ngOnInit(): void {
    this.openRequestedCreateIntent();
  }

  ngOnDestroy(): void {
    this.clearCommanderHoverTimer();
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('.commander-preview-body')) {
      return;
    }

    this.hideCommanderPreview();
  }

  visibilityIcon(visibility: DeckVisibility | undefined): 'globe' | 'lock' {
    return visibility === 'public' ? 'globe' : 'lock';
  }

  visibilityLabelKey(visibility: DeckVisibility | undefined): string {
    return visibility === 'public'
      ? 'common.visibility.visibilityChoice.public'
      : 'common.visibility.visibilityChoice.private';
  }

  setColorFilter(value: string): void {
    if (this.isDeckListColorFilter(value)) {
      this.store.setColorFilter(value);
    }
  }

  setSortMode(value: string): void {
    if (this.isDeckListSortMode(value)) {
      this.store.setSortMode(value);
    }
  }

  setNewDeckFolder(value: string): void {
    this.store.newDeckFolderId = value;
  }

  toggleSearchPanel(searchInput: HTMLInputElement): void {
    const shouldOpen = !this.searchPanelOpen();
    this.searchPanelOpen.set(shouldOpen);

    if (shouldOpen) {
      setTimeout(() => searchInput.focus(), 0);
    }
  }

  suppressRowActionPointer(event: PointerEvent): void {
    event.stopPropagation();
  }

  suppressRowActionMouseDown(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  suppressRowActionClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      target.blur();
    }
  }

  scheduleCommanderPreview(event: MouseEvent, imageUrl: string): void {
    this.pendingCommanderPreview = { imageUrl, ...this.previewPosition(event.currentTarget) };
    this.clearCommanderHoverTimer();
    this.commanderHoverTimer = setTimeout(() => {
      if (this.pendingCommanderPreview) {
        this.commanderHoverPreview.set(this.pendingCommanderPreview);
      }
      this.commanderHoverTimer = null;
    }, 260);
  }

  scheduleCommanderCardPreview(event: MouseEvent, commander: Card): void {
    const imageUrl = this.store.selectedCommanderImage(commander);
    if (!imageUrl) {
      return;
    }

    this.scheduleCommanderPreview(event, imageUrl);
  }

  moveCommanderPreview(event: MouseEvent): void {
    const anchorPosition = this.previewPosition(event.currentTarget);
    const current = this.commanderHoverPreview();
    if (current) {
      this.commanderHoverPreview.set({ ...current, ...anchorPosition });
      return;
    }

    if (this.pendingCommanderPreview) {
      this.pendingCommanderPreview = {
        imageUrl: this.pendingCommanderPreview.imageUrl,
        ...anchorPosition,
      };
    }
  }

  hideCommanderPreview(): void {
    this.clearCommanderHoverTimer();
    this.pendingCommanderPreview = null;
    this.commanderHoverPreview.set(null);
  }

  removeCommander(commanderScryfallId: string): void {
    this.hideCommanderPreview();
    this.store.removeCommander(commanderScryfallId);
  }

  private previewPosition(target: EventTarget | null): { x: number; y: number } {
    const margin = 12;
    const previewWidth = 288;
    const previewHeight = 402;
    const anchor = this.previewAnchorElement(target);
    if (!anchor) {
      return { x: margin, y: margin };
    }

    const rect = anchor.getBoundingClientRect();
    const anchorCenterX = rect.left + (rect.width / 2);
    const anchorCenterY = rect.top + (rect.height / 2);
    let x = anchorCenterX - previewWidth - 24;
    let y = anchorCenterY - (previewHeight / 2);

    if (x < margin) {
      x = anchorCenterX + 24;
    }

    return {
      x: Math.max(margin, Math.min(x, window.innerWidth - previewWidth - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - previewHeight - margin)),
    };
  }

  private previewAnchorElement(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    if (target.classList.contains('commander-preview-image')) {
      return target;
    }

    return target.querySelector<HTMLElement>('.commander-preview-image');
  }

  private clearCommanderHoverTimer(): void {
    if (this.commanderHoverTimer) {
      clearTimeout(this.commanderHoverTimer);
      this.commanderHoverTimer = null;
    }
  }

  private openRequestedCreateIntent(): void {
    const intent = this.route.snapshot.queryParamMap.get('intent');

    if (intent === 'import' || intent === 'new') {
      this.store.configureCreateSuccessRedirect(this.safeNextPath(this.route.snapshot.queryParamMap.get('next')));
      this.store.openCreateModal();
    }
  }

  private safeNextPath(nextPath: string | null): string | null {
    return nextPath === '/rooms' ? nextPath : null;
  }

  private isDeckListColorFilter(value: string): value is DeckListColorFilter {
    return ['all', 'W', 'U', 'B', 'R', 'G', 'C'].includes(value);
  }

  private isDeckListSortMode(value: string): value is DeckListSortMode {
    return value === 'name-asc' || value === 'name-desc';
  }
}
