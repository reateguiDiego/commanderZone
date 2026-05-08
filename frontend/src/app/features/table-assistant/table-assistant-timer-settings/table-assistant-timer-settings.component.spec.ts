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

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.durationPickerOpen()).toBe(false);
  });

  it('caps timer duration at ten minutes', () => {
    const fixture = TestBed.createComponent(TableAssistantTimerSettingsComponent);
    const emittedDurations: number[] = [];
    fixture.componentRef.setInput('timerMode', 'turn');
    fixture.componentRef.setInput('timerDurationSeconds', 600);
    fixture.componentInstance.timerDurationSecondsChange.subscribe((seconds) => emittedDurations.push(seconds));
    fixture.detectChanges();

    fixture.componentInstance.setTimerDurationRemainderSeconds(45);

    expect(emittedDurations[emittedDurations.length - 1]).toBe(600);
  });
});
