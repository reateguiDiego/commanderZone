import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CommunityDeckSummary } from '../../../core/models/community.model';
import { DynamicPublicSeoService } from '../../../core/seo/dynamic-public-seo.service';
import { DeckFormat } from '../../../core/models/deck.model';
import { CardAutocompleteComponent, CardAutocompleteSelection } from '../../../shared/components/card-autocomplete/card-autocomplete.component';
import { BackButtonComponent } from '../../../shared/ui/back-button/back-button.component';
import { HeroRuleComponent } from '../../../shared/ui/hero-rule/hero-rule.component';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { PaginationComponent } from '../../../shared/ui/pagination/pagination.component';
import { FormatSelectComponent, FormatSelectOption } from '../../../shared/components/format-select/format-select.component';
import { CommunityDeckGridComponent } from '../components/community-deck-grid/community-deck-grid.component';
import { CommunityCacheService } from '../data-access/community-cache.service';
import { communityDeckRoute } from '../utils/community-deck-route';

@Component({
  selector: 'app-community-deck-list-page',
  imports: [FormsModule, RuntimeTranslatePipe, HeroRuleComponent, CzButtonDirective, FormatSelectComponent, CommunityDeckGridComponent, CardAutocompleteComponent, GlobalLoaderComponent, BackButtonComponent, PaginationComponent],
  templateUrl: './community-deck-list-page.component.html',
  styleUrl: './community-deck-list-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDeckListPageComponent {
  private readonly cache = inject(CommunityCacheService);
  private readonly router = inject(Router);
  private readonly seo = inject(DynamicPublicSeoService);

  readonly searchQuery = signal(this.cache.deckListState().searchQuery);
  readonly commanderQuery = signal(this.cache.deckListState().commanderQuery);
  readonly selectedFormat = signal(this.cache.deckListState().selectedFormat);
  readonly selectedBracket = signal(this.cache.deckListState().selectedBracket);
  readonly page = signal(this.cache.deckListState().page);
  readonly loading = signal(this.cache.peekDecks(this.filters()) === null || this.cache.peekFormats() === null);
  readonly error = signal<string | null>(null);
  readonly decks = signal<readonly CommunityDeckSummary[]>(this.cache.peekDecks(this.filters())?.decks ?? []);
  readonly total = signal(this.cache.peekDecks(this.filters())?.total ?? 0);
  readonly totalPages = signal(this.cache.peekDecks(this.filters())?.totalPages ?? 1);
  readonly hasMore = signal(this.cache.peekDecks(this.filters())?.hasMore ?? false);
  readonly formats = signal<readonly DeckFormat[]>(this.cache.peekFormats() ?? []);
  readonly visibleDecks = computed(() => this.decks());
  readonly formatOptions = computed<readonly FormatSelectOption[]>(() => [
    { id: '', name: 'community.deckList.allFormats' },
    ...this.formats().map((format) => ({ id: format.id, name: format.name })),
  ]);
  readonly bracketOptions: readonly FormatSelectOption[] = [
    { id: '', name: 'community.deckList.allBrackets' },
    ...[1, 2, 3, 4, 5].map((bracket) => ({
      id: String(bracket),
      name: 'bracket.tooltip.current',
      translationParams: { bracket },
    })),
  ];

  constructor() {
    this.seo.apply({
      path: '/community/decks/',
      title: 'Public Commander Decks | CommanderZone',
      description: 'Search public Commander decklists shared on CommanderZone and open shareable deck pages.',
    });
    void this.loadInitialState();
  }

  openDeck(deck: CommunityDeckSummary): void {
    void this.router.navigateByUrl(communityDeckRoute(deck));
  }

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.page.set(1);
    this.syncFilters();
  }

  setCommanderQuery(value: string): void {
    this.commanderQuery.set(value);
    this.page.set(1);
    this.syncFilters();
  }

  setSelectedFormat(value: string): void {
    this.selectedFormat.set(value);
    this.page.set(1);
    this.syncFilters();
  }

  setSelectedBracket(value: string): void {
    this.selectedBracket.set(value);
    this.page.set(1);
    this.syncFilters();
  }

  selectCommanderFilter(selection: CardAutocompleteSelection): void {
    this.setCommanderQuery(selection.card.name);
  }

  async applyFilters(): Promise<void> {
    this.page.set(1);
    this.syncFilters();
    await this.loadDecks();
  }

  async previousPage(): Promise<void> {
    if (this.loading() || this.page() <= 1) {
      return;
    }

    this.page.update((page) => Math.max(1, page - 1));
    this.syncFilters();
    await this.loadDecks();
  }

  async nextPage(): Promise<void> {
    if (this.loading() || !this.hasMore()) {
      return;
    }

    this.page.update((page) => page + 1);
    this.syncFilters();
    await this.loadDecks();
  }

  private async loadInitialState(): Promise<void> {
    if (this.formats().length > 0 && this.decks().length > 0) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const [formatsResponse, response] = await Promise.all([
        this.cache.formats(),
        this.cache.decks(this.filters()),
      ]);
      this.formats.set(formatsResponse);
      this.applyDeckResponse(response);
    } catch {
      this.error.set('community.deckList.error');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadDecks(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await this.cache.decks(this.filters());
      this.applyDeckResponse(response);
    } catch {
      this.error.set('community.deckList.error');
    } finally {
      this.loading.set(false);
    }
  }

  private filters(): { q?: string; commander?: string; format?: string; bracket?: string; page: number } {
    return {
      q: this.searchQuery().trim() || undefined,
      commander: this.commanderQuery().trim() || undefined,
      format: this.selectedFormat() || undefined,
      bracket: this.selectedBracket() || undefined,
      page: this.page(),
    };
  }

  private syncFilters(): void {
    this.cache.setDeckListState({
      searchQuery: this.searchQuery(),
      commanderQuery: this.commanderQuery(),
      selectedFormat: this.selectedFormat(),
      selectedBracket: this.selectedBracket(),
      page: this.page(),
    });
  }

  private applyDeckResponse(response: { decks: readonly CommunityDeckSummary[]; page: number; total: number; totalPages: number; hasMore: boolean }): void {
    this.decks.set(response.decks);
    this.page.set(response.page);
    this.total.set(response.total);
    this.totalPages.set(response.totalPages);
    this.hasMore.set(response.hasMore);
    this.syncFilters();
  }
}
