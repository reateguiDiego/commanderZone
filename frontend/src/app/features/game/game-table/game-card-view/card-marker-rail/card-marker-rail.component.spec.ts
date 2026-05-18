import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CardMarkerRailComponent } from './card-marker-rail.component';

describe('CardMarkerRailComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardMarkerRailComponent],
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

  it('renders color counters as badge-only markers', () => {
    const fixture = createFixture();

    fixture.componentRef.setInput('counters', [{ key: 'red', value: 3 }]);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.counter-marker') as HTMLElement;
    expect(marker.classList).toContain('color-counter-marker');
    expect(marker.textContent?.trim()).toBe('red3');
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

  it('does not render an empty rail', () => {
    const fixture = createFixture();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-marker-rail')).toBeNull();
  });
});

function createFixture(): ComponentFixture<CardMarkerRailComponent> {
  return TestBed.createComponent(CardMarkerRailComponent);
}
