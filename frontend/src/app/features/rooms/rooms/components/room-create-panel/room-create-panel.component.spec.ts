import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, Plus, Search } from 'lucide-angular';
import { RoomCreatePanelComponent } from './room-create-panel.component';

describe('RoomCreatePanelComponent', () => {
  let fixture: ComponentFixture<RoomCreatePanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoomCreatePanelComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Plus, Search })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RoomCreatePanelComponent);
    fixture.detectChanges();
  });

  it('opens the room code input before requiring a valid code', () => {
    const button = joinCodeButton();

    expect(button.disabled).toBe(false);

    button.click();
    fixture.detectChanges();

    expect(roomCodeInput()).not.toBeNull();
    expect(joinCodeButton().disabled).toBe(true);
  });

  it('keeps the join button disabled while the visible code is invalid', () => {
    joinCodeButton().click();
    fixture.detectChanges();

    roomCodeInput().value = 'not-a-room-code';
    roomCodeInput().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(joinCodeButton().disabled).toBe(true);
    expect(roomCodeInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('emits a normalized room code when the visible code is valid', () => {
    const emittedCodes: string[] = [];
    fixture.componentInstance.codeJoinRequested.subscribe((code) => emittedCodes.push(code));

    joinCodeButton().click();
    fixture.detectChanges();

    roomCodeInput().value = 'abc123def';
    roomCodeInput().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    joinCodeButton().click();

    expect(joinCodeButton().disabled).toBe(false);
    expect(emittedCodes).toEqual(['CZ-ABC-123-DEF']);
  });

  it('does not open the code input while actions are locked', () => {
    fixture.componentRef.setInput('actionsLocked', true);
    fixture.detectChanges();

    joinCodeButton().click();
    fixture.detectChanges();

    expect(joinCodeButton().disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('input[name="roomCode"]')).toBeNull();
  });

  function joinCodeButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.room-code-card button') as HTMLButtonElement;
  }

  function roomCodeInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input[name="roomCode"]') as HTMLInputElement;
  }
});
