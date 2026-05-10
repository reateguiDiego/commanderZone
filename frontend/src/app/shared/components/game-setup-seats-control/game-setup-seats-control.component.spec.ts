import { TestBed } from '@angular/core/testing';
import { GameSetupSeatsControlComponent } from './game-setup-seats-control.component';

describe('GameSetupSeatsControlComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameSetupSeatsControlComponent],
    }).compileComponents();
  });

  it('emits selected seat count when allowed', () => {
    const fixture = TestBed.createComponent(GameSetupSeatsControlComponent);
    const emittedValues: number[] = [];

    fixture.componentRef.setInput('options', [2, 3, 4]);
    fixture.componentInstance.valueChange.subscribe((value) => emittedValues.push(value));
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    buttons[2].click();

    expect(emittedValues).toEqual([4]);
  });

  it('disables options below the minimum value', () => {
    const fixture = TestBed.createComponent(GameSetupSeatsControlComponent);

    fixture.componentRef.setInput('options', [2, 3, 4]);
    fixture.componentRef.setInput('minimumValue', 3);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;

    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);
  });
});
