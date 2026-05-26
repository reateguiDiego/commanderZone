import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, RotateCcw, Search } from 'lucide-angular';
import { BattlefieldZoomControlsComponent } from './battlefield-zoom-controls.component';

describe('BattlefieldZoomControlsComponent', () => {
  it('renders a collapsed zoom toggle by default', async () => {
    const fixture = await renderControls();

    expect(toggleButton(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('[data-testid="battlefield-zoom-popover"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="battlefield-zoom-slider"]')).toBeNull();
  });

  it('opens the visual slider from the zoom toggle without visible zoom text', async () => {
    const fixture = await renderControls();

    openZoomControls(fixture);

    const slider = sliderInput(fixture);

    expect(fixture.nativeElement.querySelector('.zoom-toggle-button')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="battlefield-zoom-popover"]')).not.toBeNull();
    expect(slider.min).toBe('70');
    expect(slider.max).toBe('140');
    expect(slider.step).toBe('1');
    expect(slider.value).toBe('100');
    expect(fixture.nativeElement.textContent).not.toContain('100%');
  });

  it('places the default zoom mark at the reset point', async () => {
    const fixture = await renderControls();
    openZoomControls(fixture);
    const mark = fixture.nativeElement.querySelector('[data-testid="battlefield-zoom-default-mark"]') as HTMLElement;

    expect(mark.style.getPropertyValue('--zoom-current-position')).toBe('42.857%');
    expect(mark.style.getPropertyValue('--zoom-default-position')).toBe('42.857%');
  });

  it('uses a random mana symbol for the slider thumb and a standard reset icon', async () => {
    const fixture = await renderControls();
    openZoomControls(fixture);
    const thumbIcon = fixture.nativeElement.querySelector('.zoom-thumb .ms') as HTMLElement;
    const resetButton = fixture.nativeElement.querySelector('.reset-button') as HTMLElement;
    const manaSymbolClasses = [
      'ms-w',
      'ms-u',
      'ms-b',
      'ms-r',
      'ms-g',
      'ms-wu',
      'ms-wb',
      'ms-ub',
      'ms-ur',
      'ms-br',
      'ms-bg',
      'ms-rw',
      'ms-rg',
      'ms-gw',
      'ms-gu',
      'ms-2w',
      'ms-2u',
      'ms-2b',
      'ms-2r',
      'ms-2g',
      'ms-cw',
      'ms-cu',
      'ms-cb',
      'ms-cr',
      'ms-cg',
      'ms-wp',
      'ms-up',
      'ms-bp',
      'ms-rp',
      'ms-gp',
      'ms-wup',
      'ms-wbp',
      'ms-ubp',
      'ms-urp',
      'ms-brp',
      'ms-bgp',
      'ms-rwp',
      'ms-rgp',
      'ms-gwp',
      'ms-gup',
      'ms-s',
    ];

    expect(manaSymbolClasses.some((symbolClass) => thumbIcon.classList.contains(symbolClass))).toBe(true);
    expect(thumbIcon.classList.contains('ms-c')).toBe(false);
    expect(resetButton.querySelector('.reset-mana-symbol')).toBeNull();
    expect(resetButton.querySelector('lucide-icon')).not.toBeNull();
  });

  it('disables reset when the current zoom is already default', async () => {
    const fixture = await renderControls({ canResetZoom: false });
    openZoomControls(fixture);

    expect(resetButton(fixture).disabled).toBe(true);
  });

  it('emits slider changes and reset actions', async () => {
    const fixture = await renderControls();
    openZoomControls(fixture);
    const zoomPercentChanged = vi.fn();
    const resetZoom = vi.fn();
    fixture.componentInstance.zoomPercentChanged.subscribe(zoomPercentChanged);
    fixture.componentInstance.resetZoom.subscribe(resetZoom);
    const slider = sliderInput(fixture);

    slider.value = '127';
    slider.dispatchEvent(new Event('input'));
    resetButton(fixture).click();

    expect(zoomPercentChanged).toHaveBeenCalledWith(127);
    expect(resetZoom).toHaveBeenCalledOnce();
  });

  it('emits zoom changes from pointer movement on the visible slider track', async () => {
    const fixture = await renderControls();
    openZoomControls(fixture);
    const zoomPercentChanged = vi.fn();
    fixture.componentInstance.zoomPercentChanged.subscribe(zoomPercentChanged);
    const sliderShell = fixture.nativeElement.querySelector('.zoom-slider-shell') as HTMLElement;
    const sliderTrack = fixture.nativeElement.querySelector('.zoom-track') as HTMLElement;
    sliderTrack.getBoundingClientRect = () => ({
      bottom: 20,
      height: 10,
      left: 10,
      right: 110,
      top: 10,
      width: 100,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });

    sliderShell.dispatchEvent(pointerEvent('pointerdown', 90));

    expect(zoomPercentChanged).toHaveBeenCalledWith(126);
    expect(sliderInput(fixture).value).toBe('126');
  });

  it('snaps slider changes close to the default zoom', async () => {
    const fixture = await renderControls();
    openZoomControls(fixture);
    const zoomPercentChanged = vi.fn();
    fixture.componentInstance.zoomPercentChanged.subscribe(zoomPercentChanged);
    const slider = sliderInput(fixture);

    slider.value = '102';
    slider.dispatchEvent(new Event('input'));

    expect(slider.value).toBe('100');
    expect(zoomPercentChanged).toHaveBeenCalledWith(100);
  });

  it('keeps slider changes outside the default zoom snap range', async () => {
    const fixture = await renderControls();
    openZoomControls(fixture);
    const zoomPercentChanged = vi.fn();
    fixture.componentInstance.zoomPercentChanged.subscribe(zoomPercentChanged);
    const slider = sliderInput(fixture);

    slider.value = '103';
    slider.dispatchEvent(new Event('input'));

    expect(slider.value).toBe('103');
    expect(zoomPercentChanged).toHaveBeenCalledWith(103);
  });

  it('closes the zoom popover when clicking outside the control', async () => {
    const fixture = await renderControls();
    openZoomControls(fixture);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(toggleButton(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('[data-testid="battlefield-zoom-popover"]')).toBeNull();
  });
});

interface RenderControlsOptions {
  readonly zoomPercent?: number;
  readonly minZoomPercent?: number;
  readonly maxZoomPercent?: number;
  readonly defaultZoomPercent?: number;
  readonly zoomStepPercent?: number;
  readonly canResetZoom?: boolean;
}

async function renderControls(options: RenderControlsOptions = {}): Promise<ComponentFixture<BattlefieldZoomControlsComponent>> {
  await TestBed.configureTestingModule({
    imports: [BattlefieldZoomControlsComponent],
    providers: [importProvidersFrom(LucideAngularModule.pick({ RotateCcw, Search }))],
  }).compileComponents();

  const fixture = TestBed.createComponent(BattlefieldZoomControlsComponent);
  fixture.componentRef.setInput('zoomPercent', options.zoomPercent ?? 100);
  fixture.componentRef.setInput('minZoomPercent', options.minZoomPercent ?? 70);
  fixture.componentRef.setInput('maxZoomPercent', options.maxZoomPercent ?? 140);
  fixture.componentRef.setInput('defaultZoomPercent', options.defaultZoomPercent ?? 100);
  fixture.componentRef.setInput('zoomStepPercent', options.zoomStepPercent ?? 1);
  fixture.componentRef.setInput('canResetZoom', options.canResetZoom ?? true);
  fixture.detectChanges();

  return fixture;
}

function openZoomControls(fixture: ComponentFixture<BattlefieldZoomControlsComponent>): void {
  toggleButton(fixture).click();
  fixture.detectChanges();
}

function toggleButton(fixture: ComponentFixture<BattlefieldZoomControlsComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.zoom-toggle-button');
}

function resetButton(fixture: ComponentFixture<BattlefieldZoomControlsComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.reset-button');
}

function sliderInput(fixture: ComponentFixture<BattlefieldZoomControlsComponent>): HTMLInputElement {
  return fixture.nativeElement.querySelector('[data-testid="battlefield-zoom-slider"]');
}

function pointerEvent(type: string, clientX: number): PointerEvent {
  return new MouseEvent(type, { bubbles: true, button: 0, clientX }) as PointerEvent;
}
