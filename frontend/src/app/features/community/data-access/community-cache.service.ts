import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { CommunityApi, CommunityDeckListFilters, CommunityPreviewFilters } from '../../../core/api/community.api';
import { DeckFormatsApi } from '../../../core/api/deck-formats.api';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import {
  CommunityDeckDetailResponse,
  CommunityDeckListResponse,
  CommunityHomeResponse,
  CommunityPreviewCardsResponse,
} from '../../../core/models/api-responses.model';
import { DeckFormat } from '../../../core/models/deck.model';

interface CommunityCacheEntry<T> {
  readonly expiresAt: number;
  readonly pending?: Promise<T>;
  readonly value?: T;
}

export interface CommunityDeckListViewState {
  readonly searchQuery: string;
  readonly commanderQuery: string;
  readonly selectedFormat: string;
}

export interface CommunityPreviewViewState {
  readonly selectedType: string;
  readonly selectedColor: string;
  readonly viewMode: 'list' | 'spoiler';
}

const COMMUNITY_CACHE_TTL_MS = 3 * 60 * 1000;
const COMMUNITY_FILTERS_DEFAULT_STATE: CommunityDeckListViewState = {
  searchQuery: '',
  commanderQuery: '',
  selectedFormat: '',
};

const COMMUNITY_PREVIEW_DEFAULT_STATE: CommunityPreviewViewState = {
  selectedType: '',
  selectedColor: '',
  viewMode: 'spoiler',
};

@Injectable({ providedIn: 'root' })
export class CommunityCacheService {
  private readonly api = inject(CommunityApi);
  private readonly deckFormatsApi = inject(DeckFormatsApi);
  private readonly languagePreferences = inject(LanguagePreferencesService);
  private readonly cache = new Map<string, CommunityCacheEntry<unknown>>();
  private readonly deckListStateStore = signal<CommunityDeckListViewState>(COMMUNITY_FILTERS_DEFAULT_STATE);
  private readonly previewStateStore = signal<Record<'commanders' | 'cards', CommunityPreviewViewState>>({
    commanders: COMMUNITY_PREVIEW_DEFAULT_STATE,
    cards: COMMUNITY_PREVIEW_DEFAULT_STATE,
  });

  readonly deckListState = this.deckListStateStore.asReadonly();
  readonly previewState = this.previewStateStore.asReadonly();

  peekHome(): CommunityHomeResponse | null {
    return this.peek('home');
  }

  peekDecks(filters: CommunityDeckListFilters = {}): CommunityDeckListResponse | null {
    return this.peek(this.decksKey(filters));
  }

  peekDeck(id: string): CommunityDeckDetailResponse | null {
    return this.peek(`deck:${id}`);
  }

  peekPreview(kind: 'commanders' | 'cards', filters: CommunityPreviewFilters = {}): CommunityPreviewCardsResponse | null {
    return this.peek(this.previewKey(kind, filters));
  }

  peekFormats(): readonly DeckFormat[] | null {
    return this.peek('formats');
  }

  home(): Promise<CommunityHomeResponse> {
    return this.load('home', () => this.api.home());
  }

  decks(filters: CommunityDeckListFilters = {}): Promise<CommunityDeckListResponse> {
    return this.load(this.decksKey(filters), () => this.api.decks(filters));
  }

  deck(id: string): Promise<CommunityDeckDetailResponse> {
    return this.load(`deck:${id}`, () => this.api.deck(id));
  }

  preview(kind: 'commanders' | 'cards', filters: CommunityPreviewFilters = {}): Promise<CommunityPreviewCardsResponse> {
    const normalizedFilters = this.normalizedPreviewFilters(filters);
    const key = this.previewKey(kind, normalizedFilters);

    return kind === 'cards'
      ? this.load(key, () => this.api.topCards(normalizedFilters))
      : this.load(key, () => this.api.topCommanders(normalizedFilters));
  }

  formats(): Promise<readonly DeckFormat[]> {
    return this.load('formats', async () => (await firstValueFrom(this.deckFormatsApi.list())).data);
  }

  setDeckListState(state: CommunityDeckListViewState): void {
    this.deckListStateStore.set({
      searchQuery: state.searchQuery,
      commanderQuery: state.commanderQuery,
      selectedFormat: state.selectedFormat,
    });
  }

  patchDeckListState(patch: Partial<CommunityDeckListViewState>): void {
    this.deckListStateStore.update((current) => ({
      searchQuery: patch.searchQuery ?? current.searchQuery,
      commanderQuery: patch.commanderQuery ?? current.commanderQuery,
      selectedFormat: patch.selectedFormat ?? current.selectedFormat,
    }));
  }

  previewStateFor(kind: 'commanders' | 'cards'): CommunityPreviewViewState {
    return this.previewStateStore()[kind];
  }

  patchPreviewState(kind: 'commanders' | 'cards', patch: Partial<CommunityPreviewViewState>): void {
    this.previewStateStore.update((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        ...patch,
      },
    }));
  }

  private peek<T>(key: string): T | null {
    const entry = this.cache.get(key) as CommunityCacheEntry<T> | undefined;
    if (!entry) {
      return null;
    }

    if (entry.value !== undefined && entry.expiresAt > Date.now()) {
      return entry.value;
    }

    if (!entry.pending) {
      this.cache.delete(key);
    }

    return null;
  }

  private async load<T>(key: string, request: () => Observable<T> | Promise<T>): Promise<T> {
    const cached = this.peek<T>(key);
    if (cached !== null) {
      return cached;
    }

    const existing = this.cache.get(key) as CommunityCacheEntry<T> | undefined;
    if (existing?.pending) {
      return existing.pending;
    }

    const pending = (async (): Promise<T> => {
      const value = await this.resolveValue(request());
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + COMMUNITY_CACHE_TTL_MS,
      });

      return value;
    })()
      .catch((error) => {
        this.cache.delete(key);
        throw error;
      });

    this.cache.set(key, {
      expiresAt: Date.now() + COMMUNITY_CACHE_TTL_MS,
      pending,
      value: existing?.value,
    });

    return pending;
  }

  private decksKey(filters: CommunityDeckListFilters): string {
    return `decks:${JSON.stringify(Object.entries(filters)
      .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
      .sort(([left], [right]) => left.localeCompare(right)))}`;
  }

  private previewKey(kind: 'commanders' | 'cards', filters: CommunityPreviewFilters): string {
    return `preview:${kind}:${JSON.stringify(this.normalizedPreviewFilters(filters))}`;
  }

  private async resolveValue<T>(value: Observable<T> | Promise<T>): Promise<T> {
    if (value instanceof Promise) {
      return value;
    }

    return firstValueFrom(value);
  }

  private normalizedPreviewFilters(filters: CommunityPreviewFilters): CommunityPreviewFilters {
    const lang = this.languagePreferences.cardLanguage().trim();

    return {
      type: filters.type?.trim().toLowerCase() ?? '',
      colors: filters.colors?.trim().toUpperCase() ?? '',
      lang,
    };
  }
}
