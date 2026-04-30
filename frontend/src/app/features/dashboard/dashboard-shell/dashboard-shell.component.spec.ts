import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Bell, CircleUserRound, DoorOpen, Layers3, LogOut, LucideAngularModule, TabletSmartphone } from 'lucide-angular';
import { of } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { DashboardShellComponent } from './dashboard-shell.component';

describe('DashboardShellComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardShellComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ Bell, CircleUserRound, DoorOpen, Layers3, LogOut, TabletSmartphone })),
        {
          provide: AuthStore,
          useValue: {
            user: signal({ id: 'user-1', email: 'player@example.com', displayName: 'Player' }),
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
      ],
    }).compileComponents();
  });

  it('renders the authenticated shell', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('CommanderZone');
    expect(fixture.nativeElement.textContent).toContain('Player');
  });

  it('hides navigation and user chrome in table assistant rooms', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.componentInstance.roomFocus.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('CZ');
    expect(fixture.nativeElement.textContent).not.toContain('Decks');
    expect(fixture.nativeElement.textContent).not.toContain('Rooms');
    expect(fixture.nativeElement.textContent).not.toContain('Player');
  });
});
