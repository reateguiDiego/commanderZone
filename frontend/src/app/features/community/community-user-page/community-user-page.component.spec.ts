import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Flag, Globe, Heart, Link, LucideAngularModule, Search, UserPlus } from 'lucide-angular';
import { BehaviorSubject, of } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { FriendsApi } from '../../../core/api/friends.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { LanguagePreferencesService } from '../../../core/localization/language-preferences.service';
import { DynamicPublicSeoService } from '../../../core/seo/dynamic-public-seo.service';
import { CommunityCacheService } from '../data-access/community-cache.service';
import { CommunityUserPageComponent } from './community-user-page.component';

describe('CommunityUserPageComponent', () => {
  it('loads a public user deck page, applies SEO, paginates, and opens a deck', async () => {
    const firstPage = {
      user: {
        id: 'user-1',
        username: 'Alber',
        canonicalPath: '/community/users/Alber',
        displayName: 'Alber',
        avatar: null,
        displayNameStyle: { type: 'preset' as const, presetId: 'obsidian-crown', textColor: '#ffeeaa' },
      },
      decks: [
        {
          id: 'deck-1',
          publicSlug: 'atraxa-user-deck-d3ck0001',
          canonicalPath: '/community/decks/atraxa-user-deck-d3ck0001/',
          name: 'Atraxa User Deck',
          format: 'commander',
          valid: true,
          cropImage: 'https://cards.test/atraxa.jpg',
          commanderName: 'Atraxa, Grand Unifier',
          colorIdentity: ['W', 'U', 'B', 'G'],
          updatedAt: '2026-06-26T00:00:00Z',
          likes: 0,
          copies: 0,
          creatorUserId: 'user-1',
        },
      ],
      page: 1,
      limit: 20,
      total: 21,
      totalPages: 2,
      hasMore: true,
    };
    const secondPage = {
      ...firstPage,
      decks: [
        {
          id: 'deck-2',
          publicSlug: 'tymna-user-deck-d3ck0002',
          canonicalPath: '/community/decks/tymna-user-deck-d3ck0002/',
          name: 'Tymna User Deck',
          format: 'commander',
          valid: true,
          cropImage: 'https://cards.test/tymna.jpg',
          commanderName: 'Tymna the Weaver',
          colorIdentity: ['W', 'B'],
          updatedAt: '2026-06-27T00:00:00Z',
          likes: 0,
          copies: 0,
          creatorUserId: 'user-1',
        },
      ],
      page: 2,
      hasMore: false,
    };
    const api = {
      user: vi.fn((username: string, filters: { page?: number }) => of(filters.page === 2 ? secondPage : firstPage)),
    };
    const cache = {
      peekFormats: vi.fn().mockReturnValue(null),
      formats: vi.fn().mockResolvedValue([{ id: 'commander', name: 'Commander' }]),
    };
    const seo = {
      apply: vi.fn(),
    };
    const friendsApi = {
      requestUser: vi.fn().mockReturnValue(of({
        friendship: {
          id: 'friendship-1',
          status: 'pending',
          requester: { id: 'current-user', displayName: 'Current User' },
          recipient: { id: 'user-1', displayName: 'Alber' },
          createdAt: '2026-06-28T00:00:00Z',
          updatedAt: '2026-06-28T00:00:00Z',
        },
      })),
    };
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    const routeParamMap$ = new BehaviorSubject(convertToParamMap({ username: 'Alber' }));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });

    await TestBed.configureTestingModule({
      imports: [CommunityUserPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronLeft, ChevronRight, Copy, Flag, Globe, Heart, Link, Search, UserPlus })),
        { provide: ActivatedRoute, useValue: { paramMap: routeParamMap$.asObservable() } },
        { provide: CommunityApi, useValue: api },
        { provide: FriendsApi, useValue: friendsApi },
        { provide: AuthStore, useValue: { isAuthenticated: signal(true), user: signal({ id: 'current-user' }) } },
        { provide: CommunityCacheService, useValue: cache },
        { provide: DynamicPublicSeoService, useValue: seo },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CommunityUserPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    expect(api.user).toHaveBeenCalledWith('Alber', expect.objectContaining({ lang: 'es', page: 1 }));
    expect(cache.formats).toHaveBeenCalledTimes(1);
    expect(seo.apply).toHaveBeenCalledWith({
      path: '/community/users/Alber',
      title: 'Alber Commander Decks | CommanderZone',
      description: 'Browse public Commander decks shared by Alber on CommanderZone.',
      type: 'profile',
    });
    expect(fixture.nativeElement.textContent).not.toContain('@Alber');
    expect(fixture.nativeElement.textContent).toContain('Atraxa User Deck');
    expect(fixture.nativeElement.querySelector('app-player-info')?.textContent).toContain('Alber');
    expect(fixture.nativeElement.querySelector('app-player-avatar')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.community-user-copy')).toBeNull();
    expect(fixture.nativeElement.querySelector('.community-user-kicker')).toBeNull();
    expect(fixture.nativeElement.querySelector('.community-user-subtitle')).toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="Follow user"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="Report user"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.community-user-action-button.is-danger')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="Send friend request"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="Copy profile link"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.community-user-actions .cz-button--secondary').length).toBe(3);
    expect(fixture.nativeElement.querySelectorAll('.community-user-actions .icon-only').length).toBe(3);
    expect(fixture.nativeElement.querySelector('.community-user-actions .sr-only')).toBeNull();

    await fixture.componentInstance.sendFriendRequest(firstPage.user);
    expect(friendsApi.requestUser).toHaveBeenCalledWith('user-1');

    await fixture.componentInstance.shareUser(firstPage.user);
    expect(clipboardWriteText).toHaveBeenCalledWith(`${window.location.origin}/community/users/Alber`);

    await fixture.componentInstance.nextPage();
    fixture.detectChanges();
    expect(api.user).toHaveBeenCalledWith('Alber', expect.objectContaining({ lang: 'es', page: 2 }));
    expect(fixture.nativeElement.textContent).toContain('Tymna User Deck');

    fixture.componentInstance.openDeck(firstPage.decks[0]);
    expect(navigateSpy).toHaveBeenCalledWith('/community/decks/atraxa-user-deck-d3ck0001');
  });

  it('reloads the public user when the route username changes on the same component instance', async () => {
    const routeParamMap$ = new BehaviorSubject(convertToParamMap({ username: 'Alber' }));
    const api = {
      user: vi.fn((username: string) => of({
        user: {
          id: `user-${username}`,
          username,
          canonicalPath: `/community/users/${username}`,
          displayName: username,
          avatar: null,
          displayNameStyle: null,
        },
        decks: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
        hasMore: false,
      })),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityUserPageComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronLeft, ChevronRight, Copy, Flag, Globe, Heart, Link, Search, UserPlus })),
        { provide: ActivatedRoute, useValue: { paramMap: routeParamMap$.asObservable() } },
        { provide: CommunityApi, useValue: api },
        { provide: FriendsApi, useValue: { requestUser: vi.fn() } },
        { provide: AuthStore, useValue: { isAuthenticated: signal(true), user: signal({ id: 'current-user' }) } },
        { provide: CommunityCacheService, useValue: { peekFormats: vi.fn().mockReturnValue([]), formats: vi.fn().mockResolvedValue([]) } },
        { provide: DynamicPublicSeoService, useValue: { apply: vi.fn() } },
        { provide: LanguagePreferencesService, useValue: { cardLanguage: () => 'es' } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityUserPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));

    routeParamMap$.next(convertToParamMap({ username: 'Finetti' }));
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.user()?.username).toBe('Finetti'));
    fixture.detectChanges();

    expect(api.user).toHaveBeenCalledWith('Alber', expect.objectContaining({ page: 1 }));
    expect(api.user).toHaveBeenCalledWith('Finetti', expect.objectContaining({ page: 1 }));
    expect(fixture.nativeElement.textContent).toContain('Finetti');
  });
});
