import { TestBed } from '@angular/core/testing';
import { importProvidersFrom, signal } from '@angular/core';
import { of } from 'rxjs';
import { ArrowLeft, Check, LucideAngularModule, Trash2, Upload, X } from 'lucide-angular';
import { AuthApi } from '../../../../../../../core/api/auth.api';
import { AuthStore } from '../../../../../../../core/auth/auth.store';
import { DashboardSettingsModalComponent } from './dashboard-settings-modal.component';

describe('DashboardSettingsModalComponent', () => {
  const authApiMock = {
    checkEmailAvailability: vi.fn(() => of({ available: true })),
    checkDisplayNameAvailability: vi.fn(() => of({ available: true })),
    updateMe: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] } })),
    updateAvatar: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] } })),
    deleteMe: vi.fn(() => of(void 0)),
  };

  const authStoreMock = {
    user: signal({ id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'], avatar: { type: 'initial', imageUrl: null } }),
    loadMe: vi.fn(async () => undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [DashboardSettingsModalComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ArrowLeft, Check, Trash2, Upload, X })),
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

  it('enables save when profile form values change', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.profileForm.controls.displayName.setValue('Renamed Player');
    fixture.detectChanges();

    expect(fixture.componentInstance.canSave()).toBe(true);
  });

  it('shows avatar editor and persists preset selection through the API', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openAvatarEditor();
    fixture.detectChanges();

    await fixture.componentInstance.saveAvatar({ type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' });

    expect(authApiMock.updateAvatar).toHaveBeenCalledWith({ type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' });
    expect(authStoreMock.loadMe).toHaveBeenCalled();
    expect(fixture.componentInstance.avatarEditorOpen()).toBe(false);
  });

  it('opens upload mode from avatar editor header action and back returns to general settings', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openAvatarEditor();
    fixture.detectChanges();

    const uploadButton = fixture.nativeElement.querySelector('.modal-header-action') as HTMLButtonElement;
    uploadButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarUploadOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Maximum 2MB');
    expect(uploadButton.textContent).toContain('Predefined avatars');

    uploadButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarUploadOpen()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Choose avatar');

    uploadButton.click();
    fixture.detectChanges();

    const backButton = fixture.nativeElement.querySelector('.modal-back-button') as HTMLButtonElement;
    backButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarEditorOpen()).toBe(false);
    expect(fixture.componentInstance.avatarUploadOpen()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('General');
  });
});
