import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CommunityPreviewFilters } from '../../../core/api/community.api';
import { CommunityPreviewCardsResponse } from '../../../core/models/api-responses.model';
import { Card } from '../../../core/models/card.model';
import { CardPreviewItem } from '../../../core/models/card-preview.model';
import { AddCardToDeckModalComponent } from '../../../shared/components/add-card-to-deck-modal/add-card-to-deck-modal.component';
import { CardDetailsModalComponent } from '../../../shared/components/card-details-modal/card-details-modal.component';
import { CardPreviewResultActionEvent, CardPreviewResultsComponent, CardPreviewResultsViewMode } from '../../../shared/components/card-preview-results/card-preview-results.component';
import { CardPrintingsModalComponent } from '../../../shared/components/card-printings-modal/card-printings-modal.component';
import { CardsMainLayoutComponent } from '../../../shared/components/cards-main-layout/cards-main-layout.component';
import { FormatSelectComponent, FormatSelectOption } from '../../../shared/components/format-select/format-select.component';
import { DeviceProfileService } from '../../../shared/services/device-profile.service';
import { BackButtonComponent } from '../../../shared/ui/back-button/back-button.component';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { HeroRuleComponent } from '../../../shared/ui/hero-rule/hero-rule.component';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { TabListComponent, TabListItem } from '../../../shared/ui/tab-list/tab-list.component';
import { sortCardPreviewItemsByTimesPlayed } from '../../../shared/utils/card-preview-item';
import { CommunityCacheService } from '../data-access/community-cache.service';

type CommunityPreviewKind = 'commanders' | 'cards';

interface CardDetailsDialogState {
  readonly title: string;
  readonly card: Card | null;
  readonly loading: boolean;
  readonly errorKey: string | null;
}

interface CardPrintingsDialogState {
  readonly title: string;
  readonly printings: readonly Card[];
  readonly loading: boolean;
  readonly errorKey: string | null;
}

@Component({
  selector: 'app-community-card-preview-page',
  imports: [
    RuntimeTranslatePipe,
    FormatSelectComponent,
    HeroRuleComponent,
    GlobalLoaderComponent,
    CardsMainLayoutComponent,
    CardPreviewResultsComponent,
    AddCardToDeckModalComponent,
    CardDetailsModalComponent,
    CardPrintingsModalComponent,
    BackButtonComponent,
    CzButtonDirective,
    TabListComponent,
  ],
  templateUrl: './community-card-preview-page.component.html',
  styleUrl: './community-card-preview-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityCardPreviewPageComponent {
  private readonly cache = inject(CommunityCacheService);
  private readonly cardsApi = inject(CardsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly device = inject(DeviceProfileService);
  readonly kind = (this.route.snapshot.data['kind'] as CommunityPreviewKind | undefined) ?? 'commanders';
  private readonly initialViewState = this.cache.previewStateFor(this.kind);
  readonly selectedType = signal(this.initialViewState.selectedType);
  readonly selectedColor = signal(this.initialViewState.selectedColor);
  readonly viewMode = signal<CardPreviewResultsViewMode>(this.initialViewState.viewMode);

  readonly preview = signal<CommunityPreviewCardsResponse | null>(this.cache.peekPreview(this.kind, this.previewFilters()));
  readonly loading = signal(this.preview() === null);
  readonly error = signal<string | null>(null);
  readonly detailsDialog = signal<CardDetailsDialogState | null>(null);
  readonly addToDeckCard = signal<CardPreviewItem | null>(null);
  readonly printingsDialog = signal<CardPrintingsDialogState | null>(null);
  readonly sortedItems = computed(() => sortCardPreviewItemsByTimesPlayed(this.preview()?.items ?? []));
  readonly spoilerOnlyView = computed(() => !this.device.hasHover() && this.device.isMobileLayout());
  readonly effectiveViewMode = computed<CardPreviewResultsViewMode>(() => this.spoilerOnlyView() ? 'spoiler' : this.viewMode());
  readonly heroTitleKey = this.kind === 'cards'
    ? 'community.home.cardsTitle'
    : 'community.home.commandersTitle';
  readonly heroSubtitleKey = 'community.home.cardsSubtitle';
  readonly typeOptions: readonly FormatSelectOption[] = [
    { id: '', labelKey: 'community.preview.filters.allTypes' },
    { id: 'artifact', labelKey: 'community.preview.filters.type.artifact' },
    { id: 'battle', labelKey: 'community.preview.filters.type.battle' },
    { id: 'creature', labelKey: 'community.preview.filters.type.creature' },
    { id: 'enchantment', labelKey: 'community.preview.filters.type.enchantment' },
    { id: 'instant', labelKey: 'community.preview.filters.type.instant' },
    { id: 'land', labelKey: 'community.preview.filters.type.land' },
    { id: 'planeswalker', labelKey: 'community.preview.filters.type.planeswalker' },
    { id: 'sorcery', labelKey: 'community.preview.filters.type.sorcery' },
  ];
  readonly colorOptions: readonly FormatSelectOption[] = [
    { id: '', labelKey: 'deckBuilder.deckList.colorFilter.any' },
    { id: 'W', labelKey: 'deckBuilder.deckList.colorFilter.white' },
    { id: 'U', labelKey: 'deckBuilder.deckList.colorFilter.blue' },
    { id: 'B', labelKey: 'deckBuilder.deckList.colorFilter.black' },
    { id: 'R', labelKey: 'deckBuilder.deckList.colorFilter.red' },
    { id: 'G', labelKey: 'deckBuilder.deckList.colorFilter.green' },
    { id: 'C', labelKey: 'deckBuilder.deckList.colorFilter.colorless' },
  ];
  readonly viewTabs: readonly TabListItem[] = [
    { id: 'list', label: 'deckBuilder.cards.cardSearch.view.list', icon: 'list' },
    { id: 'spoiler', label: 'deckBuilder.cards.cardSearch.view.spoiler', icon: 'image' },
  ];

  constructor() {
    void this.load();
  }

  selectType(value: string): void {
    this.selectedType.set(value);
  }

  selectColor(value: string): void {
    this.selectedColor.set(value);
  }

  selectViewMode(value: string): void {
    if (this.spoilerOnlyView()) {
      return;
    }

    if (value !== 'list' && value !== 'spoiler') {
      return;
    }

    this.viewMode.set(value);
    this.cache.patchPreviewState(this.kind, { viewMode: value });
  }

  async searchPreview(): Promise<void> {
    this.cache.patchPreviewState(this.kind, {
      selectedType: this.selectedType(),
      selectedColor: this.selectedColor(),
      viewMode: this.effectiveViewMode(),
    });
    await this.load(true);
  }

  async handlePreviewAction(event: CardPreviewResultActionEvent): Promise<void> {
    switch (event.action) {
      case 'details':
        await this.openDetails(event.item.scryfallId, event.item.name);
        return;
      case 'addToDeck':
        this.addToDeckCard.set(event.item);
        return;
      case 'printings':
        await this.openPrintings(event.item.scryfallId, event.item.name);
        return;
      case 'rulings':
        this.openRulings(event.item.name);
        return;
    }
  }

  closeDetails(): void {
    this.detailsDialog.set(null);
  }

  closeAddToDeck(): void {
    this.addToDeckCard.set(null);
  }

  closePrintings(): void {
    this.printingsDialog.set(null);
  }

  private async load(force = false): Promise<void> {
    const filters = this.previewFilters();

    if (!force && this.cache.peekPreview(this.kind, filters) !== null) {
      this.preview.set(this.cache.peekPreview(this.kind, filters));
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await this.cache.preview(this.kind, filters);
      this.preview.set(response);
    } catch {
      this.error.set('community.preview.error');
    } finally {
      this.loading.set(false);
    }
  }

  private async openDetails(scryfallId: string, name: string): Promise<void> {
    this.detailsDialog.set({
      title: name,
      card: null,
      loading: true,
      errorKey: null,
    });

    try {
      const response = await firstValueFrom(this.cardsApi.get(scryfallId));
      this.detailsDialog.set({
        title: response.card.name || name,
        card: response.card,
        loading: false,
        errorKey: null,
      });
    } catch {
      this.detailsDialog.update((state) => state ? {
        ...state,
        loading: false,
        errorKey: 'deckBuilder.cards.cardSearch.details.couldNotLoad',
      } : state);
    }
  }

  private async openPrintings(scryfallId: string, name: string): Promise<void> {
    this.printingsDialog.set({
      title: name,
      printings: [],
      loading: true,
      errorKey: null,
    });

    try {
      const response = await firstValueFrom(this.cardsApi.printings(scryfallId));
      this.printingsDialog.set({
        title: name,
        printings: response.data,
        loading: false,
        errorKey: null,
      });
    } catch {
      this.printingsDialog.update((state) => state ? {
        ...state,
        loading: false,
        errorKey: 'deckBuilder.cards.cardSearch.printings.couldNotLoad',
      } : state);
    }
  }

  private openRulings(name: string): void {
    window.open(`https://scryfall.com/search?q=!%22${encodeURIComponent(name)}%22&utm_source=commanderzone`, '_blank', 'noopener,noreferrer');
  }

  private previewFilters(): CommunityPreviewFilters {
    return {
      type: this.selectedType(),
      colors: this.selectedColor(),
    };
  }
}
