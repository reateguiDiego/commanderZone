import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { CommunityDimensionLeaderboardResponse } from '../../../core/models/api-responses.model';
import { DynamicPublicSeoService } from '../../../core/seo/dynamic-public-seo.service';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { BackButtonComponent } from '../../../shared/ui/back-button/back-button.component';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { HeroRuleComponent } from '../../../shared/ui/hero-rule/hero-rule.component';

type CommunityDimensionKind = 'colors' | 'archetypes';

@Component({
  selector: 'app-community-dimension-leaderboard-page',
  imports: [BackButtonComponent, DecimalPipe, GlobalLoaderComponent, HeroRuleComponent, ManaSymbolsComponent],
  templateUrl: './community-dimension-leaderboard-page.component.html',
  styleUrl: './community-dimension-leaderboard-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDimensionLeaderboardPageComponent {
  private readonly api = inject(CommunityApi);
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(DynamicPublicSeoService);

  readonly kind = (this.route.snapshot.data['kind'] as CommunityDimensionKind | undefined) ?? 'colors';
  readonly title = this.kind === 'colors' ? 'Top Deck Colors' : 'Top Deck Archetypes';
  readonly subtitle = 'Lifetime rankings based on games played in CommanderZone.';
  readonly leaderboard = signal<CommunityDimensionLeaderboardResponse | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  constructor() {
    this.seo.apply({
      path: this.kind === 'colors' ? '/community/top-colors/' : '/community/top-archetypes/',
      title: `${this.title} | CommanderZone`,
      description: this.subtitle,
    });
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.leaderboard.set(await firstValueFrom(this.kind === 'colors' ? this.api.topColors() : this.api.topArchetypes()));
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
