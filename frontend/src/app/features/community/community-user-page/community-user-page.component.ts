import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { distinctUntilChanged, firstValueFrom, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommunityApi, CommunityDeckListFilters } from '../../../core/api/community.api';
import { FriendsApi } from '../../../core/api/friends.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CommunityDeckSummary, CommunityUser } from '../../../core/models/community.model';
import { DeckFormat } from '../../../core/models/deck.model';
import { DynamicPublicSeoService } from '../../../core/seo/dynamic-public-seo.service';
import { CardAutocompleteComponent, CardAutocompleteSelection } from '../../../shared/components/card-autocomplete/card-autocomplete.component';
import { FormatSelectComponent, FormatSelectOption } from '../../../shared/components/format-select/format-select.component';
import { BackButtonComponent } from '../../../shared/ui/back-button/back-button.component';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { GlobalLoaderComponent } from '../../../shared/ui/global-loader/global-loader.component';
import { HeroRuleComponent } from '../../../shared/ui/hero-rule/hero-rule.component';
import { PaginationComponent } from '../../../shared/ui/pagination/pagination.component';
import { PlayerInfoComponent } from '../../../shared/ui/player-info/player-info.component';
import { TooltipComponent } from '../../../shared/ui/tooltip/tooltip.component';
import { CommunityDeckGridComponent } from '../components/community-deck-grid/community-deck-grid.component';
import { CommunityCacheService } from '../data-access/community-cache.service';
import { communityDeckRoute } from '../utils/community-deck-route';

@Component({
  selector: 'app-community-user-page',
  imports: [
    FormsModule,
    RuntimeTranslatePipe,
    BackButtonComponent,
    CardAutocompleteComponent,
    CommunityDeckGridComponent,
    CzButtonDirective,
    FormatSelectComponent,
    GlobalLoaderComponent,
    HeroRuleComponent,
    LucideAngularModule,
    PaginationComponent,
    PlayerInfoComponent,
    TooltipComponent,
  ],
  templateUrl: './community-user-page.component.html',
  styleUrl: './community-user-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityUserPageComponent implements OnDestroy {
  private readonly api = inject(CommunityApi);
  private readonly auth = inject(AuthStore);
  private readonly cache = inject(CommunityCacheService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly friendsApi = inject(FriendsApi);
  private readonly languagePreferences = inject(LanguagePreferencesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly seo = inject(DynamicPublicSeoService);
  private copiedShareHandle?: number;
  private loadVersion = 0;

  readonly username = signal('');
  readonly user = signal<CommunityUser | null>(null);
  readonly searchQuery = signal('');
  readonly commanderQuery = signal('');
  readonly selectedFormat = signal('');
  readonly selectedColor = signal('');
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly decks = signal<readonly CommunityDeckSummary[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly hasMore = signal(false);
  readonly sendingFriendRequest = signal(false);
  readonly actionFeedback = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly formats = signal<readonly DeckFormat[]>(this.cache.peekFormats() ?? []);
  readonly visibleDecks = computed(() => this.decks());
  readonly formatOptions = computed<readonly FormatSelectOption[]>(() => [
    { id: '', name: 'community.deckList.allFormats' },
    ...this.formats().map((format) => ({ id: format.id, name: format.name })),
  ]);
  readonly colorOptions: readonly FormatSelectOption[] = [
    { id: '', labelKey: 'community.user.allColors' },
    { id: 'W', name: 'White' },
    { id: 'U', name: 'Blue' },
    { id: 'B', name: 'Black' },
    { id: 'R', name: 'Red' },
    { id: 'G', name: 'Green' },
    { id: 'C', name: 'Colorless' },
  ];

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => params.get('username')?.trim() ?? ''),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((username) => {
        this.username.set(username);
        this.resetRouteState();
        this.seo.apply({
          path: `/community/users/${encodeURIComponent(username)}`,
          title: 'CommanderZone Public User',
          description: 'View a public CommanderZone user and their shared Commander decklists.',
          type: 'profile',
        });
        void this.loadInitialState(++this.loadVersion);
      });
  }

  ngOnDestroy(): void {
    if (this.copiedShareHandle !== undefined) {
      window.clearTimeout(this.copiedShareHandle);
    }
  }

  openDeck(deck: CommunityDeckSummary): void {
    void this.router.navigateByUrl(communityDeckRoute(deck));
  }

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
    this.page.set(1);
  }

  setCommanderQuery(value: string): void {
    this.commanderQuery.set(value);
    this.page.set(1);
  }

  setSelectedFormat(value: string): void {
    this.selectedFormat.set(value);
    this.page.set(1);
  }

  setSelectedColor(value: string): void {
    this.selectedColor.set(value);
    this.page.set(1);
  }

  selectCommanderFilter(selection: CardAutocompleteSelection): void {
    this.setCommanderQuery(selection.card.name);
  }

  async sendFriendRequest(user: CommunityUser): Promise<void> {
    if (this.sendingFriendRequest()) {
      return;
    }

    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/auth/login']);
      return;
    }

    this.sendingFriendRequest.set(true);
    this.actionError.set(null);
    this.actionFeedback.set(null);

    try {
      await firstValueFrom(this.friendsApi.requestUser(user.id));
      this.actionFeedback.set('Friend request sent.');
    } catch {
      this.actionError.set('Could not send friend request.');
    } finally {
      this.sendingFriendRequest.set(false);
    }
  }

  async shareUser(user: CommunityUser): Promise<void> {
    try {
      this.actionError.set(null);
      await navigator.clipboard.writeText(`${window.location.origin}${user.canonicalPath}`);
      this.actionFeedback.set('Profile link copied.');
      if (this.copiedShareHandle !== undefined) {
        window.clearTimeout(this.copiedShareHandle);
      }
      this.copiedShareHandle = window.setTimeout(() => {
        this.copiedShareHandle = undefined;
        this.actionFeedback.set(null);
      }, 5000);
    } catch {
      this.actionError.set('Could not copy the profile link.');
    }
  }

  async applyFilters(): Promise<void> {
    this.page.set(1);
    await this.loadUser();
  }

  async previousPage(): Promise<void> {
    if (this.loading() || this.page() <= 1) {
      return;
    }

    this.page.update((page) => Math.max(1, page - 1));
    await this.loadUser();
  }

  async nextPage(): Promise<void> {
    if (this.loading() || !this.hasMore()) {
      return;
    }

    this.page.update((page) => page + 1);
    await this.loadUser();
  }

  private async loadInitialState(loadVersion: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const [formats] = await Promise.all([
        this.formats().length > 0 ? Promise.resolve(this.formats()) : this.cache.formats(),
        this.loadUser(loadVersion),
      ]);
      if (!this.isActiveLoad(loadVersion)) {
        return;
      }
      this.formats.set(formats);
    } catch {
      if (!this.isActiveLoad(loadVersion)) {
        return;
      }
      this.error.set('community.user.error');
    } finally {
      if (this.isActiveLoad(loadVersion)) {
        this.loading.set(false);
      }
    }
  }

  private async loadUser(loadVersion = this.loadVersion): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(this.api.user(this.username(), this.filters()));
      if (!this.isActiveLoad(loadVersion)) {
        return;
      }
      this.user.set(response.user);
      this.decks.set(response.decks);
      this.page.set(response.page);
      this.total.set(response.total);
      this.totalPages.set(response.totalPages);
      this.hasMore.set(response.hasMore);
      this.seo.apply({
        path: response.user.canonicalPath,
        title: `${response.user.displayName} Commander Decks | CommanderZone`,
        description: `Browse public Commander decks shared by ${response.user.displayName} on CommanderZone.`,
        type: 'profile',
      });
    } catch {
      if (!this.isActiveLoad(loadVersion)) {
        return;
      }
      this.error.set('community.user.error');
    } finally {
      if (this.isActiveLoad(loadVersion)) {
        this.loading.set(false);
      }
    }
  }

  private resetRouteState(): void {
    this.user.set(null);
    this.decks.set([]);
    this.total.set(0);
    this.totalPages.set(1);
    this.hasMore.set(false);
    this.searchQuery.set('');
    this.commanderQuery.set('');
    this.selectedFormat.set('');
    this.selectedColor.set('');
    this.page.set(1);
    this.actionFeedback.set(null);
    this.actionError.set(null);
  }

  private isActiveLoad(loadVersion: number): boolean {
    return loadVersion === this.loadVersion;
  }

  private filters(): CommunityDeckListFilters {
    return {
      q: this.searchQuery().trim() || undefined,
      commander: this.commanderQuery().trim() || undefined,
      format: this.selectedFormat() || undefined,
      colors: this.selectedColor() || undefined,
      lang: this.languagePreferences.cardLanguage().trim() || undefined,
      page: this.page(),
    };
  }
}
