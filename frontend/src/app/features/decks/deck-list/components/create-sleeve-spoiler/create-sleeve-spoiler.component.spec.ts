import { TestBed } from '@angular/core/testing';
import { CreateSleeveSpoilerComponent, DEFAULT_SLEEVE_PATH, SLEEVE_OPTIONS } from './create-sleeve-spoiler.component';

describe('CreateSleeveSpoilerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateSleeveSpoilerComponent],
    }).compileComponents();
  });

  it('renders every configured sleeve with lazy async images', () => {
    const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
    fixture.componentRef.setInput('selectedSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.detectChanges();

    const images = fixture.nativeElement.querySelectorAll('.create-sleeve-option-image') as NodeListOf<HTMLImageElement>;
    const premiumPills = fixture.nativeElement.querySelectorAll('.create-sleeve-option-pill:not(.create-sleeve-option-pill--combination)') as NodeListOf<HTMLElement>;
    const combinationPills = fixture.nativeElement.querySelectorAll('.create-sleeve-option-pill--combination') as NodeListOf<HTMLElement>;
    const combinationOptions = SLEEVE_OPTIONS.filter((sleeve) => sleeve.category === 'combination');

    expect(images.length).toBe(SLEEVE_OPTIONS.length);
    expect(SLEEVE_OPTIONS[0].path).toBe(DEFAULT_SLEEVE_PATH);
    expect(SLEEVE_OPTIONS[0].premium).toBe(false);
    expect(SLEEVE_OPTIONS[0].combinationName).toBeUndefined();
    expect(images[0].getAttribute('src')).toBe(DEFAULT_SLEEVE_PATH);
    expect(images[0].getAttribute('loading')).toBe('lazy');
    expect(images[0].getAttribute('decoding')).toBe('async');
    expect(premiumPills.length).toBe(SLEEVE_OPTIONS.length - 1);
    expect(premiumPills[0].textContent?.trim()).toBe('Premium');
    expect(combinationPills.length).toBe(combinationOptions.length);
    expect(combinationOptions[0]?.combinationName).toBe('Azorius');
    expect(Array.from(combinationPills).map((pill) => pill.textContent?.trim())).toContain('Azorius');
    expect(SLEEVE_OPTIONS[1].fileName).toBe('w_0.webp');
    expect(SLEEVE_OPTIONS[13].fileName).toBe('u_0.webp');
  });

  it('filters mono and combination sleeves by Magic color', () => {
    const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
    fixture.componentRef.setInput('selectedSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.detectChanges();

    fixture.componentInstance.setColorFilter('W');
    fixture.detectChanges();

    const imageSources = Array.from(
      fixture.nativeElement.querySelectorAll('.create-sleeve-option-image') as NodeListOf<HTMLImageElement>,
    ).map((image) => image.getAttribute('src'));

    expect(imageSources).toContain('/assets/images/sleeves/w_0.webp');
    expect(imageSources).toContain('/assets/images/sleeves/azorius_1.webp');
    expect(imageSources).toContain('/assets/images/sleeves/penta_1.webp');
    expect(imageSources).not.toContain('/assets/images/sleeves/u_0.webp');
  });

  it('marks the selected sleeve and emits when another sleeve is selected', () => {
    const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
    const selected = SLEEVE_OPTIONS[1];
    const next = SLEEVE_OPTIONS[2];
    const emitted: string[] = [];
    fixture.componentRef.setInput('selectedSleevePath', selected.path);
    fixture.componentInstance.sleeveSelected.subscribe((path) => emitted.push(path));
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.create-sleeve-option') as NodeListOf<HTMLButtonElement>;

    expect(buttons[1].classList.contains('is-selected')).toBe(true);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');

    buttons[2].click();

    expect(emitted).toEqual([next.path]);
  });

  it('debounces the sleeve hover preview and hides it when the pointer leaves', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
      fixture.componentRef.setInput('selectedSleevePath', DEFAULT_SLEEVE_PATH);
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

  it('emits save from the footer action', () => {
    const fixture = TestBed.createComponent(CreateSleeveSpoilerComponent);
    const saveEvents: void[] = [];
    fixture.componentRef.setInput('selectedSleevePath', DEFAULT_SLEEVE_PATH);
    fixture.componentInstance.save.subscribe(() => saveEvents.push(undefined));
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.create-sleeve-spoiler-actions button') as NodeListOf<HTMLButtonElement>,
    );

    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Save']);

    buttons[0].click();

    expect(saveEvents.length).toBe(1);
  });
});
