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
    updateDisplayNameStyle: vi.fn(() => of({ user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'], displayNameStyle: { type: 'preset', presetId: 'obsidian-crown', textColor: '#ffeeaa' } } })),
    deleteMe: vi.fn(() => of(void 0)),
  };

  const authStoreMock = {
    user: signal({ id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'], avatar: { type: 'initial', imageUrl: null }, displayNameStyle: { type: 'plain', presetId: 'plain' } }),
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

  it('opens name style editor and persists selected preset through the API', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openDisplayNameStyleEditor();
    fixture.detectChanges();

    await fixture.componentInstance.saveDisplayNameStyle({ presetId: 'obsidian-crown', textColor: '#ffeeaa' });

    expect(authApiMock.updateDisplayNameStyle).toHaveBeenCalledWith({ presetId: 'obsidian-crown', textColor: '#ffeeaa' });
    expect(authStoreMock.loadMe).toHaveBeenCalled();
    expect(fixture.componentInstance.displayNameStyleEditorOpen()).toBe(false);
  });

  it('asks for inline confirmation before deleting the account', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const deleteButton = Array.from(fixture.nativeElement.querySelectorAll('.danger-button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Delete account')) as HTMLButtonElement;
    deleteButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.deleteConfirmationOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Are you sure you want to permanently delete your account?');

    const cancelButton = fixture.nativeElement.querySelector('.keep-account-button') as HTMLButtonElement;
    expect(cancelButton.textContent).toContain('Cancel');
    expect(cancelButton.classList.contains('secondary-button')).toBe(true);

    cancelButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.deleteConfirmationOpen()).toBe(false);
    expect(authApiMock.deleteMe).not.toHaveBeenCalled();
  });

  it('opens upload mode from avatar editor header action and back returns to general settings', async () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.openAvatarEditor();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const premiumTab = Array.from(fixture.nativeElement.querySelectorAll('.avatar-tier-tabs button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Premium')) as HTMLButtonElement;
    premiumTab.click();
    fixture.detectChanges();

    let uploadButton = fixture.nativeElement.querySelector('.modal-header-action') as HTMLButtonElement;
    uploadButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarUploadOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Maximum 2MB');
    uploadButton = fixture.nativeElement.querySelector('.modal-header-action') as HTMLButtonElement;
    expect(uploadButton.textContent).toContain('Predefined avatars');

    uploadButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarUploadOpen()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Choose avatar');

    uploadButton = fixture.nativeElement.querySelector('.modal-header-action') as HTMLButtonElement;
    uploadButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const backButton = fixture.nativeElement.querySelector('.modal-back-button') as HTMLButtonElement;
    backButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.avatarEditorOpen()).toBe(false);
    expect(fixture.componentInstance.avatarUploadOpen()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('General');
  });
});
