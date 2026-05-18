import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NumberActionDialogComponent } from './number-action-dialog.component';

describe('NumberActionDialogComponent', () => {
  it('emits the numeric value from a native form submit', async () => {
    await TestBed.configureTestingModule({
      imports: [NumberActionDialogComponent],
    }).compileComponents();
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
