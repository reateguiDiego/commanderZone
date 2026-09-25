import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Globe, Lock, LucideAngularModule, Minus, Plus, X } from 'lucide-angular';
import { GameSetupLifeControlComponent } from '../../../../shared/components/game-setup-life-control/game-setup-life-control.component';
import { RoomSetupModalComponent, type RoomSetupUpdatePayload } from './room-setup-modal.component';

describe('RoomSetupModalComponent', () => {
  let fixture: ComponentFixture<RoomSetupModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoomSetupModalComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Globe, Lock, Minus, Plus, X })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RoomSetupModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('mode', 'create');
    fixture.componentRef.setInput('formats', [
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
      { id: 'standard', name: 'Standard', minCards: 60, maxCards: 60, hasCommander: false },
    ]);
    fixture.detectChanges();
  });

  it('defaults Commander rooms to London with a free first mulligan', () => {
    expect(fixture.componentInstance.createFormat()).toBe('commander');
    expect(fixture.componentInstance.createMulliganRule()).toBe('LONDON');
    expect(fixture.componentInstance.createFirstMulliganFree()).toBe(true);
  });

  it('defaults new rooms to public privacy', () => {
    expect(fixture.componentInstance.createRoomForm.controls.privacy.value).toBe('public');
  });

  it('uses the 1–99 life slider with Commander quick values when creating a room', () => {
    const lifeControl = fixture.debugElement
      .query(By.directive(GameSetupLifeControlComponent))
      .componentInstance as GameSetupLifeControlComponent;

    expect(lifeControl.mode()).toBe('slider');
    expect(lifeControl.minValue()).toBe(1);
    expect(lifeControl.maxValue()).toBe(99);
    expect(lifeControl.presets()).toEqual([20, 40, 60]);
    expect(lifeControl.sliderHints()).toEqual([1, 20, 40, 60, 80, 99]);
    expect(lifeControl.sliderSnapValues()).toEqual([20, 40, 60]);
  });

  it('uses the same life slider when editing a waiting room', () => {
    fixture.componentRef.setInput('mode', 'edit');
    fixture.detectChanges();

    const lifeControl = fixture.debugElement
      .query(By.directive(GameSetupLifeControlComponent))
      .componentInstance as GameSetupLifeControlComponent;

    expect(lifeControl.mode()).toBe('slider');
    expect(lifeControl.minValue()).toBe(1);
    expect(lifeControl.maxValue()).toBe(99);
    expect(lifeControl.presets()).toEqual([20, 40, 60]);
    expect(lifeControl.sliderHints()).toEqual([1, 20, 40, 60, 80, 99]);
    expect(lifeControl.sliderSnapValues()).toEqual([20, 40, 60]);
  });

  it('labels the timer as coming soon in create and waiting-room setup', () => {
    expect(fixture.nativeElement.querySelector('.timer-coming-soon')?.textContent).toContain('Coming soon');

    fixture.componentRef.setInput('mode', 'edit');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.timer-coming-soon')?.textContent).toContain('Coming soon');
  });

  it('enables Done only after changing the waiting-room setup and emits only those changes', () => {
    fixture.componentRef.setInput('mode', 'edit');
    fixture.detectChanges();
    const updates: RoomSetupUpdatePayload[] = [];
    fixture.componentInstance.updateRequested.subscribe((update) => updates.push(update));

    const doneButton = fixture.nativeElement.querySelector('.modal-panel footer .primary-button') as HTMLButtonElement;
    expect(doneButton.disabled).toBe(true);

    fixture.componentInstance.editStartingLife.set(41);
    fixture.detectChanges();

    expect(doneButton.disabled).toBe(false);
    doneButton.click();

    expect(updates).toEqual([{ startingLife: 41 }]);
  });

  it('groups create-room settings into two full-width configuration columns', () => {
    const columns = fixture.nativeElement.querySelectorAll('.setup-modal-column') as NodeListOf<HTMLElement>;

    expect(columns.length).toBe(2);
    expect(columns[0].querySelectorAll('.setup-modal-section').length).toBe(4);
    expect(columns[1].querySelectorAll('.setup-modal-section').length).toBe(4);
  });

  it('provides split create actions and a danger close button', () => {
    let closeCount = 0;
    fixture.componentInstance.closed.subscribe(() => closeCount++);

    const footer = fixture.nativeElement.querySelector('.modal-panel footer') as HTMLElement;
    const closeButton = fixture.nativeElement.querySelector('.modal-close-button') as HTMLButtonElement;
    const footerButtons = footer.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;

    expect(footer.classList).toContain('split-actions');
    expect(footerButtons[0].classList).toContain('secondary-button');
    expect(footerButtons[1].classList).toContain('primary-button');

    closeButton.click();

    expect(closeCount).toBe(1);
  });

  it('defaults non-Commander rooms to no free first mulligan', () => {
    fixture.componentInstance.changeCreateFormat('standard');

    expect(fixture.componentInstance.createMulliganRule()).toBe('LONDON');
    expect(fixture.componentInstance.createFirstMulliganFree()).toBe(false);
  });

  it('does not overwrite a manually changed free-mulligan checkbox when the format changes', () => {
    fixture.componentInstance.changeCreateFirstMulliganFree(true);
    fixture.componentInstance.changeCreateFormat('standard');

    expect(fixture.componentInstance.createFirstMulliganFree()).toBe(true);
  });

  it('toggles the free first mulligan from the setup button', () => {
    const button = fixture.nativeElement.querySelector('[role="switch"]') as HTMLButtonElement;

    expect(button.getAttribute('aria-checked')).toBe('true');

    button.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.createFirstMulliganFree()).toBe(false);
    expect(button.getAttribute('aria-checked')).toBe('false');
  });

  it('renders a localized description for every mulligan rule', () => {
    const descriptions = {
      LONDON: 'Draw 7 cards every time.',
      VANCOUVER: 'Each effective mulligan draws one fewer card.',
      PARIS: 'Each effective mulligan draws one fewer card.',
      GENEROUS: 'Commander-friendly rule:',
    } as const;

    for (const [rule, description] of Object.entries(descriptions)) {
      fixture.componentInstance.changeCreateMulliganRule(rule);
      fixture.detectChanges();

      const mulliganDescription = fixture.nativeElement.querySelector('.mulligan-description') as HTMLElement;
      expect(mulliganDescription.textContent).toContain(description);
      expect(mulliganDescription.textContent).not.toContain('shared.text.mulliganDescriptions');
    }
  });
});
