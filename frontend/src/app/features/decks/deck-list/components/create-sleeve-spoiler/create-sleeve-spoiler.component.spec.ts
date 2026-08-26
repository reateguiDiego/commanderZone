import { TestBed } from '@angular/core/testing';
import { CreateSleeveSpoilerComponent, DEFAULT_SLEEVE_PATH, SLEEVE_OPTIONS, sleevePathFromName } from './create-sleeve-spoiler.component';

describe('CreateSleeveSpoilerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateSleeveSpoilerComponent],
    }).compileComponents();
  });

  it('falls back to the default sleeve for unavailable persisted assets', () => {
    expect(SLEEVE_OPTIONS.some((sleeve) => sleeve.fileName === 'o_12.webp')).toBe(false);
    expect(sleevePathFromName('o_12')).toBe(DEFAULT_SLEEVE_PATH);
  });

  it('renders the free sleeve tier by default with lazy async images', () => {
    const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
    fixture.componentRef.setInput('selectedSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.componentRef.setInput('initialSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.detectChanges();

    const images = fixture.nativeElement.querySelectorAll('.create-sleeve-option-image') as NodeListOf<HTMLImageElement>;
    const premiumPills = fixture.nativeElement.querySelectorAll('.create-sleeve-option-pill:not(.create-sleeve-option-pill--combination)') as NodeListOf<HTMLElement>;
    const combinationPills = fixture.nativeElement.querySelectorAll('.create-sleeve-option-pill--combination') as NodeListOf<HTMLElement>;
    const freeSleeves = SLEEVE_OPTIONS.filter((sleeve) => !sleeve.premium);
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.create-sleeve-tier-tabs [role="tab"]') as NodeListOf<HTMLButtonElement>);

    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Free', 'Premium']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(images.length).toBe(freeSleeves.length);
    expect(SLEEVE_OPTIONS[0].path).toBe(DEFAULT_SLEEVE_PATH);
    expect(SLEEVE_OPTIONS[0].premium).toBe(false);
    expect(SLEEVE_OPTIONS[0].combinationName).toBeUndefined();
    expect(images[0].getAttribute('src')).toBe(DEFAULT_SLEEVE_PATH);
    expect(images[0].getAttribute('loading')).toBe('lazy');
    expect(images[0].getAttribute('decoding')).toBe('async');
    expect(premiumPills.length).toBe(0);
    expect(combinationPills.length).toBe(0);
    expect(SLEEVE_OPTIONS[1].fileName).toBe('w_0.webp');
    expect(SLEEVE_OPTIONS[13].fileName).toBe('u_0.webp');
  });

  it('switches to the premium sleeve tier using the shared tabs', () => {
    const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
    fixture.componentRef.setInput('selectedSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.componentRef.setInput('initialSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.detectChanges();

    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.create-sleeve-tier-tabs [role="tab"]') as NodeListOf<HTMLButtonElement>);
    tabs[1].click();
    fixture.detectChanges();

    const images = fixture.nativeElement.querySelectorAll('.create-sleeve-option-image') as NodeListOf<HTMLImageElement>;
    const premiumPills = fixture.nativeElement.querySelectorAll('.create-sleeve-option-pill--premium') as NodeListOf<HTMLElement>;
    const combinationPills = fixture.nativeElement.querySelectorAll('.create-sleeve-option-pill--combination') as NodeListOf<HTMLElement>;
    const premiumSleeves = SLEEVE_OPTIONS.filter((sleeve) => sleeve.premium);

    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(images.length).toBe(premiumSleeves.length);
    expect(images[0].getAttribute('src')).toBe(premiumSleeves[0].path);
    expect(premiumPills.length).toBe(premiumSleeves.length);
    expect(combinationPills.length).toBe(premiumSleeves.filter((sleeve) => sleeve.combinationName).length);
    expect(Array.from(combinationPills).map((pill) => pill.textContent?.trim())).toContain('Azorius');
  });

  it('marks the selected sleeve and emits when another sleeve is selected', () => {
    const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
    const selected = SLEEVE_OPTIONS[1];
    const next = SLEEVE_OPTIONS[2];
    const emitted: string[] = [];
    fixture.componentRef.setInput('selectedSleevePath', selected.path);
    fixture.componentRef.setInput('initialSleevePath', selected.path);
    fixture.componentInstance.sleeveSelected.subscribe((path) => emitted.push(path));
    fixture.detectChanges();
    fixture.componentInstance.switchTierFromList('premium');
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.create-sleeve-option') as NodeListOf<HTMLButtonElement>;

    expect(buttons[0].classList.contains('is-selected')).toBe(true);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');

    buttons[1].click();

    expect(emitted).toEqual([next.path]);
  });

  it('debounces the sleeve hover preview and hides it when the pointer leaves', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
      fixture.componentRef.setInput('selectedSleevePath', DEFAULT_SLEEVE_PATH);
      fixture.componentRef.setInput('initialSleevePath', DEFAULT_SLEEVE_PATH);
      fixture.detectChanges();

      const option = fixture.nativeElement.querySelector('.create-sleeve-option') as HTMLButtonElement;
      option.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 160 }));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.create-sleeve-hover-preview')).toBeNull();

      option.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      vi.advanceTimersByTime(180);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.create-sleeve-hover-preview')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the debounced sleeve hover preview and hides it on click', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
      fixture.componentRef.setInput('selectedSleevePath', DEFAULT_SLEEVE_PATH);
      fixture.componentRef.setInput('initialSleevePath', DEFAULT_SLEEVE_PATH);
      fixture.detectChanges();

      const option = fixture.nativeElement.querySelector('.create-sleeve-option') as HTMLButtonElement;
      option.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 160 }));
      vi.advanceTimersByTime(180);
      fixture.detectChanges();

      const preview = fixture.nativeElement.querySelector('.create-sleeve-hover-preview') as HTMLElement | null;
      const image = preview?.querySelector('img') as HTMLImageElement | null;
      expect(preview).not.toBeNull();
      expect(image?.getAttribute('src')).toBe(DEFAULT_SLEEVE_PATH);

      option.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.create-sleeve-hover-preview')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps save disabled while the selected sleeve matches the initial sleeve', () => {
    const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
    const saveEvents: void[] = [];
    fixture.componentRef.setInput('selectedSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.componentRef.setInput('initialSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.componentInstance.save.subscribe(() => saveEvents.push(undefined));
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector('.create-sleeve-spoiler-actions button') as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);

    fixture.componentInstance.saveSelection();

    expect(saveEvents.length).toBe(0);
  });

  it('enables selection and emits from the footer action when the selected sleeve changed', () => {
    const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
    const saveEvents: void[] = [];
    fixture.componentRef.setInput('selectedSleevePath', SLEEVE_OPTIONS[1].path);
    fixture.componentRef.setInput('initialSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.componentInstance.save.subscribe(() => saveEvents.push(undefined));
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.create-sleeve-spoiler-actions button') as NodeListOf<HTMLButtonElement>,
    );

    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Select']);
    expect(buttons[0].disabled).toBe(false);

    buttons[0].click();

    expect(saveEvents.length).toBe(1);
  });
});
