import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { runtimeTranslationFallback } from '../../../core/localization/runtime-translate.pipe';
import { TranslationService } from '../../../core/localization/translation.service';
import { AdvancedAnalysisResponse } from '../../../core/models/deck-advanced-analysis.model';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { DeckAdvancedAnalysisViewComponent } from '../../decks/deck-advanced-analysis/deck-advanced-analysis-view.component';

@Component({
  selector: 'app-community-deck-advanced-analysis-page',
  imports: [DeckAdvancedAnalysisViewComponent, GlobalLoaderComponent],
  templateUrl: './community-deck-advanced-analysis-page.component.html',
  styleUrl: './community-deck-advanced-analysis-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDeckAdvancedAnalysisPageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly communityApi = inject(CommunityApi);
  private readonly pageHeader = inject(PageHeaderStore);
  private readonly translations = inject(TranslationService);

  readonly slug = signal(this.route.snapshot.paramMap.get('slug') ?? this.route.snapshot.paramMap.get('id') ?? '');
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly analysis = signal<AdvancedAnalysisResponse | null>(null);
  readonly deckDetailLink = computed<readonly string[]>(() => ['/community/decks', this.slug()]);

  constructor() {
    this.setPageHeader(this.slug() || this.t('common.unavailable'));

    void this.load();
  }

  ngOnDestroy(): void {
    this.pageHeader.clear(this);
  }

  async load(): Promise<void> {
    const slug = this.slug();
    if (!slug) {
      this.analysis.set(null);
      this.errorMessage.set(this.t('error.generic'));
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    this.analysis.set(null);
    this.setPageHeader(slug);

    try {
      const deckResponse = await firstValueFrom(this.communityApi.deck(slug));
      this.setPageHeader(deckResponse.deck.name);
      this.analysis.set(await firstValueFrom(this.communityApi.getCommunityDeckAdvancedAnalysis(slug)));
    } catch (error) {
      this.errorMessage.set(this.errorMessageFor(error));
    } finally {
      this.loading.set(false);
    }
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

  private setPageHeader(title: string): void {
    this.pageHeader.set({
      context: 'community-deck-advanced-analysis',
      title,
      description: 'Anàlisi de baralla',
      heroRule: true,
      actions: [
        {
          id: 'back-to-community-deck-detail',
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

  private t(key: string): string {
    const translationKey = `deckBuilder.advancedAnalysis.${key}`;
    const translated = this.translations.instant(translationKey);
    return typeof translated === 'string' && translated !== translationKey
      ? translated
      : runtimeTranslationFallback(translationKey);
  }
}
