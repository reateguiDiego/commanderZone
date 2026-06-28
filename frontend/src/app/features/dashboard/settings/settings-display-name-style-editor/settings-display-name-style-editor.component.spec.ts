import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsDisplayNameStyleEditorComponent } from './settings-display-name-style-editor.component';

describe('SettingsDisplayNameStyleEditorComponent', () => {
  let fixture: ComponentFixture<SettingsDisplayNameStyleEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsDisplayNameStyleEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsDisplayNameStyleEditorComponent);
    fixture.componentRef.setInput('displayName', 'Finetti');
    fixture.componentRef.setInput('nameStyle', { type: 'plain', presetId: 'plain', textColor: '#f8f0d0' });
    fixture.detectChanges();
  });

  it('saves basic nameplates with the selected text color', () => {
    const saved = vi.fn();
    fixture.componentInstance.saveRequested.subscribe(saved);

    const basicGreen = fixture.componentInstance.basicPresets.find((preset) => preset.id === 'basic-green');
    expect(basicGreen).toBeDefined();

    fixture.componentInstance.choosePreset(basicGreen!);
    fixture.componentInstance.updateTextColor('#d7ffd0');
    fixture.componentInstance.save();

    expect(saved).toHaveBeenCalledWith({ presetId: 'basic-green', textColor: '#d7ffd0' });
  });

  it('applies the color picker only to the current selection', () => {
    const basicGreen = fixture.componentInstance.basicPresets.find((preset) => preset.id === 'basic-green');
    const basicBlue = fixture.componentInstance.basicPresets.find((preset) => preset.id === 'basic-blue');
    expect(basicGreen).toBeDefined();
    expect(basicBlue).toBeDefined();

    fixture.componentInstance.choosePreset(basicGreen!);
    fixture.componentInstance.updateTextColor('#d7ffd0');
    fixture.detectChanges();

    const greenOption = fixture.componentInstance.visiblePresetOptions().find((option) => option.preset.id === 'basic-green');
    const blueOption = fixture.componentInstance.visiblePresetOptions().find((option) => option.preset.id === 'basic-blue');

    expect(greenOption?.style.textColor).toBe('#d7ffd0');
    expect(blueOption?.style.textColor).toBe('#f8f0d0');
  });

  it('does not render tooltips inside the editor cards or preview', () => {
    fixture.componentInstance.choosePreset(fixture.componentInstance.basicPresets[0]!);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-tooltip')).toBeNull();

    const playerNames = fixture.nativeElement.querySelectorAll('.player-name-shell') as NodeListOf<HTMLElement>;
    for (const playerName of playerNames) {
      expect(playerName.getAttribute('title')).toBeNull();
    }
  });

  it('saves the plain name style with the selected text color', () => {
    const saved = vi.fn();
    fixture.componentInstance.saveRequested.subscribe(saved);

    const plain = fixture.componentInstance.basicPresets.find((preset) => preset.id === 'plain');
    expect(plain).toBeDefined();

    fixture.componentInstance.choosePreset(plain!);
    fixture.componentInstance.updateTextColor('#ffffff');
    fixture.componentInstance.save();

    expect(saved).toHaveBeenCalledWith({ presetId: 'plain', textColor: '#ffffff' });
  });
});
