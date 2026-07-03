import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { CommunityDeckSummary, CommunityProfile } from '../../../core/models/community.model';
import { DynamicPublicSeoService } from '../../../core/seo/dynamic-public-seo.service';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CommunityDeckGridComponent } from '../components/community-deck-grid/community-deck-grid.component';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { HeroRuleComponent } from '../../../shared/ui/hero-rule/hero-rule.component';
import { communityDeckRoute } from '../utils/community-deck-route';

@Component({
  selector: 'app-community-profile-page',
  imports: [RuntimeTranslatePipe, CommunityDeckGridComponent, GlobalLoaderComponent, HeroRuleComponent],
  templateUrl: './community-profile-page.component.html',
  styleUrl: './community-profile-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityProfilePageComponent {
  private readonly api = inject(CommunityApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly seo = inject(DynamicPublicSeoService);
  private readonly handle = this.route.snapshot.paramMap.get('handle') ?? '';

  readonly profile = signal<CommunityProfile | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    this.seo.apply({
      path: `/community/profiles/${this.handle}/`,
      title: 'CommanderZone Public Profile',
      description: 'View a public CommanderZone profile and its shared Commander decklists.',
      type: 'profile',
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
      const response = await firstValueFrom(this.api.profile(this.handle));
      this.profile.set(response.profile);
      this.seo.apply({
        path: response.profile.canonicalPath,
        title: `${response.profile.displayName} Commander Decks | CommanderZone`,
        description: `Browse public Commander decks shared by ${response.profile.displayName} on CommanderZone.`,
        type: 'profile',
      });
    } catch {
      this.error.set('community.profile.error');
    } finally {
      this.loading.set(false);
    }
  }
}
