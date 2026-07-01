import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
import { of } from 'rxjs';
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
  let user: ReturnType<typeof signal<{ id: string; email: string; displayName: string; roles: string[] }>>;

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    isDesktop = signal(true);
    isDesktopLayout = signal(true);
    user = signal({ id: 'user-1', email: 'player@example.com', displayName: 'Player', roles: ['ROLE_USER'] });

    await TestBed.configureTestingModule({
      imports: [DashboardShellComponent],
      providers: [
        provideRouter([]),
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
            logout: vi.fn().mockResolvedValue(undefined),
            markOfflineOnUnload: vi.fn(),
          },
        },
        {
          provide: FriendsApi,
          useValue: {
            list: vi.fn().mockReturnValue(of({ data: [] })),
            incoming: vi.fn().mockReturnValue(of({ data: [] })),
            outgoing: vi.fn().mockReturnValue(of({ data: [] })),
          },
        },
        {
          provide: MessagesApi,
          useValue: {
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
    expect(adminLink?.closest('app-tooltip')).not.toBeNull();
    expect(adminLink?.querySelector('lucide-icon[name="shield-check"]')).not.toBeNull();

    const firstNavLink = fixture.nativeElement.querySelector('.nav-list a') as HTMLAnchorElement | null;
    expect(firstNavLink?.getAttribute('href')).toBe('/admin');
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
});

function pointerDown(): Event {
  return typeof PointerEvent === 'undefined'
    ? new Event('pointerdown', { bubbles: true })
    : new PointerEvent('pointerdown', { bubbles: true });
}
