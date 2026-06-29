import { TestBed } from '@angular/core/testing';
import { CreatePlaymatSpoilerComponent, DEFAULT_PLAYMAT_PATH, PLAYMAT_OPTIONS } from './create-playmat-spoiler.component';

describe('CreatePlaymatSpoilerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreatePlaymatSpoilerComponent],
    }).compileComponents();
  });

  it('renders the free tier by default with lazy async images', () => {
    const fixture = TestBed.createComponent(CreatePlaymatSpoilerComponent);
    fixture.componentRef.setInput('selectedPlaymatPath', DEFAULT_PLAYMAT_PATH);
    fixture.componentRef.setInput('initialPlaymatPath', DEFAULT_PLAYMAT_PATH);
    fixture.detectChanges();

    const images = fixture.nativeElement.querySelectorAll('.create-playmat-option-image') as NodeListOf<HTMLImageElement>;
    const combinationPills = fixture.nativeElement.querySelectorAll('.create-playmat-option-pill--combination') as NodeListOf<HTMLElement>;
    const premiumPills = fixture.nativeElement.querySelectorAll('.create-playmat-option-pill--premium') as NodeListOf<HTMLElement>;
    const freePlaymats = PLAYMAT_OPTIONS.filter((playmat) => !playmat.premium);
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.create-playmat-tier-tabs [role="tab"]') as NodeListOf<HTMLButtonElement>);

    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Gratis', 'Premium']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(images.length).toBe(freePlaymats.length);
    expect(PLAYMAT_OPTIONS[0].path).toBe(DEFAULT_PLAYMAT_PATH);
    expect(PLAYMAT_OPTIONS[0].premium).toBe(false);
    expect(images[0].getAttribute('src')).toBe(DEFAULT_PLAYMAT_PATH);
    expect(images[0].getAttribute('loading')).toBe('lazy');
    expect(images[0].getAttribute('decoding')).toBe('async');
    expect(combinationPills.length).toBe(0);
    expect(premiumPills.length).toBe(0);
  });

  it('switches to the premium tier using the shared tabs', () => {
    const fixture = TestBed.createComponent(CreatePlaymatSpoilerComponent);
    fixture.componentRef.setInput('selectedPlaymatPath', DEFAULT_PLAYMAT_PATH);
    fixture.componentRef.setInput('initialPlaymatPath', DEFAULT_PLAYMAT_PATH);
    fixture.detectChanges();

    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.create-playmat-tier-tabs [role="tab"]') as NodeListOf<HTMLButtonElement>);
    tabs[1].click();
    fixture.detectChanges();

    const images = fixture.nativeElement.querySelectorAll('.create-playmat-option-image') as NodeListOf<HTMLImageElement>;
    const combinationPills = fixture.nativeElement.querySelectorAll('.create-playmat-option-pill--combination') as NodeListOf<HTMLElement>;
    const premiumPills = fixture.nativeElement.querySelectorAll('.create-playmat-option-pill--premium') as NodeListOf<HTMLElement>;
    const premiumPlaymats = PLAYMAT_OPTIONS.filter((playmat) => playmat.premium);

    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(images.length).toBe(premiumPlaymats.length);
    expect(images[0].getAttribute('src')).toBe(premiumPlaymats[0].path);
    expect(combinationPills.length).toBe(premiumPlaymats.filter((playmat) => playmat.combinationLabel).length);
    expect(premiumPills.length).toBe(premiumPlaymats.length);
    expect(premiumPills[0].textContent?.trim()).toBe('Premium');
  });

  it('marks the selected playmat and emits when another playmat is selected', () => {
    const fixture = TestBed.createComponent(CreatePlaymatSpoilerComponent);
    const freePlaymats = PLAYMAT_OPTIONS.filter((playmat) => !playmat.premium);
    const selected = freePlaymats[0];
    const next = freePlaymats[1];
    const emitted: string[] = [];
    fixture.componentRef.setInput('selectedPlaymatPath', selected.path);
    fixture.componentRef.setInput('initialPlaymatPath', selected.path);
    fixture.componentInstance.playmatSelected.subscribe((path) => emitted.push(path));
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.create-playmat-option') as NodeListOf<HTMLButtonElement>;

    expect(buttons[0].classList.contains('is-selected')).toBe(true);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');

    buttons[1].click();

    expect(emitted).toEqual([next.path]);
  });

  it('debounces the playmat hover preview and hides it when the pointer leaves', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CreatePlaymatSpoilerComponent);
      fixture.componentRef.setInput('selectedPlaymatPath', DEFAULT_PLAYMAT_PATH);
      fixture.componentRef.setInput('initialPlaymatPath', DEFAULT_PLAYMAT_PATH);
      fixture.detectChanges();

      const option = fixture.nativeElement.querySelector('.create-playmat-option') as HTMLButtonElement;
      option.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 160 }));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.create-playmat-hover-preview')).toBeNull();

      option.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      vi.advanceTimersByTime(180);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.create-playmat-hover-preview')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the debounced playmat hover preview and hides it on click', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CreatePlaymatSpoilerComponent);
      fixture.componentRef.setInput('selectedPlaymatPath', DEFAULT_PLAYMAT_PATH);
      fixture.componentRef.setInput('initialPlaymatPath', DEFAULT_PLAYMAT_PATH);
      fixture.detectChanges();

      const option = fixture.nativeElement.querySelector('.create-playmat-option') as HTMLButtonElement;
      option.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 160 }));
      vi.advanceTimersByTime(180);
      fixture.detectChanges();

      const preview = fixture.nativeElement.querySelector('.create-playmat-hover-preview') as HTMLElement | null;
      const image = preview?.querySelector('img') as HTMLImageElement | null;
      expect(preview).not.toBeNull();
      expect(image?.getAttribute('src')).toBe(DEFAULT_PLAYMAT_PATH);

      option.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.create-playmat-hover-preview')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps save disabled while the selected playmat matches the initial playmat', () => {
    const fixture = TestBed.createComponent(CreatePlaymatSpoilerComponent);
    const saveEvents: void[] = [];
    fixture.componentRef.setInput('selectedPlaymatPath', DEFAULT_PLAYMAT_PATH);
    fixture.componentRef.setInput('initialPlaymatPath', DEFAULT_PLAYMAT_PATH);
    fixture.componentInstance.save.subscribe(() => saveEvents.push(undefined));
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector('.create-playmat-spoiler-actions button') as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);

    fixture.componentInstance.saveSelection();

    expect(saveEvents.length).toBe(0);
  });

  it('enables save and emits from the footer action when the selected playmat changed', () => {
    const fixture = TestBed.createComponent(CreatePlaymatSpoilerComponent);
    const saveEvents: void[] = [];
    fixture.componentRef.setInput('selectedPlaymatPath', PLAYMAT_OPTIONS[1].path);
    fixture.componentRef.setInput('initialPlaymatPath', DEFAULT_PLAYMAT_PATH);
    fixture.componentInstance.save.subscribe(() => saveEvents.push(undefined));
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.create-playmat-spoiler-actions button') as NodeListOf<HTMLButtonElement>,
    );

    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Save']);
    expect(buttons[0].disabled).toBe(false);

    buttons[0].click();

    expect(saveEvents.length).toBe(1);
  });
});
