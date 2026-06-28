import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CommunityDeckSummary } from '../../../core/models/community.model';
import { DeckFormat } from '../../../core/models/deck.model';
import { CardAutocompleteComponent, CardAutocompleteSelection } from '../../../shared/components/card-autocomplete/card-autocomplete.component';
import { BackButtonComponent } from '../../../shared/ui/back-button/back-button.component';
import { HeroRuleComponent } from '../../../shared/ui/hero-rule/hero-rule.component';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { FormatSelectComponent, FormatSelectOption } from '../../../shared/components/format-select/format-select.component';
import { CommunityDeckGridComponent } from '../components/community-deck-grid/community-deck-grid.component';
import { CommunityCacheService } from '../data-access/community-cache.service';

@Component({
  selector: 'app-community-deck-list-page',
  imports: [FormsModule, RuntimeTranslatePipe, HeroRuleComponent, CzButtonDirective, FormatSelectComponent, CommunityDeckGridComponent, CardAutocompleteComponent, GlobalLoaderComponent, BackButtonComponent],
  templateUrl: './community-deck-list-page.component.html',
  styleUrl: './community-deck-list-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDeckListPageComponent {
  private readonly cache = inject(CommunityCacheService);
  private readonly router = inject(Router);

  readonly searchQuery = signal(this.cache.deckListState().searchQuery);
  readonly commanderQuery = signal(this.cache.deckListState().commanderQuery);
  readonly selectedFormat = signal(this.cache.deckListState().selectedFormat);
  readonly loading = signal(this.cache.peekDecks(this.filters()) === null || this.cache.peekFormats() === null);
  readonly error = signal<string | null>(null);
  readonly decks = signal<readonly CommunityDeckSummary[]>(this.cache.peekDecks(this.filters())?.decks ?? []);
  readonly formats = signal<readonly DeckFormat[]>(this.cache.peekFormats() ?? []);
  readonly visibleDecks = computed(() => this.decks().slice(0, 20));
  readonly formatOptions = computed<readonly FormatSelectOption[]>(() => [
    { id: '', name: 'community.deckList.allFormats' },
    ...this.formats().map((format) => ({ id: format.id, name: format.name })),
  ]);

  constructor() {
    void this.loadInitialState();
  }

  openDeck(deckId: string): void {
    void this.router.navigate(['/community/decks', deckId]);
  }

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.syncFilters();
  }

  setCommanderQuery(value: string): void {
    this.commanderQuery.set(value);
    this.syncFilters();
  }

  setSelectedFormat(value: string): void {
    this.selectedFormat.set(value);
    this.syncFilters();
  }

  selectCommanderFilter(selection: CardAutocompleteSelection): void {
    this.setCommanderQuery(selection.card.name);
  }

  async applyFilters(): Promise<void> {
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
      this.decks.set(response.decks);
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
      this.decks.set(response.decks);
    } catch {
      this.error.set('community.deckList.error');
    } finally {
      this.loading.set(false);
    }
  }

  private filters(): { q?: string; commander?: string; format?: string } {
    return {
      q: this.searchQuery().trim() || undefined,
      commander: this.commanderQuery().trim() || undefined,
      format: this.selectedFormat() || undefined,
    };
  }

  private syncFilters(): void {
    this.cache.setDeckListState({
      searchQuery: this.searchQuery(),
      commanderQuery: this.commanderQuery(),
      selectedFormat: this.selectedFormat(),
    });
  }
}
