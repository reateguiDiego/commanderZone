import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlayerNameComponent } from './player-name.component';

describe('PlayerNameComponent', () => {
  let fixture: ComponentFixture<PlayerNameComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerNameComponent],
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

  it('can stretch plain names so parent controls can center them', () => {
    fixture.componentRef.setInput('displayName', 'Finetti');
    fixture.componentRef.setInput('nameStyle', { type: 'plain', presetId: 'plain', textColor: '#ffffff' });
    fixture.componentRef.setInput('fill', true);
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    expect(name.classList.contains('fill')).toBe(true);
    expect(name.classList.contains('has-nameplate')).toBe(false);
  });

  it('can left-align the label inside the player name shell', () => {
    fixture.componentRef.setInput('displayName', 'Finetti');
    fixture.componentRef.setInput('align', 'left');
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    expect(name.classList.contains('align-left')).toBe(true);
  });

  it('scales long display names by length bucket', () => {
    fixture.componentRef.setInput('displayName', 'CommanderZonePilotName25');
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.player-name-shell') as HTMLElement;
    expect(name.classList.contains('name-length-ultra')).toBe(true);
    expect(name.style.getPropertyValue('--player-name-auto-font-size')).toBe('0.44rem');
    expect(name.style.getPropertyValue('--player-name-plain-font-size')).toBe('0.72rem');
    expect(name.getAttribute('title')).toBe('CommanderZonePilotName25');
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
    expect(name.style.getPropertyValue('--player-name-auto-font-size')).toBe('0.82rem');
  });
});
