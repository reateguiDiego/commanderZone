import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PowerToughnessDialogComponent } from './power-toughness-dialog.component';

describe('PowerToughnessDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PowerToughnessDialogComponent],
    }).compileComponents();
  });

  it('emits stat changes and disables apply while invalid', () => {
    const fixture = renderDialog({ invalid: true });
    const changed = vi.fn();
    fixture.componentInstance.valueChanged.subscribe(changed);

    const powerInput = fixture.nativeElement.querySelector('[data-testid="power-input"]') as HTMLInputElement;
    powerInput.value = '4';
    powerInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const applyButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Apply')) as HTMLButtonElement;

    expect(changed).toHaveBeenCalledWith({ stat: 'power', value: '4' });
    expect(applyButton.disabled).toBe(true);
  });
});

function renderDialog(options: { invalid?: boolean } = {}): ComponentFixture<PowerToughnessDialogComponent> {
  const fixture = TestBed.createComponent(PowerToughnessDialogComponent);
  fixture.componentRef.setInput('cardName', 'Sol Ring');
  fixture.componentRef.setInput('power', '0');
  fixture.componentRef.setInput('toughness', '0');
  fixture.componentRef.setInput('invalid', options.invalid ?? false);
  fixture.detectChanges();
  return fixture;
}
