import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormatSelectComponent } from './format-select.component';

describe('FormatSelectComponent', () => {
  let fixture: ComponentFixture<FormatSelectComponent>;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormatSelectComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FormatSelectComponent);
    fixture.componentRef.setInput('formats', [
      { id: 'commander', name: 'Commander' },
      { id: 'standard', name: 'Standard' },
    ]);
    fixture.detectChanges();
  });

  it('closes the dropdown when the user clicks outside', () => {
    vi.useFakeTimers();
    const trigger = fixture.nativeElement.querySelector('.format-select-trigger') as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.format-select-menu')).not.toBeNull();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.format-select-menu.is-closing')).not.toBeNull();

    vi.advanceTimersByTime(170);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.format-select-menu')).toBeNull();
    vi.useRealTimers();
  });

  it('renders generic options and emits selected values', () => {
    const selectedValues: string[] = [];
    fixture.componentRef.setInput('formats', []);
    fixture.componentRef.setInput('options', [
      { id: 'all', name: 'All decks' },
      { id: 'public', labelKey: 'Public decks' },
    ]);
    fixture.componentRef.setInput('value', 'all');
    fixture.componentInstance.valueChange.subscribe((value) => selectedValues.push(value));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.format-select-trigger').click();
    fixture.detectChanges();
    const options = Array.from(fixture.nativeElement.querySelectorAll('.format-select-option')) as HTMLElement[];
    options[1]?.click();

    expect(options.map((option) => option.textContent?.trim())).toEqual(['All decks', 'Public decks']);
    expect(selectedValues).toEqual(['public']);
  });

  it('does not emit disabled options', () => {
    const selectedValues: string[] = [];
    fixture.componentRef.setInput('formats', []);
    fixture.componentRef.setInput('options', [
      { id: 'available', name: 'Available' },
      { id: 'locked', name: 'Locked', disabled: true },
    ]);
    fixture.componentInstance.valueChange.subscribe((value) => selectedValues.push(value));
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.format-select-trigger').click();
    fixture.detectChanges();
    const lockedOption = fixture.nativeElement.querySelector('.format-select-option.is-disabled') as HTMLButtonElement;
    lockedOption.click();

    expect(lockedOption.disabled).toBe(true);
    expect(selectedValues).toEqual([]);
  });

  it('uses the exit animation state before removing the menu', () => {
    vi.useFakeTimers();
    const trigger = fixture.nativeElement.querySelector('.format-select-trigger') as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    trigger.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.format-select-menu.is-closing')).not.toBeNull();

    vi.advanceTimersByTime(170);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.format-select-menu')).toBeNull();
    vi.useRealTimers();
  });
});
