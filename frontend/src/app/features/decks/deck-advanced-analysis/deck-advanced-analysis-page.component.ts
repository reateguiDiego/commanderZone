import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { runtimeTranslationFallback } from '../../../core/localization/runtime-translate.pipe';
import { TranslationService } from '../../../core/localization/translation.service';
import { AdvancedAnalysisResponse } from '../../../core/models/deck-advanced-analysis.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { DeckAdvancedAnalysisViewComponent } from './deck-advanced-analysis-view.component';

const UUID_IDENTIFIER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Component({
  selector: 'app-deck-advanced-analysis-page',
  imports: [DeckAdvancedAnalysisViewComponent],
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
  readonly deckDetailLink = computed<readonly string[]>(() => ['/decks', this.routeIdentifier()]);

  constructor() {
    this.pageHeader.set({
      context: 'deck-advanced-analysis',
      title: 'deckBuilder.advancedAnalysis.title',
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
    this.deckName.set(null);

    try {
      const deckId = await this.resolveDeckId(identifier);
      this.deckId.set(deckId);

      const analysis = await firstValueFrom(this.decksApi.getDeckAdvancedAnalysis(deckId));
      this.analysis.set(analysis);
      this.deckId.set(analysis.deckId || deckId);
    } catch (error) {
      this.errorMessage.set(this.errorMessageFor(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async resolveDeckId(identifier: string): Promise<string> {
    if (UUID_IDENTIFIER_PATTERN.test(identifier)) {
      return identifier;
    }

    const response = await firstValueFrom(this.decksApi.getBySlug(identifier));
    this.deckName.set(response.deck.name);
    return response.deck.id;
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
