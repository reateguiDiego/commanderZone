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
  Settings,
  TabletSmartphone,
  Trash2,
  X,
} from 'lucide-angular';
import { of } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { MercureService } from '../../../core/realtime/mercure.service';
import { DashboardShellComponent } from './dashboard-shell.component';

describe('DashboardShellComponent', () => {
  beforeEach(async () => {
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
          Settings,
          TabletSmartphone,
          Trash2,
          X,
        })),
        {
          provide: AuthStore,
          useValue: {
            user: signal({ id: 'user-1', email: 'player@example.com', displayName: 'Player' }),
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
      ],
    }).compileComponents();
  });

  it('renders the authenticated shell', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    const brandLogo = fixture.nativeElement.querySelector('.brand-mark img') as HTMLImageElement | null;
    expect(brandLogo?.getAttribute('src')).toBe('/assets/icons/CM/CM_logo.png');
    expect(fixture.nativeElement.textContent).toContain('Player');
  });

  it('hides navigation and user chrome in table assistant rooms', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.componentInstance.roomFocus.set(true);
    fixture.detectChanges();

    const brandLogo = fixture.nativeElement.querySelector('.brand-mark img') as HTMLImageElement | null;
    expect(brandLogo?.getAttribute('src')).toBe('/assets/icons/CM/CM_logo.png');
    expect(fixture.nativeElement.textContent).not.toContain('Decks');
    expect(fixture.nativeElement.textContent).not.toContain('Rooms');
    expect(fixture.nativeElement.textContent).not.toContain('Player');
  });
});
