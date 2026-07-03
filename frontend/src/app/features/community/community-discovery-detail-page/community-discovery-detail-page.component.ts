import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { CommunityDeckSummary, CommunityDiscoveryDetail } from '../../../core/models/community.model';
import { DynamicPublicSeoService } from '../../../core/seo/dynamic-public-seo.service';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { CardFaceImageComponent } from '../../../shared/components/card-face-image/card-face-image.component';
import { CommunityDeckGridComponent } from '../components/community-deck-grid/community-deck-grid.component';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { HeroRuleComponent } from '../../../shared/ui/hero-rule/hero-rule.component';
import { communityDeckRoute } from '../utils/community-deck-route';

type DiscoveryKind = 'commander' | 'card';

@Component({
  selector: 'app-community-discovery-detail-page',
  imports: [
    RuntimeTranslatePipe,
    ManaSymbolsComponent,
    CardFaceImageComponent,
    CommunityDeckGridComponent,
    GlobalLoaderComponent,
    HeroRuleComponent,
  ],
  templateUrl: './community-discovery-detail-page.component.html',
  styleUrl: './community-discovery-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDiscoveryDetailPageComponent {
  private readonly api = inject(CommunityApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly seo = inject(DynamicPublicSeoService);
  private readonly slug = this.route.snapshot.paramMap.get('slug') ?? '';
  readonly kind = ((this.route.snapshot.data['kind'] as DiscoveryKind | undefined) ?? 'card');

  readonly detail = signal<CommunityDiscoveryDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly title = computed(() => this.detail()?.item.name ?? '');

  constructor() {
    this.seo.apply({
      path: this.kind === 'commander'
        ? `/community/commanders/${this.slug}/`
        : `/community/cards/${this.slug}/`,
      title: this.kind === 'commander'
        ? 'Commander Decks | CommanderZone'
        : 'Commander Card Decks | CommanderZone',
      description: this.kind === 'commander'
        ? 'Discover public Commander decks featuring this commander on CommanderZone.'
        : 'Discover public Commander decks using this card on CommanderZone.',
    });
    void this.load();
  }

  openDeck(deck: CommunityDeckSummary): void {
    void this.router.navigateByUrl(communityDeckRoute(deck));
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.kind === 'commander'
          ? this.api.commander(this.slug)
          : this.api.card(this.slug),
      );
      this.detail.set(response);
      const canonicalPath = this.kind === 'commander'
        ? `/community/commanders/${response.item.slug ?? this.slug}/`
        : (response.item.canonicalPath ?? `/community/cards/${this.slug}/`);

      this.seo.apply({
        path: canonicalPath,
        title: this.kind === 'commander'
          ? `${response.item.name} Commander Decks | CommanderZone`
          : `${response.item.name} Commander Decks | CommanderZone`,
        description: this.kind === 'commander'
          ? `Browse public Commander decks led by ${response.item.name} on CommanderZone.`
          : `Browse public Commander decks playing ${response.item.name} on CommanderZone.`,
        image: response.item.cropImage,
      });
    } catch {
      this.error.set('community.discovery.error');
    } finally {
      this.loading.set(false);
    }
  }
}
