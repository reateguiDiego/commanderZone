import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeviceProfileService } from '../../../../../shared/services/device-profile.service';
import { WaitingRoomLogPanelComponent } from './waiting-room-log-panel.component';

describe('WaitingRoomLogPanelComponent', () => {
  let fixture: ComponentFixture<WaitingRoomLogPanelComponent>;
  const isMobileLayout = signal(true);

  beforeEach(async () => {
    isMobileLayout.set(true);
    await TestBed.configureTestingModule({
      imports: [WaitingRoomLogPanelComponent],
      providers: [{ provide: DeviceProfileService, useValue: { isMobileLayout } }],
    }).compileComponents();

    fixture = TestBed.createComponent(WaitingRoomLogPanelComponent);
    fixture.componentRef.setInput('entries', [{
      id: 'entry-1',
      label: 'Player joined the room',
      createdAt: '2026-09-25T10:00:00Z',
    }]);
    fixture.detectChanges();
  });

  it('keeps Activity collapsed by default on mobile and expands it on demand', () => {
    const activityToggle = fixture.nativeElement.querySelector('.activity-toggle') as HTMLButtonElement;

    expect(activityToggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.room-log')).toBeNull();

    activityToggle.click();
    fixture.detectChanges();

    expect(activityToggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('.room-log')).not.toBeNull();
  });

  it('reserves the log panel space without showing Activity when there are no entries', () => {
    fixture.componentRef.setInput('entries', []);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.room-log-panel') as HTMLElement;

    expect(panel.classList).toContain('is-empty');
    expect(panel.textContent).not.toContain('Room events will appear here');
  });
});
