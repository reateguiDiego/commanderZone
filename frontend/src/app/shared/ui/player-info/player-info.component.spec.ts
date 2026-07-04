import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../player-name/player-name.component';
import { TooltipComponent } from '../tooltip/tooltip.component';
import { PlayerInfoComponent } from './player-info.component';

describe('PlayerInfoComponent', () => {
  let fixture: ComponentFixture<PlayerInfoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerInfoComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { user: signal({ id: 'current-user' }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerInfoComponent);
  });

  it('renders the player avatar and name with the provided inputs', () => {
    fixture.componentRef.setInput('displayName', 'Marta');
    fixture.componentRef.setInput('avatar', { type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' });
    fixture.detectChanges();

    const avatar = fixture.debugElement.query((debugElement) => debugElement.componentInstance instanceof PlayerAvatarComponent);
    const name = fixture.debugElement.query((debugElement) => debugElement.componentInstance instanceof PlayerNameComponent);

    expect(avatar.componentInstance.displayName()).toBe('Marta');
    expect(name.componentInstance.displayName()).toBe('Marta');
    expect(name.componentInstance.align()).toBe('left');
    expect(fixture.nativeElement.textContent).toContain('Marta');
  });

  it('maps the public size to avatar, name, and plate sizes', () => {
    fixture.componentRef.setInput('size', 'lg');
    fixture.detectChanges();

    const avatar = fixture.debugElement.query((debugElement) => debugElement.componentInstance instanceof PlayerAvatarComponent);
    const name = fixture.debugElement.query((debugElement) => debugElement.componentInstance instanceof PlayerNameComponent);

    expect(fixture.nativeElement.querySelector('.player-info')?.classList).toContain('size-lg');
    expect(avatar.componentInstance.size()).toBe('lg');
    expect(name.componentInstance.size()).toBe('lg');
    expect(name.componentInstance.plateSize()).toBe('md');
  });

  it('emits explicit avatar and name selection events', () => {
    const avatarSpy = vi.fn();
    const nameSpy = vi.fn();
    fixture.componentInstance.avatarSelected.subscribe(avatarSpy);
    fixture.componentInstance.nameSelected.subscribe(nameSpy);
    fixture.detectChanges();

    const avatarButton = fixture.nativeElement.querySelector('.player-info-avatar-action') as HTMLButtonElement;
    const nameButton = fixture.nativeElement.querySelector('.player-info-name-action') as HTMLButtonElement;

    avatarButton.click();
    nameButton.click();

    expect(avatarSpy).toHaveBeenCalledTimes(1);
    expect(nameSpy).toHaveBeenCalledTimes(1);
  });

  it('navigates to the public community user page for another player', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const avatarSpy = vi.fn();
    fixture.componentInstance.avatarSelected.subscribe(avatarSpy);
    fixture.componentRef.setInput('profileUserId', 'other-user');
    fixture.componentRef.setInput('profileUsername', 'Other User');
    fixture.detectChanges();

    const avatarButton = fixture.nativeElement.querySelector('.player-info-avatar-action') as HTMLButtonElement;
    avatarButton.click();

    expect(navigateSpy).toHaveBeenCalledWith('/community/users/Other-User');
    expect(avatarSpy).not.toHaveBeenCalled();
  });

  it('shows a view profile tooltip only when the click will navigate to a public profile', () => {
    fixture.componentRef.setInput('profileUserId', 'other-user');
    fixture.componentRef.setInput('profileUsername', 'Other User');
    fixture.detectChanges();

    const profileTooltip = fixture.debugElement.query(
      (debugElement) =>
        debugElement.componentInstance instanceof TooltipComponent &&
        debugElement.nativeElement.classList.contains('player-info-profile-tooltip'),
    );

    expect(profileTooltip.componentInstance.text()).toBe('View profile');

    fixture.componentRef.setInput('profileUserId', 'current-user');
    fixture.detectChanges();

    expect(profileTooltip.componentInstance.text()).toBeNull();
  });

  it('opens the public community user page in a new tab from game and waiting room surfaces', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    Object.defineProperty(router, 'url', { configurable: true, value: '/games/game-1' });
    fixture.componentRef.setInput('profileUserId', 'other-user');
    fixture.componentRef.setInput('profileCanonicalPath', '/community/users/Other-User');
    fixture.detectChanges();

    const avatarButton = fixture.nativeElement.querySelector('.player-info-avatar-action') as HTMLButtonElement;
    avatarButton.click();

    expect(openSpy).toHaveBeenCalledWith('/community/users/Other-User', '_blank', 'noopener');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('keeps the local selection event for the authenticated player', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const nameSpy = vi.fn();
    fixture.componentInstance.nameSelected.subscribe(nameSpy);
    fixture.componentRef.setInput('profileUserId', 'current-user');
    fixture.componentRef.setInput('profileUsername', 'Current User');
    fixture.detectChanges();

    const nameButton = fixture.nativeElement.querySelector('.player-info-name-action') as HTMLButtonElement;
    nameButton.click();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(nameSpy).toHaveBeenCalledTimes(1);
  });

  it('renders non-interactive player identity without action buttons', () => {
    fixture.componentRef.setInput('interactive', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button.player-info-action')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('span.player-info-action').length).toBe(2);
  });

  it('renders the CommanderZone identity as the CZ logo only', () => {
    fixture.componentRef.setInput('displayName', 'CommanderZone');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.player-info-official-logo img')?.getAttribute('src'))
      .toBe(fixture.componentInstance.themeAssets.czLogoUrl());
    expect(fixture.debugElement.query((debugElement) => debugElement.componentInstance instanceof PlayerAvatarComponent)).toBeNull();
    expect(fixture.debugElement.query((debugElement) => debugElement.componentInstance instanceof PlayerNameComponent)).toBeNull();
  });
});
