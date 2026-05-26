import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChevronDown, ChevronUp, LucideAngularModule } from 'lucide-angular';
import { NumberActionDialogComponent } from './number-action-dialog.component';

describe('NumberActionDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NumberActionDialogComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronUp }))],
    }).compileComponents();
  });

  it('emits the numeric value from a native form submit', async () => {
    const fixture = createFixture();
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('[data-testid="number-action-input"]') as HTMLInputElement;
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);

    expect(confirmed).toHaveBeenCalledWith(3);
    expect(submitEvent.defaultPrevented).toBe(true);
  });

  it('adjusts the value with premium stepper buttons and keeps the confirm action primary', () => {
    const fixture = createFixture();
    fixture.componentRef.setInput('min', 1);
    fixture.componentRef.setInput('max', 3);
    fixture.componentRef.setInput('defaultValue', 2);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('[data-testid="number-action-input"]') as HTMLInputElement;
    const increase = fixture.nativeElement.querySelector('[data-testid="number-action-increase"]') as HTMLButtonElement;
    const decrease = fixture.nativeElement.querySelector('[data-testid="number-action-decrease"]') as HTMLButtonElement;
    const confirm = fixture.nativeElement.querySelector('[data-testid="number-action-confirm"]') as HTMLButtonElement;

    expect(confirm.classList.contains('primary-action')).toBe(true);

    increase.click();
    fixture.detectChanges();

    expect(input.value).toBe('3');
    expect(increase.disabled).toBe(true);

    decrease.click();
    fixture.detectChanges();

    expect(input.value).toBe('2');
    expect(increase.disabled).toBe(false);
  });
});

function createFixture(): ComponentFixture<NumberActionDialogComponent> {
  const fixture = TestBed.createComponent(NumberActionDialogComponent);
  fixture.componentRef.setInput('title', 'Draw cards');
  fixture.componentRef.setInput('description', 'Choose how many cards to draw.');
  fixture.componentRef.setInput('min', 1);
  fixture.componentRef.setInput('max', null);
  fixture.componentRef.setInput('defaultValue', 1);
  fixture.componentRef.setInput('confirmLabel', 'Draw');

  return fixture;
}
