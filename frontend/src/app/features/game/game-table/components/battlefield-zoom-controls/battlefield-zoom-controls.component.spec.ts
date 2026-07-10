import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, RotateCcw, Search } from 'lucide-angular';
import { BattlefieldZoomControlsComponent } from './battlefield-zoom-controls.component';

describe('BattlefieldZoomControlsComponent', () => {
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

  it.each([
    { input: '102', expectedValue: '100', expectedEmit: 100 },
    { input: '103', expectedValue: '103', expectedEmit: 103 },
  ])('normalizes slider value $input to $expectedValue', async ({ input, expectedValue, expectedEmit }) => {
    const fixture = await renderControls();
    openZoomControls(fixture);
    const zoomPercentChanged = vi.fn();
    fixture.componentInstance.zoomPercentChanged.subscribe(zoomPercentChanged);
    const slider = sliderInput(fixture);

    slider.value = input;
    slider.dispatchEvent(new Event('input'));

    expect(slider.value).toBe(expectedValue);
    expect(zoomPercentChanged).toHaveBeenCalledWith(expectedEmit);
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
