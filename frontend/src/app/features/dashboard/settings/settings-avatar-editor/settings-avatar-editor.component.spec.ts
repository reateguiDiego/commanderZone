import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ArrowLeft, LucideAngularModule, Upload } from 'lucide-angular';
import { SettingsAvatarEditorComponent } from './settings-avatar-editor.component';

describe('SettingsAvatarEditorComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsAvatarEditorComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ ArrowLeft, Upload }))],
    }).compileComponents();
  });

  it('falls back to the display name initial', () => {
    const fixture = TestBed.createComponent(SettingsAvatarEditorComponent);
    fixture.componentRef.setInput('displayName', 'Player');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.avatar-preview').textContent).toContain('P');
  });

  it('emits a customized initial avatar payload', async () => {
    const fixture = TestBed.createComponent(SettingsAvatarEditorComponent);
    const emitted: unknown[] = [];
    fixture.componentInstance.saveRequested.subscribe((payload) => emitted.push(payload));
    fixture.componentRef.setInput('displayName', 'Player');
    fixture.detectChanges();

    fixture.componentInstance.chooseInitial();
    fixture.componentInstance.updateInitialLetter('cz');
    fixture.componentInstance.updateInitialBackgroundColor('#112233');
    fixture.componentInstance.updateInitialTextColor('#ffeeaa');
    await fixture.componentInstance.save();

    expect(emitted).toEqual([{
      type: 'initial',
      letter: 'CZ',
      backgroundColor: '#112233',
      textColor: '#ffeeaa',
    }]);
  });

  it('keeps initial avatar controls open until explicitly closed', () => {
    const fixture = TestBed.createComponent(SettingsAvatarEditorComponent);
    fixture.componentRef.setInput('displayName', 'Player');
    fixture.detectChanges();

    fixture.componentInstance.chooseInitial();
    fixture.componentInstance.updateInitialLetter('c');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type="text"]')).not.toBeNull();
    expect(fixture.componentInstance.previewInitialLetter()).toBe('C');

    fixture.componentInstance.closeInitialControls();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type="text"]')).toBeNull();
    expect(fixture.componentInstance.previewInitialLetter()).toBe('C');
  });

  it('emits a preset avatar payload', async () => {
    const fixture = TestBed.createComponent(SettingsAvatarEditorComponent);
    const emitted: unknown[] = [];
    fixture.componentInstance.saveRequested.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    fixture.componentInstance.choosePreset(fixture.componentInstance.presetAvatars[1]);
    await fixture.componentInstance.save();

    expect(emitted).toEqual([{ type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' }]);
  });

  it('shows basic and premium avatar tiers without visible preset names', () => {
    const fixture = TestBed.createComponent(SettingsAvatarEditorComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.basicPresetAvatars.length).toBe(10);
    expect(fixture.componentInstance.premiumPresetAvatars.length).toBe(30);
    expect(fixture.nativeElement.textContent).toContain('Basic');
    expect(fixture.nativeElement.textContent).toContain('Premium');
    expect(fixture.nativeElement.textContent).not.toContain('Storm Seer');
  });

  it('shows all premium avatars in the premium tab', () => {
    const fixture = TestBed.createComponent(SettingsAvatarEditorComponent);
    fixture.detectChanges();

    fixture.componentInstance.switchTier('premium');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.premium-avatar').length).toBe(30);
  });

  it('shows the user name as current selection text', () => {
    const fixture = TestBed.createComponent(SettingsAvatarEditorComponent);
    fixture.componentRef.setInput('displayName', 'Commander Pilot');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Commander Pilot');
    expect(fixture.nativeElement.textContent).not.toContain('Current avatar');
  });
});
