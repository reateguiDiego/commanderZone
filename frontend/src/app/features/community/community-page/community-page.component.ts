import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommunityHome } from '../../../core/models/community.model';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CardPreviewSectionComponent } from '../../../shared/components/card-preview-section/card-preview-section.component';
import { DynamicPublicSeoService } from '../../../core/seo/dynamic-public-seo.service';
import { DeviceProfileService } from '../../../shared/services/device-profile.service';
import { HeroRuleComponent } from '../../../shared/ui/hero-rule/hero-rule.component';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { sortCardPreviewItemsByTimesPlayed } from '../../../shared/utils/card-preview-item';
import { CommunityDeckGridComponent } from '../components/community-deck-grid/community-deck-grid.component';
import { CommunityCacheService } from '../data-access/community-cache.service';
import { communityDeckRoute } from '../utils/community-deck-route';

@Component({
  selector: 'app-community-page',
  imports: [RouterLink, RuntimeTranslatePipe, CardPreviewSectionComponent, HeroRuleComponent, CzButtonDirective, CommunityDeckGridComponent, GlobalLoaderComponent],
  templateUrl: './community-page.component.html',
  styleUrl: './community-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityPageComponent {
  private readonly cache = inject(CommunityCacheService);
  private readonly router = inject(Router);
  private readonly device = inject(DeviceProfileService);
  private readonly seo = inject(DynamicPublicSeoService);

  readonly home = signal<CommunityHome | null>(this.cache.peekHome());
  readonly loading = signal(this.home() === null);
  readonly error = signal<string | null>(null);
  readonly featuredCommanders = computed(() => sortCardPreviewItemsByTimesPlayed(this.home()?.commanders ?? []).slice(0, 3));
  readonly featuredCards = computed(() => sortCardPreviewItemsByTimesPlayed(this.home()?.cards ?? []).slice(0, 3));
  readonly featuredDecks = computed(() => this.home()?.decks.slice(0, 6) ?? []);
  readonly commandersTitleKey = computed(() => this.device.isMobileLayout()
    ? 'community.home.mobileCommandersTitle'
    : 'community.home.commandersTitle');
  readonly cardsTitleKey = computed(() => this.device.isMobileLayout()
    ? 'community.home.mobileCardsTitle'
    : 'community.home.cardsTitle');

  constructor() {
    this.seo.apply({
      path: '/community/',
      title: 'Community Commander Decks | CommanderZone',
      description: 'Browse public Commander decks, popular commanders and shared CommanderZone decklists.',
    });
    void this.load();
  }

  openDeck(deck: { id: string; publicSlug?: string | null; canonicalPath?: string | null }): void {
    void this.router.navigateByUrl(communityDeckRoute(deck));
  }

  private async load(): Promise<void> {
    if (this.home() !== null) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await this.cache.home();
      this.home.set(response);
    } catch {
      this.error.set('community.home.error');
    } finally {
      this.loading.set(false);
    }
  }
}
