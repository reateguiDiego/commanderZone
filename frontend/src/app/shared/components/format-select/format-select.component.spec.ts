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

  it('renders option flags in the trigger and dropdown', () => {
    fixture.componentRef.setInput('formats', []);
    fixture.componentRef.setInput('options', [
      { id: 'en', name: 'English', flagAsset: '/assets/icons/flags/uk.png' },
      { id: 'fr', name: 'Francais', flagAsset: '/assets/icons/flags/france.png' },
    ]);
    fixture.componentRef.setInput('value', 'en');
    fixture.detectChanges();

    const triggerFlag = fixture.nativeElement.querySelector('.format-select-trigger .format-select-flag') as HTMLImageElement;
    expect(triggerFlag.getAttribute('src')).toContain('uk.png');

    fixture.nativeElement.querySelector('.format-select-trigger').click();
    fixture.detectChanges();

    const optionFlags = fixture.nativeElement.querySelectorAll('.format-select-option .format-select-flag') as NodeListOf<HTMLImageElement>;
    expect(optionFlags).toHaveLength(2);
    expect(optionFlags[1]?.getAttribute('src')).toContain('france.png');
  });

  it('uses the shared visual scroll treatment for the dropdown menu', () => {
    fixture.nativeElement.querySelector('.format-select-trigger').click();
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('.format-select-menu') as HTMLElement | null;

    expect(menu?.classList.contains('app-pretty-scroll')).toBe(true);
  });

  it('marks the host while the dropdown is open', () => {
    fixture.nativeElement.querySelector('.format-select-trigger').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.classList.contains('is-open')).toBe(true);
  });

  it('does not move or mutate scrollable parents while opening the dropdown', () => {
    const scrollParent = document.createElement('div');
    const host = fixture.nativeElement as HTMLElement;
    host.parentElement?.insertBefore(scrollParent, host);
    scrollParent.appendChild(host);
    scrollParent.style.overflowY = 'auto';
    scrollParent.style.paddingBottom = '10px';
    Object.defineProperty(scrollParent, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(scrollParent, 'scrollHeight', { configurable: true, value: 101 });
    scrollParent.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      right: 240,
      bottom: 100,
      left: 0,
      width: 240,
      height: 100,
      toJSON: () => ({}),
    });

    const trigger = fixture.nativeElement.querySelector('.format-select-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    expect(scrollParent.style.paddingBottom).toBe('10px');
    expect(scrollParent.scrollTop).toBe(0);
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
