import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, Minus, Plus } from 'lucide-angular';
import { GameSetupLifeControlComponent } from './game-setup-life-control.component';

describe('GameSetupLifeControlComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameSetupLifeControlComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Minus, Plus }))],
    }).compileComponents();
  });

  it('emits stepped life changes', () => {
    const fixture = TestBed.createComponent(GameSetupLifeControlComponent);
    const emittedValues: number[] = [];

    fixture.componentRef.setInput('value', 40);
    fixture.componentRef.setInput('step', 5);
    fixture.componentInstance.valueChange.subscribe((value) => emittedValues.push(value));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[aria-label="Decrease starting life total"]')?.click();
    fixture.nativeElement.querySelector('[aria-label="Increase starting life total"]')?.click();

    expect(emittedValues).toEqual([35, 45]);
  });

  it('does not emit while disabled', () => {
    const fixture = TestBed.createComponent(GameSetupLifeControlComponent);
    const emittedValues: number[] = [];

    fixture.componentRef.setInput('disabled', true);
    fixture.componentInstance.valueChange.subscribe((value) => emittedValues.push(value));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[aria-label="Increase starting life total"]')?.click();

    expect(emittedValues).toEqual([]);
  });

  it('caps life changes between the configured minimum and maximum', () => {
    const fixture = TestBed.createComponent(GameSetupLifeControlComponent);
    const emittedValues: number[] = [];

    fixture.componentRef.setInput('value', 98);
    fixture.componentRef.setInput('step', 5);
    fixture.componentRef.setInput('minValue', 1);
    fixture.componentRef.setInput('maxValue', 99);
    fixture.componentInstance.valueChange.subscribe((value) => emittedValues.push(value));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[aria-label="Increase starting life total"]')?.click();

    fixture.componentRef.setInput('value', 2);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="Decrease starting life total"]')?.click();

    expect(emittedValues).toEqual([99, 1]);
  });

  it('disables step buttons at the configured bounds', () => {
    const fixture = TestBed.createComponent(GameSetupLifeControlComponent);

    fixture.componentRef.setInput('value', 99);
    fixture.componentRef.setInput('maxValue', 99);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Increase starting life total"]')?.disabled).toBe(true);

    fixture.componentRef.setInput('value', 1);
    fixture.componentRef.setInput('minValue', 1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Decrease starting life total"]')?.disabled).toBe(true);
  });

  it('hides the summary when it is empty', () => {
    const fixture = TestBed.createComponent(GameSetupLifeControlComponent);
    fixture.componentRef.setInput('summary', '');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.control-copy strong')).toBeNull();
  });

  it('emits preset life values', () => {
    const fixture = TestBed.createComponent(GameSetupLifeControlComponent);
    const emittedValues: number[] = [];

    fixture.componentRef.setInput('value', 30);
    fixture.componentRef.setInput('presets', [20, 30, 40, 60]);
    fixture.componentInstance.valueChange.subscribe((value) => emittedValues.push(value));
    fixture.detectChanges();

    const presetButtons = fixture.nativeElement.querySelectorAll('.life-preset-button') as NodeListOf<HTMLButtonElement>;
    presetButtons[2]?.click();

    expect(emittedValues).toEqual([40]);
  });
});
