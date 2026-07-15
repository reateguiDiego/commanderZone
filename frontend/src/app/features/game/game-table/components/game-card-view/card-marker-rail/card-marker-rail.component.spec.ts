import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { CircleQuestionMark, LucideAngularModule } from 'lucide-angular';
import { CardMarkerRailComponent } from './card-marker-rail.component';
import { resolveCardCounterLayout } from '../../../utils/card-counter-layout';

describe('CardMarkerRailComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardMarkerRailComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ CircleQuestionMark }))],
    }).compileComponents();
  });

  it('renders token and counter markers in rail order', () => {
    const fixture = createFixture();

    fixture.componentRef.setInput('showTokenCopyMarker', true);
    fixture.componentRef.setInput('counters', [
      { key: 'Charge', value: 2 },
      { key: 'Red', value: 1 },
    ]);
    fixture.detectChanges();

    const markers = Array.from(fixture.nativeElement.querySelectorAll('.card-marker')) as HTMLElement[];
    expect(markers).toHaveLength(3);
    expect(markers[0].classList).toContain('token-copy-marker');
    expect(markers[1].textContent).toContain('Charge');
    expect(markers[2].classList).toContain('color-counter-marker');
    expect(markers[2].textContent).toContain('1');
  });

  it('does not render the token copy marker for regular tokens', () => {
    const fixture = createFixture();

    fixture.componentRef.setInput('showTokenCopyMarker', false);
    fixture.componentRef.setInput('counters', []);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.token-copy-marker')).toBeNull();
  });

  it('renders a rulings marker when enabled', () => {
    const fixture = createFixture();

    fixture.componentRef.setInput('showRulingsMarker', true);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.oracle-rulings-marker') as HTMLElement | null;
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('title')).toBe('Open Oracle rulings on Scryfall');
  });

  it('emits rulings requests from marker clicks', () => {
    const fixture = createFixture();
    const requested = vi.fn();
    fixture.componentInstance.rulingsRequested.subscribe(requested);

    fixture.componentRef.setInput('showRulingsMarker', true);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.oracle-rulings-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(requested).toHaveBeenCalledWith(expect.any(MouseEvent));
  });

  it('renders color counters as badge-only markers', () => {
    const fixture = createFixture();

    fixture.componentRef.setInput('counters', [{ key: 'red', value: 3 }]);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    expect(marker.classList).toContain('color-counter-marker');
    expect(marker.textContent).toContain('red');
    expect(marker.textContent).toContain('3');
  });

  it('renders plus and minus counters as stat pills', () => {
    const fixture = createFixture();

    fixture.componentRef.setInput('counters', [{ key: '+1/+1', value: 2 }]);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    expect(marker.classList).toContain('stat-counter-marker');
    expect(marker.textContent).toContain('+1/+1');
    expect(marker.textContent).toContain('2');
  });

  it('emits counter increments and decrements from marker clicks', () => {
    const fixture = createFixture();
    const changed = vi.fn();
    fixture.componentInstance.counterChanged.subscribe(changed);

    fixture.componentRef.setInput('counters', [{ key: 'green', value: 4 }]);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    marker.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    marker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(changed).toHaveBeenNthCalledWith(1, {
      event: expect.any(PointerEvent),
      key: 'green',
      delta: 1,
    });
    expect(changed).toHaveBeenNthCalledWith(2, {
      event: expect.any(MouseEvent),
      key: 'green',
      delta: -1,
    });
  });

  it('renders counters as readonly markers when interactions are disabled', () => {
    const fixture = createFixture();
    const changed = vi.fn();
    const deleteRequested = vi.fn();
    fixture.componentInstance.counterChanged.subscribe(changed);
    fixture.componentInstance.counterDeleteRequested.subscribe(deleteRequested);

    fixture.componentRef.setInput('countersInteractive', false);
    fixture.componentRef.setInput('counters', [{ key: 'green', value: 4 }]);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    marker.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    marker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(marker.classList).toContain('readonly-counter-marker');
    expect(marker.getAttribute('role')).toBeNull();
    expect(marker.getAttribute('tabindex')).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(deleteRequested).not.toHaveBeenCalled();
  });

  it('requests a delete menu when a zero counter is right-clicked', () => {
    const fixture = createFixture();
    const changed = vi.fn();
    const deleteRequested = vi.fn();
    fixture.componentInstance.counterChanged.subscribe(changed);
    fixture.componentInstance.counterDeleteRequested.subscribe(deleteRequested);

    fixture.componentRef.setInput('counters', [{ key: 'green', value: 0 }]);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(changed).not.toHaveBeenCalled();
    expect(deleteRequested).toHaveBeenCalledWith({
      event: expect.any(MouseEvent),
      key: 'green',
    });
  });

  it('does not bubble marker pointer or click events to the card button', () => {
    const fixture = createFixture();
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();

    fixture.componentRef.setInput('counters', [{ key: 'blue', value: 1 }]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.addEventListener('click', parentClick);
    host.addEventListener('pointerdown', parentPointerDown);

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    marker.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    marker.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('does not bubble rulings marker pointer or click events to the card button', () => {
    const fixture = createFixture();
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();

    fixture.componentRef.setInput('showRulingsMarker', true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.addEventListener('click', parentClick);
    host.addEventListener('pointerdown', parentPointerDown);

    const marker = fixture.nativeElement.querySelector('.oracle-rulings-marker') as HTMLElement;
    marker.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('renders five complete counter controls with visible values including three digits', () => {
    const fixture = createFixture();
    fixture.componentRef.setInput('counters', [
      { key: 'Charge', value: 1 },
      { key: 'Quest progress', value: 10 },
      { key: '+1/+1', value: 100 },
      { key: 'Shield', value: 9 },
      { key: 'red', value: 99 },
    ]);
    fixture.detectChanges();

    const rail = fixture.nativeElement.querySelector('[data-testid="card-counter-rail"]') as HTMLElement;
    const markers = Array.from(rail.querySelectorAll<HTMLElement>('[data-counter-key]'));
    expect(rail.dataset['counterCount']).toBe('5');
    expect(rail.dataset['counterOrientation']).toBe('vertical');
    expect(markers).toHaveLength(5);
    expect(markers.map((marker) => marker.dataset['counterValue'])).toEqual(['1', '10', '100', '9', '99']);
    expect(markers.every((marker) => marker.getAttribute('role') === 'button' && marker.tabIndex === 0)).toBe(true);
  });

  it.each(['compact', 'aggressive', 'minimal'] as const)('uses the resolved contained grid in %s', (responsiveState) => {
    const fixture = createFixture();
    const counters = Array.from({ length: 5 }, (_, index) => ({ key: `Long counter ${index + 1}`, value: index + 1 }));
    fixture.componentRef.setInput('counters', counters);
    fixture.componentRef.setInput('layout', resolveCardCounterLayout({
      cardWidth: responsiveState === 'minimal' ? 60 : 82,
      cardHeight: responsiveState === 'minimal' ? 84 : 115,
      counterCount: counters.length,
      responsiveState,
      tapped: false,
      relationRole: 'independent',
      availableRect: { width: responsiveState === 'minimal' ? 60 : 82, height: responsiveState === 'minimal' ? 84 : 115 },
    }));
    fixture.detectChanges();

    const rail = fixture.nativeElement.querySelector('[data-testid="card-counter-rail"]') as HTMLElement;
    expect(rail.dataset['counterOrientation']).toBe('grid');
    expect(rail.querySelectorAll('[data-counter-key]')).toHaveLength(5);
    expect(rail.style.getPropertyValue('--counter-rows')).toBe('3');
    expect(rail.style.getPropertyValue('--counter-columns')).toBe('2');
  });

  it('supports keyboard increment and decrement without bubbling to the card', () => {
    const fixture = createFixture();
    const changed = vi.fn();
    fixture.componentInstance.counterChanged.subscribe(changed);
    fixture.componentRef.setInput('counters', [{ key: 'charge', value: 4 }]);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    const parentKeydown = vi.fn();
    (fixture.nativeElement as HTMLElement).addEventListener('keydown', parentKeydown);
    marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(changed).toHaveBeenNthCalledWith(1, { event: expect.any(MouseEvent), key: 'charge', delta: 1 });
    expect(changed).toHaveBeenNthCalledWith(2, { event: expect.any(MouseEvent), key: 'charge', delta: -1 });
    expect(parentKeydown).not.toHaveBeenCalled();
  });

  it('does not render an empty rail', () => {
    const fixture = createFixture();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-marker-rail')).toBeNull();
  });
});

function createFixture(): ComponentFixture<CardMarkerRailComponent> {
  return TestBed.createComponent(CardMarkerRailComponent);
}
