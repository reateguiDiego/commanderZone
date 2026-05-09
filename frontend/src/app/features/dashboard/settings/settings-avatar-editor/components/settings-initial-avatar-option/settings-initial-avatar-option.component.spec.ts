import { TestBed } from '@angular/core/testing';
import { SettingsInitialAvatarOptionComponent } from './settings-initial-avatar-option.component';

describe('SettingsInitialAvatarOptionComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsInitialAvatarOptionComponent],
    }).compileComponents();
  });

  it('renders the provided initial letter', () => {
    const fixture = TestBed.createComponent(SettingsInitialAvatarOptionComponent);
    fixture.componentRef.setInput('letter', 'CZ');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('CZ');
  });

  it('shows customization controls when selected', () => {
    const fixture = TestBed.createComponent(SettingsInitialAvatarOptionComponent);
    fixture.componentRef.setInput('selected', true);
    fixture.componentRef.setInput('controlsOpen', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('input[type="color"]').length).toBe(2);
    expect(fixture.nativeElement.querySelector('input[type="text"]')).not.toBeNull();
  });

  it('removes the selected visual state when controls are closed', () => {
    const fixture = TestBed.createComponent(SettingsInitialAvatarOptionComponent);
    fixture.componentRef.setInput('selected', true);
    fixture.componentRef.setInput('controlsOpen', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.initial-avatar-option').classList.contains('selected')).toBe(false);
  });

  it('emits selection when the option section is clicked', () => {
    const fixture = TestBed.createComponent(SettingsInitialAvatarOptionComponent);
    const selected = vi.fn();
    fixture.componentInstance.selectedRequested.subscribe(selected);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.initial-avatar-option').click();

    expect(selected).toHaveBeenCalledOnce();
  });
});
