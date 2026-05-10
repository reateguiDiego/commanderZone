import { TestBed } from '@angular/core/testing';
import { GameSetupLifeControlComponent } from './game-setup-life-control.component';

describe('GameSetupLifeControlComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameSetupLifeControlComponent],
    }).compileComponents();
  });

  it('emits stepped life changes', () => {
    const fixture = TestBed.createComponent(GameSetupLifeControlComponent);
    const emittedValues: number[] = [];

    fixture.componentRef.setInput('value', 40);
    fixture.componentRef.setInput('step', 5);
    fixture.componentInstance.valueChange.subscribe((value) => emittedValues.push(value));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[aria-label="Decrease starting life"]')?.click();
    fixture.nativeElement.querySelector('[aria-label="Increase starting life"]')?.click();

    expect(emittedValues).toEqual([35, 45]);
  });

  it('does not emit while disabled', () => {
    const fixture = TestBed.createComponent(GameSetupLifeControlComponent);
    const emittedValues: number[] = [];

    fixture.componentRef.setInput('disabled', true);
    fixture.componentInstance.valueChange.subscribe((value) => emittedValues.push(value));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[aria-label="Increase starting life"]')?.click();

    expect(emittedValues).toEqual([]);
  });
});
