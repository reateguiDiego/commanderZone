import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { runtimeTranslationFallback } from '../../../core/localization/runtime-translate.pipe';
import { TranslationService } from '../../../core/localization/translation.service';
import { AdvancedAnalysisResponse } from '../../../core/models/deck-advanced-analysis.model';
import { Deck } from '../../../core/models/deck.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { DeckAdvancedAnalysisViewComponent } from './deck-advanced-analysis-view.component';

const UUID_IDENTIFIER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DeckAdvancedAnalysisNavigationState {
  readonly deck?: unknown;
  readonly routeIdentifier?: unknown;
}

@Component({
  selector: 'app-deck-advanced-analysis-page',
  imports: [DeckAdvancedAnalysisViewComponent, GlobalLoaderComponent],
  templateUrl: './deck-advanced-analysis-page.component.html',
  styleUrl: './deck-advanced-analysis-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckAdvancedAnalysisPageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly decksApi = inject(DecksApi);
  private readonly pageHeader = inject(PageHeaderStore);
  private readonly translations = inject(TranslationService);

  readonly routeIdentifier = signal(this.route.snapshot.paramMap.get('slug') ?? this.route.snapshot.paramMap.get('id') ?? '');
  readonly deckId = signal(this.routeIdentifier());
  readonly deckName = signal<string | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly analysis = signal<AdvancedAnalysisResponse | null>(null);
  readonly deck = signal<Deck | null>(null);
  readonly deckDetailLink = computed<readonly string[]>(() => ['/decks', this.routeIdentifier()]);

  constructor() {
    this.setPageHeader(this.routeIdentifier() || this.t('common.unavailable'));

    void this.load();
  }

  ngOnDestroy(): void {
    this.pageHeader.clear(this);
  }

  async load(): Promise<void> {
    const identifier = this.routeIdentifier();
    if (!identifier) {
      this.analysis.set(null);
      this.errorMessage.set(this.t('error.generic'));
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    this.analysis.set(null);
    this.deck.set(null);
    this.deckName.set(null);
    this.setPageHeader(identifier);

    try {
      const deck = await this.resolveDeck(identifier);
      this.deckId.set(deck.id);
      this.deckName.set(deck.name);
      this.deck.set(deck);
      this.setPageHeader(deck.name);

      const analysis = await firstValueFrom(this.decksApi.getDeckAdvancedAnalysis(deck.id));
      this.analysis.set(analysis);
      this.deckId.set(analysis.deckId || deck.id);
    } catch (error) {
      this.errorMessage.set(this.errorMessageFor(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async resolveDeck(identifier: string): Promise<Deck> {
    const navigationDeck = this.deckFromNavigationState(identifier);
    if (navigationDeck !== null) {
      return navigationDeck;
    }

    if (UUID_IDENTIFIER_PATTERN.test(identifier)) {
      return (await firstValueFrom(this.decksApi.get(identifier))).deck;
    }

    const response = await firstValueFrom(this.decksApi.getBySlug(identifier));
    return response.deck;
  }

  private deckFromNavigationState(identifier: string): Deck | null {
    const state = this.currentNavigationState();
    if (!state) {
      return null;
    }

    const routeIdentifier = typeof state.routeIdentifier === 'string' ? state.routeIdentifier.trim() : '';
    if (routeIdentifier !== identifier || !this.isDeckNavigationPayload(state.deck)) {
      return null;
    }

    return state.deck;
  }

  private currentNavigationState(): DeckAdvancedAnalysisNavigationState | null {
    const state = this.router.getCurrentNavigation()?.extras.state ?? window.history.state;
    return state && typeof state === 'object' ? state as DeckAdvancedAnalysisNavigationState : null;
  }

  private isDeckNavigationPayload(value: unknown): value is Deck {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<Deck>;
    return typeof candidate.id === 'string'
      && candidate.id.trim() !== ''
      && typeof candidate.name === 'string'
      && candidate.name.trim() !== '';
  }

  private setPageHeader(title: string): void {
    this.pageHeader.set({
      context: 'deck-advanced-analysis',
      title,
      description: 'Anàlisi de baralla',
      heroRule: true,
      actions: [
        {
          id: 'back-to-deck-detail',
          label: 'common.navigation.back',
          isBack: true,
          variant: 'secondary',
          execute: () => {
            void this.router.navigate([...this.deckDetailLink()]);
          },
        },
      ],
    }, this);
  }

  private errorMessageFor(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) {
        return this.t('error.notFound');
      }

      if (error.status === 403) {
        return this.t('error.forbidden');
      }
    }

    return this.t('error.generic');
  }

  private t(key: string): string {
    const translationKey = `deckBuilder.advancedAnalysis.${key}`;
    const translated = this.translations.instant(translationKey);
    return typeof translated === 'string' && translated !== translationKey
      ? translated
      : runtimeTranslationFallback(translationKey);
  }
}
