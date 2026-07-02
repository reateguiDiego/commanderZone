import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TooltipComponent } from './tooltip.component';

type TestTooltipPlacement = 'top' | 'bottom';
type TestTooltipAlign = 'start' | 'center' | 'end';

@Component({
  selector: 'app-tooltip-host',
  standalone: true,
  imports: [TooltipComponent],
  template: `
    <app-tooltip [text]="text" triggerMode="click" [placement]="placement" [align]="align">
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
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TooltipHostComponent],
    }).compileComponents();

    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 240 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--cz-secondary');
    document.documentElement.style.removeProperty('--cz-secondary-rgb');
  });

  it('opens below when the preferred top placement would be clipped', async () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);

    await openTooltip(fixture, {
      triggerRect: rect({ top: 4, bottom: 28, left: 140, right: 180, width: 40, height: 24 }),
      bubbleRect: rect({ width: 160, height: 64 }),
    });

    expect(bubble(fixture).classList).toContain('cz-tooltip__bubble--bottom');
    expect(bubble(fixture).style.top).toBe('28px');
  });

  it('opens above when the preferred bottom placement would be clipped', async () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.componentInstance.placement = 'bottom';

    await openTooltip(fixture, {
      triggerRect: rect({ top: 212, bottom: 236, left: 140, right: 180, width: 40, height: 24 }),
      bubbleRect: rect({ width: 160, height: 64 }),
    });

    expect(bubble(fixture).classList).not.toContain('cz-tooltip__bubble--bottom');
    expect(bubble(fixture).style.top).toBe('212px');
  });

  it('aligns to the end when the centered tooltip would be clipped on the right', async () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);

    await openTooltip(fixture, {
      triggerRect: rect({ top: 80, bottom: 104, left: 292, right: 316, width: 24, height: 24 }),
      bubbleRect: rect({ width: 160, height: 48 }),
    });

    expect(bubble(fixture).classList).toContain('cz-tooltip__bubble--align-end');
  });

  it('keeps the bubble hidden until it has measured the edge-aware alignment', async () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.detectChanges();
    trigger(fixture).getBoundingClientRect = () => rect({ top: 80, bottom: 104, left: 292, right: 316, width: 24, height: 24 });

    button(fixture).click();
    fixture.detectChanges();

    bubble(fixture).getBoundingClientRect = () => rect({ width: 160, height: 48 });
    expect(bubble(fixture).classList).not.toContain('cz-tooltip__bubble--visible');

    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(bubble(fixture).classList).not.toContain('cz-tooltip__bubble--visible');

    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(bubble(fixture).classList).toContain('cz-tooltip__bubble--visible');
    expect(bubble(fixture).classList).toContain('cz-tooltip__bubble--align-end');
  });

  it('uses two-line truncation only when the single-line bubble cannot fit', async () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);
    fixture.componentInstance.text = 'This tooltip is intentionally too long to fit in a single line within the available viewport width.';

    await openTooltip(fixture, {
      triggerRect: rect({ top: 80, bottom: 104, left: 140, right: 180, width: 40, height: 24 }),
      bubbleRect: rect({ width: 296, height: 48 }),
      clientWidth: 296,
      scrollWidth: 520,
    });

    expect(bubble(fixture).classList).toContain('cz-tooltip__bubble--multiline');
    expect(getComputedStyle(bubble(fixture)).overflow).not.toBe('hidden');
    expect(getComputedStyle(content(fixture)).overflow).toBe('hidden');
  });

  it('aligns to the start when the centered tooltip would be clipped on the left', async () => {
    const fixture = TestBed.createComponent(TooltipHostComponent);

    await openTooltip(fixture, {
      triggerRect: rect({ top: 80, bottom: 104, left: 4, right: 28, width: 24, height: 24 }),
      bubbleRect: rect({ width: 160, height: 48 }),
    });

    expect(bubble(fixture).classList).toContain('cz-tooltip__bubble--align-start');
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
});

async function openTooltip(
  fixture: ComponentFixture<TooltipHostComponent>,
  options: { triggerRect: DOMRect; bubbleRect: DOMRect; clientWidth?: number; scrollWidth?: number },
): Promise<void> {
  fixture.detectChanges();
  trigger(fixture).getBoundingClientRect = () => options.triggerRect;

  button(fixture).click();
  fixture.detectChanges();
  bubble(fixture).getBoundingClientRect = () => options.bubbleRect;
  if (options.clientWidth !== undefined) {
    Object.defineProperty(content(fixture), 'clientWidth', { configurable: true, value: options.clientWidth });
  }
  if (options.scrollWidth !== undefined) {
    Object.defineProperty(content(fixture), 'scrollWidth', { configurable: true, value: options.scrollWidth });
  }

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

function content(fixture: ComponentFixture<TooltipHostComponent>): HTMLElement {
  return fixture.nativeElement.querySelector('.cz-tooltip__content') as HTMLElement;
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
