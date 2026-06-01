import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChevronDown, ChevronUp, LucideAngularModule } from 'lucide-angular';
import { GameXQuantityStepperComponent } from './game-x-quantity-stepper.component';

describe('GameXQuantityStepperComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameXQuantityStepperComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronUp }))],
    }).compileComponents();
  });

  it('emits clamped quantity changes', () => {
    const fixture = createFixture(2, 1, 3);
    const changes: number[] = [];
    fixture.componentInstance.valueChanged.subscribe((value) => changes.push(value));

    input(fixture).value = '8';
    input(fixture).dispatchEvent(new Event('input'));
    fixture.nativeElement.querySelector('[aria-label="Decrease value"]')?.click();

    expect(changes).toEqual([3, 1]);
  });

  it('disables controls at configured limits', () => {
    const fixture = createFixture(1, 1, 3);

    expect(button(fixture, 'Decrease value').disabled).toBe(true);
    expect(button(fixture, 'Increase value').disabled).toBe(false);
  });
});

function createFixture(value: number, min: number, max: number): ComponentFixture<GameXQuantityStepperComponent> {
  const fixture = TestBed.createComponent(GameXQuantityStepperComponent);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('min', min);
  fixture.componentRef.setInput('max', max);
  fixture.detectChanges();

  return fixture;
}

function input(fixture: ComponentFixture<GameXQuantityStepperComponent>): HTMLInputElement {
  return fixture.nativeElement.querySelector('input') as HTMLInputElement;
}

function button(fixture: ComponentFixture<GameXQuantityStepperComponent>, label: string): HTMLButtonElement {
  return fixture.nativeElement.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
}
