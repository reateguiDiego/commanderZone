import { TestBed } from '@angular/core/testing';
import { TableAssistantTimerSettingsComponent } from './table-assistant-timer-settings.component';

describe('TableAssistantTimerSettingsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TableAssistantTimerSettingsComponent],
    }).compileComponents();
  });

  it('closes the compact duration picker when clicking outside', () => {
    const fixture = TestBed.createComponent(TableAssistantTimerSettingsComponent);
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();

    fixture.componentInstance.setTimerMode('turn');
    fixture.detectChanges();
    expect(fixture.componentInstance.durationPickerOpen()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.durationPickerOpen()).toBe(false);
  });

  it('keeps the compact duration picker closed after clicking the active mode outside the wheel', () => {
    const fixture = TestBed.createComponent(TableAssistantTimerSettingsComponent);
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('timerMode', 'turn');
    fixture.componentInstance.durationPickerOpen.set(true);
    fixture.detectChanges();

    const activeModeButton = fixture.nativeElement.querySelector('.segmented-control button.active') as HTMLButtonElement;
    activeModeButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    activeModeButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.durationPickerOpen()).toBe(false);
  });

  it('caps timer duration at thirty minutes', () => {
    const fixture = TestBed.createComponent(TableAssistantTimerSettingsComponent);
    const emittedDurations: number[] = [];
    fixture.componentRef.setInput('timerMode', 'turn');
    fixture.componentRef.setInput('timerDurationSeconds', 1800);
    fixture.componentInstance.timerDurationSecondsChange.subscribe((seconds) => emittedDurations.push(seconds));
    fixture.detectChanges();

    fixture.componentInstance.setTimerDurationRemainderSeconds(45);

    expect(emittedDurations[emittedDurations.length - 1]).toBe(1800);
  });

  it('offers minute values up to thirty minutes', () => {
    const fixture = TestBed.createComponent(TableAssistantTimerSettingsComponent);

    expect(fixture.componentInstance.timerMinuteOptions.at(-1)).toBe(30);
  });
});
