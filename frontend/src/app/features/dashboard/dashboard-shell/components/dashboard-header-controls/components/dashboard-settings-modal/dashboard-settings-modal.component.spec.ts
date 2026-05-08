import { TestBed } from '@angular/core/testing';
import { importProvidersFrom, signal } from '@angular/core';
import { of } from 'rxjs';
import { Check, LucideAngularModule, Trash2, X } from 'lucide-angular';
import { AuthApi } from '../../../../../../../core/api/auth.api';
import { AuthStore } from '../../../../../../../core/auth/auth.store';
import { DashboardSettingsModalComponent } from './dashboard-settings-modal.component';

describe('DashboardSettingsModalComponent', () => {
  const authApiMock = {
    checkEmailAvailability: vi.fn(() => of({ available: true })),
    checkDisplayNameAvailability: vi.fn(() => of({ available: true })),
    updateMe: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] } })),
    deleteMe: vi.fn(() => of(void 0)),
  };

  const authStoreMock = {
    user: signal({ id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] }),
    loadMe: vi.fn(async () => undefined),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardSettingsModalComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Check, Trash2, X })),
        { provide: AuthApi, useValue: authApiMock },
        { provide: AuthStore, useValue: authStoreMock },
      ],
    }).compileComponents();
  });

  it('renders general tab and game tab content when toggling tabs', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('General');
    expect(fixture.nativeElement.textContent).toContain('Game');

    const gameTab = Array.from(fixture.nativeElement.querySelectorAll('.settings-tabs button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Game')) as HTMLButtonElement;
    gameTab.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Hello world');
  });

  it('disables save when there are no changes', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.profileBaseline.set({ email: 'player@example.test', displayName: 'Player' });
    fixture.componentInstance.profileForm.setValue({ email: 'player@example.test', displayName: 'Player' });
    expect(fixture.componentInstance.canSave()).toBe(false);
  });
});
