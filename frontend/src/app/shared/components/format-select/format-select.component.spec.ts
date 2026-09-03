import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MobileViewportSyncService } from '../../services/mobile-viewport-sync.service';
import { FormatSelectComponent } from './format-select.component';

describe('FormatSelectComponent', () => {
  let fixture: ComponentFixture<FormatSelectComponent>;
  const mobileViewportSync = { syncAfterSharedSelectChange: vi.fn() };

  afterEach(() => {
    vi.useRealTimers();
    mobileViewportSync.syncAfterSharedSelectChange.mockReset();
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormatSelectComponent],
      providers: [{ provide: MobileViewportSyncService, useValue: mobileViewportSync }],
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
    expect(mobileViewportSync.syncAfterSharedSelectChange).toHaveBeenCalledTimes(1);
  });

  it('filters options only when search is explicitly enabled', async () => {
    fixture.componentRef.setInput('formats', []);
    fixture.componentRef.setInput('options', [
      { id: 'one', name: 'Áurea', searchText: 'aurea@example.test' },
      { id: 'two', name: 'Boros', searchText: 'boros@example.test' },
    ]);
    fixture.componentRef.setInput('searchable', true);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.format-select-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const searchInput = fixture.nativeElement.querySelector('.format-select-search-input') as HTMLInputElement;
    expect(searchInput).not.toBeNull();
    expect(document.activeElement).toBe(searchInput);

    searchInput.value = 'aurea@example.test';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const options = Array.from(fixture.nativeElement.querySelectorAll('.format-select-option')) as HTMLElement[];
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Áurea']);
  });

  it('does not render a search input by default', () => {
    fixture.nativeElement.querySelector('.format-select-trigger').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.format-select-search-input')).toBeNull();
  });

  it('returns focus to the trigger before hiding the dropdown menu', () => {
    fixture.nativeElement.querySelector('.format-select-trigger').click();
    fixture.detectChanges();
    const option = fixture.nativeElement.querySelector('.format-select-option') as HTMLButtonElement;
    const trigger = fixture.nativeElement.querySelector('.format-select-trigger') as HTMLButtonElement;
    option.focus();

    fixture.componentInstance.closeDropdown();

    expect(document.activeElement).toBe(trigger);
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

});
