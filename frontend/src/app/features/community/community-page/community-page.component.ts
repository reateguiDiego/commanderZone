import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { CommunityHome } from '../../../core/models/community.model';
import { FriendSearchResult } from '../../../core/models/friendship.model';
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

const USER_SEARCH_DEBOUNCE_MS = 250;

type UserSearchPayload = FriendSearchResult & {
  readonly username?: string | null;
  readonly canonicalPath?: string | null;
  readonly handle?: string | null;
  readonly publicHandle?: string | null;
  readonly publicPath?: string | null;
};

interface UserSearchRouteTarget {
  readonly username?: string | null;
  readonly canonicalPath?: string | null;
  readonly publicPath?: string | null;
}

@Component({
  selector: 'app-community-page',
  imports: [DecimalPipe, FormsModule, RouterLink, LucideAngularModule, RuntimeTranslatePipe, CardPreviewSectionComponent, HeroRuleComponent, CzButtonDirective, CommunityDeckGridComponent, GlobalLoaderComponent],
  templateUrl: './community-page.component.html',
  styleUrl: './community-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityPageComponent implements OnDestroy {
  private readonly cache = inject(CommunityCacheService);
  private readonly friendsApi = inject(FriendsApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly device = inject(DeviceProfileService);
  private readonly seo = inject(DynamicPublicSeoService);
  private userSearchVersion = 0;
  private userSearchDebounceId: ReturnType<typeof setTimeout> | null = null;

  readonly home = signal<CommunityHome | null>(this.cache.peekHome());
  readonly loading = signal(this.home() === null);
  readonly error = signal<string | null>(null);
  readonly userSearchQuery = signal('');
  readonly userSearchResults = signal<readonly FriendSearchResult[]>([]);
  readonly userSearchLoading = signal(false);
  readonly userSearchError = signal<string | null>(null);
  readonly canSearchUsers = this.auth.isAuthenticated;
  readonly hasUserSearchInput = computed(() => this.userSearchQuery().trim().length > 0);
  readonly userSearchReady = computed(() => this.userSearchQuery().trim().length >= 2);
  readonly featuredCommanders = computed(() => sortCardPreviewItemsByTimesPlayed(this.home()?.commanders ?? []).slice(0, 3));
  readonly featuredCards = computed(() => sortCardPreviewItemsByTimesPlayed(this.home()?.cards ?? []).slice(0, 3));
  readonly featuredDecks = computed(() => this.home()?.decks.slice(0, 6) ?? []);
  readonly publicDeckCount = computed(() => this.home()?.publicDeckCount ?? 0);
  readonly commandersTitleKey = computed(() => this.device.isMobileLayout()
    ? 'shared.text.topCommanders'
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

  ngOnDestroy(): void {
    this.clearUserSearchDebounce();
  }

  updateUserSearch(query: string): void {
    this.userSearchQuery.set(query);
    this.userSearchError.set(null);
    const normalizedQuery = query.trim();
    const version = ++this.userSearchVersion;
    this.clearUserSearchDebounce();

    if (normalizedQuery.length < 2 || !this.canSearchUsers()) {
      this.userSearchResults.set([]);
      this.userSearchLoading.set(false);
      return;
    }

    this.userSearchLoading.set(true);
    this.userSearchDebounceId = setTimeout(() => {
      void this.searchUsers(normalizedQuery, version);
    }, USER_SEARCH_DEBOUNCE_MS);
  }

  openUser(result: UserSearchRouteTarget): void {
    const path = this.userPath(result);
    if (path === null) {
      this.userSearchError.set('community.home.usernameSearchError');
      return;
    }

    this.clearUserSearchDebounce();
    this.userSearchQuery.set('');
    this.userSearchResults.set([]);
    this.userSearchLoading.set(false);
    void this.router.navigateByUrl(path);
  }

  private async searchUsers(normalizedQuery: string, version: number): Promise<void> {
    try {
      const response = await firstValueFrom(this.friendsApi.search(normalizedQuery));
      if (version === this.userSearchVersion) {
        this.userSearchResults.set(response.data
          .map((result) => this.normalizeUserSearchResult(result))
          .filter((result): result is FriendSearchResult => result !== null));
      }
    } catch {
      if (version === this.userSearchVersion) {
        this.userSearchError.set('community.home.usernameSearchError');
        this.userSearchResults.set([]);
      }
    } finally {
      if (version === this.userSearchVersion) {
        this.userSearchLoading.set(false);
      }
    }
  }

  private normalizeUserSearchResult(result: FriendSearchResult): FriendSearchResult | null {
    const payload = result as UserSearchPayload;
    const username = this.firstNonEmpty(payload.username, payload.handle, payload.publicHandle);
    if (username === null) {
      return null;
    }
    const urlUsername = this.urlUsername(username);

    return {
      ...result,
      username: urlUsername,
      canonicalPath: this.userPath({ username: urlUsername, canonicalPath: payload.canonicalPath ?? payload.publicPath ?? null }) ?? `/community/users/${encodeURIComponent(urlUsername)}`,
    };
  }

  private userPath(result: UserSearchRouteTarget): string | null {
    const canonicalPath = this.firstNonEmpty(result.canonicalPath, result.publicPath);
    if (canonicalPath !== null && canonicalPath.startsWith('/community/users/') && !canonicalPath.includes('/undefined')) {
      return canonicalPath.replace(/\/+$/, '');
    }

    const username = this.firstNonEmpty(result.username);
    return username === null ? null : `/community/users/${encodeURIComponent(this.urlUsername(username))}`;
  }

  private firstNonEmpty(...values: readonly (string | null | undefined)[]): string | null {
    for (const value of values) {
      const normalizedValue = (value ?? '').trim();
      if (normalizedValue !== '') {
        return normalizedValue;
      }
    }

    return null;
  }

  private urlUsername(username: string): string {
    return username.trim().replace(/\s+/g, '-');
  }

  private clearUserSearchDebounce(): void {
    if (this.userSearchDebounceId === null) {
      return;
    }

    clearTimeout(this.userSearchDebounceId);
    this.userSearchDebounceId = null;
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
