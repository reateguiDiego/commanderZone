import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeviceProfileService } from '../../services/device-profile.service';
import { TooltipComponent } from './tooltip.component';

type TestTooltipPlacement = 'top' | 'bottom';
type TestTooltipAlign = 'start' | 'center' | 'end';

@Component({
  selector: 'app-tooltip-host',
  standalone: true,
  imports: [TooltipComponent],
  template: `
    <app-tooltip [text]="text" [placement]="placement" [align]="align">
      <button type="button">Open tooltip</button>
    </app-tooltip>
  `,
})
class TooltipHostComponent {
  text = 'Tooltip content';
  placement: TestTooltipPlacement = 'top';
  align: TestTooltipAlign = 'center';
}

describe('TooltipComponent', () => {
  const hasHover = signal(true);

  beforeEach(async () => {
    hasHover.set(true);
    await TestBed.configureTestingModule({
      imports: [TooltipHostComponent],
      providers: [{ provide: DeviceProfileService, useValue: { hasHover } }],
    }).compileComponents();

    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 240 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--cz-secondary');
    document.documentElement.style.removeProperty('--cz-secondary-rgb');
    document.documentElement.style.removeProperty('--cz-tooltip-z-index');
  });

  it('uses dark text on light tooltip backgrounds', async () => {
    document.documentElement.style.setProperty('--cz-secondary-rgb', '157 255 63');
    const fixture = TestBed.createComponent(TooltipHostComponent);

    await openTooltip(fixture, {
      triggerRect: rect({ top: 80, bottom: 104, left: 140, right: 180, width: 40, height: 24 }),
      bubbleRect: rect({ width: 160, height: 48 }),
    });

    expect(getComputedStyle(bubble(fixture)).color).toBe('rgb(0, 0, 0)');
  });

  it('uses light text on dark tooltip backgrounds', async () => {
    document.documentElement.style.setProperty('--cz-secondary-rgb', '122 18 50');
    const fixture = TestBed.createComponent(TooltipHostComponent);

    await openTooltip(fixture, {
      triggerRect: rect({ top: 80, bottom: 104, left: 140, right: 180, width: 40, height: 24 }),
      bubbleRect: rect({ width: 160, height: 48 }),
    });

    expect(getComputedStyle(bubble(fixture)).color).toBe('rgb(255, 255, 255)');
  });

  it('renders above game overlays by default', async () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);

    await openTooltip(fixture, {
      triggerRect: rect({ top: 80, bottom: 104, left: 140, right: 180, width: 40, height: 24 }),
      bubbleRect: rect({ width: 160, height: 48 }),
    });

    expect(tooltipBubbleRule()).toContain('z-index: var(--cz-tooltip-z-index, 3600)');
  });

  it('does not open from a click', () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.detectChanges();

    button(fixture).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cz-tooltip__bubble')).toBeNull();
  });

  it('does not open from a touch pointer', () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.detectChanges();

    trigger(fixture).dispatchEvent(pointerEvent('pointerenter', 'touch'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cz-tooltip__bubble')).toBeNull();
  });

  it('does not open when the device cannot hover', () => {
    hasHover.set(false);
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.detectChanges();

    trigger(fixture).dispatchEvent(pointerEvent('pointerenter', 'mouse'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cz-tooltip__bubble')).toBeNull();
  });
});

async function openTooltip(
  fixture: ComponentFixture<TooltipHostComponent>,
  options: { triggerRect: DOMRect; bubbleRect: DOMRect },
): Promise<void> {
  fixture.detectChanges();
  trigger(fixture).getBoundingClientRect = () => options.triggerRect;

  trigger(fixture).dispatchEvent(pointerEvent('pointerenter', 'mouse'));
  fixture.detectChanges();
  bubble(fixture).getBoundingClientRect = () => options.bubbleRect;

  await new Promise<void>((resolve) => setTimeout(resolve));
  fixture.detectChanges();
  await new Promise<void>((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

function button(fixture: ComponentFixture<TooltipHostComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
}

function trigger(fixture: ComponentFixture<TooltipHostComponent>): HTMLElement {
  return fixture.nativeElement.querySelector('.cz-tooltip__trigger') as HTMLElement;
}

function bubble(fixture: ComponentFixture<TooltipHostComponent>): HTMLElement {
  return fixture.nativeElement.querySelector('.cz-tooltip__bubble') as HTMLElement;
}

function tooltipBubbleRule(): string {
  for (const styleSheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(styleSheet.cssRules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.includes('.cz-tooltip__bubble')) {
        return rule.cssText;
      }
    }
  }

  return '';
}

function pointerEvent(type: string, pointerType: string): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

function rect(values: Partial<DOMRect>): DOMRect {
  const left = values.left ?? 0;
  const top = values.top ?? 0;
  const width = values.width ?? 0;
  const height = values.height ?? 0;
  const right = values.right ?? left + width;
  const bottom = values.bottom ?? top + height;

  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width,
    height,
    toJSON: () => ({}),
  };
}
