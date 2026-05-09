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
});
