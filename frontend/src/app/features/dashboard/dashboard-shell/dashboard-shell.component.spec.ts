import { Component, importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  Bell,
  Check,
  ChevronRight,
  CircleUserRound,
  DoorOpen,
  Layers3,
  LogOut,
  LucideAngularModule,
  Maximize2,
  Menu,
  MessageSquare,
  Search,
  Settings,
  ShieldCheck,
  TabletSmartphone,
  Trash2,
  Users,
  X,
} from 'lucide-angular';
import { of, Subject } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { MessagesApi } from '../../../core/api/messages.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { MercureService } from '../../../core/realtime/mercure.service';
import { AppThemeService } from '../../../core/theme/app-theme.service';
import { DeviceProfileService } from '../../../shared/services/device-profile.service';
import { DashboardShellComponent } from './dashboard-shell.component';

describe('DashboardShellComponent', () => {
  let isDesktop: ReturnType<typeof signal<boolean>>;
  let isDesktopLayout: ReturnType<typeof signal<boolean>>;
  let user: ReturnType<typeof signal<{ id: string; email: string; displayName: string; roles: string[] } | null>>;
  let isAuthenticated: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    isDesktop = signal(true);
    isDesktopLayout = signal(true);
    isAuthenticated = signal(true);
    user = signal({ id: 'user-1', email: 'player@example.com', displayName: 'Player', roles: ['ROLE_USER'] });

    await TestBed.configureTestingModule({
      imports: [DashboardShellComponent],
      providers: [
        provideRouter([{ path: 'community/users/:username', component: TestRouteStubComponent }]),
        importProvidersFrom(LucideAngularModule.pick({
          Bell,
          Check,
          ChevronRight,
          CircleUserRound,
          DoorOpen,
          Layers3,
          LogOut,
          Maximize2,
          Menu,
          MessageSquare,
          Search,
          Settings,
          ShieldCheck,
          TabletSmartphone,
          Trash2,
          Users,
          X,
        })),
        {
          provide: AuthStore,
          useValue: {
            user,
            displayName: signal('Player'),
            isAuthenticated,
            impersonation: signal(null),
            isImpersonating: signal(false),
            logout: vi.fn().mockResolvedValue(undefined),
            markOfflineOnUnload: vi.fn(),
            stopImpersonation: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FriendsApi,
          useValue: {
            summary: vi.fn().mockReturnValue(of({ onlineFriendsCount: 0, incomingRequestsCount: 0, roomInvitesCount: 0 })),
            list: vi.fn().mockReturnValue(of({ data: [] })),
            incoming: vi.fn().mockReturnValue(of({ data: [] })),
            outgoing: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        {
          provide: MessagesApi,
          useValue: {
            summary: vi.fn().mockReturnValue(of({ totalCount: 0, unreadCount: 0 })),
            list: vi.fn().mockReturnValue(of({ data: [], unreadCount: 0 })),
            markRead: vi.fn().mockReturnValue(of({ message: null, unreadCount: 0 })),
          },
        },
        {
          provide: RoomsApi,
          useValue: {
            incomingInvites: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        {
          provide: MercureService,
          useValue: {
            roomInviteEvents: vi.fn().mockReturnValue(of()),
            messageEvents: vi.fn().mockReturnValue(of()),
            friendEvents: vi.fn().mockReturnValue(of()),
          },
        },
        {
          provide: DeviceProfileService,
          useValue: {
            isDesktop,
            isDesktopLayout,
          },
        },
      ],
    }).compileComponents();
  });

  it('keeps summaries fresh across real navigations and defers panel bodies', async () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    const friends = TestBed.inject(FriendsApi);
    const messages = TestBed.inject(MessagesApi);
    const router = TestBed.inject(Router);
    for (const name of ['one', 'two', 'three']) await router.navigateByUrl('/community/users/' + name);
    await fixture.whenStable();
    expect(friends.summary).toHaveBeenCalledTimes(1);
    expect(messages.summary).toHaveBeenCalledTimes(1);
    expect(friends.list).not.toHaveBeenCalled();
    expect(friends.incoming).not.toHaveBeenCalled();
    expect(messages.list).not.toHaveBeenCalled();
    fixture.componentInstance.toggleFriends(new MouseEvent('click'));
    await fixture.whenStable();
    expect(friends.list).toHaveBeenCalledTimes(1);
    fixture.componentInstance.closeFriends();
    fixture.componentInstance.toggleFriends(new MouseEvent('click'));
    await fixture.whenStable();
    expect(friends.list).toHaveBeenCalledTimes(1);
    fixture.componentInstance.toggleMessages(new MouseEvent('click'));
    await fixture.whenStable();
    expect(messages.list).toHaveBeenCalledTimes(1);
  });

  it('invalidates only invitations on Mercure and defers their body until opened', async () => {
    const events = new Subject<{ type: string }>();
    vi.mocked(TestBed.inject(MercureService).roomInviteEvents).mockReturnValue(events);
    const fixture = TestBed.createComponent(DashboardShellComponent);
    await fixture.whenStable();
    events.next({ type: 'room.invite.created' });
    await fixture.whenStable();
    expect(TestBed.inject(FriendsApi).summary).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(FriendsApi).list).not.toHaveBeenCalled();
    expect(TestBed.inject(MessagesApi).summary).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(RoomsApi).incomingInvites).not.toHaveBeenCalled();
  });

  it('preserves cache when public/private shells are recreated and clears it for a different user', async () => {
    const first = TestBed.createComponent(DashboardShellComponent);
    await first.componentInstance.friends.ensureSummaryLoaded();
    await first.componentInstance.messages.ensureSummaryLoaded();
    first.destroy();
    const second = TestBed.createComponent(DashboardShellComponent);
    await second.componentInstance.friends.ensureSummaryLoaded();
    await second.componentInstance.messages.ensureSummaryLoaded();
    expect(TestBed.inject(FriendsApi).summary).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(MessagesApi).summary).toHaveBeenCalledTimes(1);
    second.destroy();
    user.set({ id: 'user-2', email: 'other@example.com', displayName: 'Other', roles: ['ROLE_USER'] });
    const third = TestBed.createComponent(DashboardShellComponent);
    await third.componentInstance.friends.ensureSummaryLoaded();
    await third.componentInstance.messages.ensureSummaryLoaded();
    expect(TestBed.inject(FriendsApi).summary).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(MessagesApi).summary).toHaveBeenCalledTimes(2);
  });

  it('renders the authenticated shell', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
    const brandLogo = fixture.nativeElement.querySelector('.brand-mark img') as HTMLImageElement | null;
    expect(brandLogo?.getAttribute('src')).toBe('/assets/icons/CZ/CZ_logo.webp');
    const navIcons = Array.from(fixture.nativeElement.querySelectorAll('.nav-icon'))
      .map((icon) => (icon as HTMLImageElement).getAttribute('src'));
    expect(navIcons).toEqual([
      '/assets/icons/CZ/CZ_decks_menu.webp',
      '/assets/icons/CZ/CZ_rooms_menu.webp',
      '/assets/icons/CZ/CZ_cards_menu.webp',
      '/assets/icons/CZ/CZ_comunity_menu.webp',
      '/assets/icons/CZ/CZ_table_menu.webp',
    ]);
    expect(fixture.nativeElement.querySelector('app-dashboard-page-context')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Cards');
    expect(fixture.nativeElement.textContent).toContain('Community');
    expect(fixture.nativeElement.textContent).toContain('Player');
  });

  it('does not render dashboard header controls without an authenticated session', () => {
    isAuthenticated.set(false);
    user.set(null);
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-dashboard-header-controls')).toBeNull();
    expect(fixture.nativeElement.querySelector('.brand')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Community');
  });

  it('hides Rooms navigation outside desktop device and desktop layout', () => {
    isDesktopLayout.set(false);
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    const navIcons = Array.from(fixture.nativeElement.querySelectorAll('.nav-icon'))
      .map((icon) => (icon as HTMLImageElement).getAttribute('src'));
    expect(navIcons).toEqual([
      '/assets/icons/CZ/CZ_decks_menu.webp',
      '/assets/icons/CZ/CZ_cards_menu.webp',
      '/assets/icons/CZ/CZ_comunity_menu.webp',
      '/assets/icons/CZ/CZ_table_menu.webp',
    ]);
    expect(fixture.nativeElement.textContent).not.toContain('Rooms');
    expect(fixture.nativeElement.querySelector('.friends-dropdown')).not.toBeNull();
  });

  it('shows the admin topbar option for owner users', () => {
    user.set({ id: 'owner-1', email: 'owner@example.com', displayName: 'Owner', roles: ['ROLE_USER', 'ROLE_OWNER'] });
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    const adminLink = fixture.nativeElement.querySelector('a[href="/admin"]') as HTMLAnchorElement | null;

    expect(adminLink).not.toBeNull();
    expect(adminLink?.textContent?.trim()).toBe('');
    expect(adminLink?.getAttribute('aria-label')).toBe('Admin');
    expect(adminLink?.querySelector('lucide-icon[name="shield-check"]')).not.toBeNull();

    expect(adminLink?.classList).toContain('admin-action');
    expect(fixture.nativeElement.querySelector('.nav-list a[href="/admin"]')).toBeNull();
  });

  it('hides Friends controls outside desktop devices', () => {
    isDesktop.set(false);
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.friends-dropdown')).toBeNull();
    expect(fixture.nativeElement.querySelector('.user-strip')?.classList).toContain('friends-hidden');
  });

  it('hides navigation and user chrome in table assistant rooms', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.componentInstance.roomFocus.set(true);
    fixture.detectChanges();

    const brandLogo = fixture.nativeElement.querySelector('.brand-mark img') as HTMLImageElement | null;
    expect(brandLogo).toBeNull();
    expect(fixture.nativeElement.querySelector('app-dashboard-page-context')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Decks');
    expect(fixture.nativeElement.textContent).not.toContain('Rooms');
    expect(fixture.nativeElement.textContent).not.toContain('Player');
  });

  it('uses the black CZ logo in Candy Summoners', () => {
    TestBed.inject(AppThemeService).selectTheme('candy-summoners');
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    const brandLogo = fixture.nativeElement.querySelector('.brand-mark img') as HTMLImageElement | null;
    expect(brandLogo?.getAttribute('src')).toBe('/assets/icons/CZ/CZ_logo_black.webp');
  });

  it('uses the regular CZ logo in Treasure Tavern', () => {
    TestBed.inject(AppThemeService).selectTheme('treasure-tavern');
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    const brandLogo = fixture.nativeElement.querySelector('.brand-mark img') as HTMLImageElement | null;
    expect(brandLogo?.getAttribute('src')).toBe('/assets/icons/CZ/CZ_logo.webp');
  });

  it('closes the friends dropdown on outside pointerdown', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.componentInstance.friendsOpen.set(true);
    fixture.detectChanges();

    document.body.dispatchEvent(pointerDown());

    expect(fixture.componentInstance.friendsOpen()).toBe(false);
  });

  it('keeps the friends dropdown open on inside pointerdown', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.componentInstance.friendsOpen.set(true);
    fixture.detectChanges();

    const dropdown = fixture.nativeElement.querySelector('.friends-dropdown') as HTMLElement;
    dropdown.dispatchEvent(pointerDown());

    expect(fixture.componentInstance.friendsOpen()).toBe(true);
  });

  it('closes header overlays after route navigation', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.componentInstance.friendsOpen.set(true);
    fixture.componentInstance.messagesOpen.set(true);
    fixture.detectChanges();

    await router.navigateByUrl('/community/users/Finetti');
    fixture.detectChanges();

    expect(fixture.componentInstance.friendsOpen()).toBe(false);
    expect(fixture.componentInstance.messagesOpen()).toBe(false);
  });
});

@Component({
  standalone: true,
  template: '',
})
class TestRouteStubComponent {}

function pointerDown(): Event {
  return typeof PointerEvent === 'undefined'
    ? new Event('pointerdown', { bubbles: true })
    : new PointerEvent('pointerdown', { bubbles: true });
}
