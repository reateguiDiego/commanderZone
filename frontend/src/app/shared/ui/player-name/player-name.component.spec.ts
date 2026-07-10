import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { PlayerNameComponent } from './player-name.component';

describe('PlayerNameComponent', () => {
  let fixture: ComponentFixture<PlayerNameComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerNameComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: { user: signal({ id: 'current-user' }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlayerNameComponent);
  });

  it('renders a safe default style when the preset is unknown', () => {
    fixture.componentRef.setInput('displayName', 'Finetti');
    fixture.componentRef.setInput('nameStyle', { type: 'preset', presetId: 'unknown-style' });
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    expect(name.textContent?.trim()).toBe('Finetti');
    expect(name.classList.contains('name-style-plain')).toBe(true);
    expect(name.classList.contains('has-nameplate')).toBe(false);
  });

  it('marks premium presets as nameplates', () => {
    fixture.componentRef.setInput('displayName', 'Finetti');
    fixture.componentRef.setInput('nameStyle', { type: 'preset', presetId: 'obsidian-crown', textColor: '#ffeeaa' });
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    expect(name.classList.contains('premium')).toBe(true);
    expect(name.classList.contains('has-nameplate')).toBe(true);
  });

  it('scales long display names by length bucket', () => {
    fixture.componentRef.setInput('displayName', 'CommanderZonePilotName25');
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    expect(name.classList.contains('name-length-ultra')).toBe(true);
    expect(name.style.getPropertyValue('--player-name-auto-font-size')).toBe('0.7rem');
    expect(name.style.getPropertyValue('--player-name-plain-font-size')).toBe('1.02rem');
    expect(name.getAttribute('title')).toBeNull();
  });

  it('does not render tooltips even when a tooltip mode is provided', () => {
    fixture.componentRef.setInput('displayName', 'Finetti');
    fixture.componentRef.setInput('tooltipMode', 'shared');
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    expect(fixture.nativeElement.querySelector('app-tooltip')).toBeNull();
    expect(name.getAttribute('title')).toBeNull();
  });

  it('keeps medium-length display names in the medium bucket', () => {
    fixture.componentRef.setInput('displayName', 'CommanderPilot');
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    expect(name.classList.contains('name-length-medium')).toBe(true);
  });

  it('uses explicit plate dimensions independently from the text size', () => {
    fixture.componentRef.setInput('displayName', 'Finetti');
    fixture.componentRef.setInput('nameStyle', { type: 'preset', presetId: 'obsidian-crown', textColor: '#ffeeaa' });
    fixture.componentRef.setInput('plateSize', 'xs');
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    expect(name.classList.contains('plate-size-xs')).toBe(true);
    expect(name.style.getPropertyValue('--player-name-plate-width')).toBe('10.4rem');
    expect(name.style.getPropertyValue('--player-name-plate-height')).toBe('2.6rem');
    expect(name.style.getPropertyValue('--player-name-auto-font-size')).toBe('1.02rem');
  });

  it('navigates to the public community user page for another player', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentRef.setInput('profileUserId', 'other-user');
    fixture.componentRef.setInput('profileUsername', 'Other User');
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    name.click();

    expect(navigateSpy).toHaveBeenCalledWith('/community/users/Other-User');
  });

  it('opens the public community user page in a new tab from game and waiting room surfaces', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    Object.defineProperty(router, 'url', { configurable: true, value: '/rooms/room-1/waiting' });
    fixture.componentRef.setInput('profileUserId', 'other-user');
    fixture.componentRef.setInput('profileCanonicalPath', '/community/users/Other-User');
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    name.click();

    expect(openSpy).toHaveBeenCalledWith('/community/users/Other-User', '_blank', 'noopener');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not navigate for the authenticated player', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentRef.setInput('profileUserId', 'current-user');
    fixture.componentRef.setInput('profileUsername', 'Current User');
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    name.click();

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
