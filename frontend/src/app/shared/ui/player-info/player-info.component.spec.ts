import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlayerAvatarComponent } from '../player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../player-name/player-name.component';
import { PlayerInfoComponent } from './player-info.component';

describe('PlayerInfoComponent', () => {
  let fixture: ComponentFixture<PlayerInfoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerInfoComponent],
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
