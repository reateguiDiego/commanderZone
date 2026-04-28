import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CircleUserRound, DoorOpen, Layers3, LogOut, LucideAngularModule } from 'lucide-angular';
import { AuthStore } from '../../../core/auth/auth.store';
import { DashboardShellComponent } from './dashboard-shell.component';

describe('DashboardShellComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardShellComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ CircleUserRound, DoorOpen, Layers3, LogOut })),
        {
          provide: AuthStore,
          useValue: {
            user: signal({ id: 'user-1', email: 'player@example.com', displayName: 'Player' }),
            logout: vi.fn().mockResolvedValue(undefined),
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
});
