import { TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, RotateCw } from 'lucide-angular';
import { CardFaceToggleButtonComponent } from './card-face-toggle-button.component';

describe('CardFaceToggleButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardFaceToggleButtonComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ RotateCw })),
      ],
    }).compileComponents();
  });

  it('emits from click for mouse interactions', () => {
    const fixture = TestBed.createComponent(CardFaceToggleButtonComponent);
    const pressedSpy = vi.fn();
    fixture.componentInstance.pressed.subscribe(pressedSpy);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(pressedSpy).toHaveBeenCalledTimes(1);
    expect(pressedSpy.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
  });

  it('stops pointerdown before parent interactive containers can observe it', () => {
    const fixture = TestBed.createComponent(CardFaceToggleButtonComponent);
    const parentPointerDownSpy = vi.fn();
    fixture.nativeElement.addEventListener('pointerdown', parentPointerDownSpy);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));

    expect(parentPointerDownSpy).not.toHaveBeenCalled();
  });

  it('prevents bubbling contextmenu interactions from reaching parent interactive containers', () => {
    const fixture = TestBed.createComponent(CardFaceToggleButtonComponent);
    const parentContextMenuSpy = vi.fn();
    fixture.nativeElement.addEventListener('contextmenu', parentContextMenuSpy);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);

    expect(parentContextMenuSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('emits from pointerup for touch interactions and suppresses the follow-up click', () => {
    const fixture = TestBed.createComponent(CardFaceToggleButtonComponent);
    const pressedSpy = vi.fn();
    fixture.componentInstance.pressed.subscribe(pressedSpy);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(pressedSpy).toHaveBeenCalledTimes(1);
    expect(pressedSpy.mock.calls[0]?.[0]).toBeInstanceOf(PointerEvent);
  });

  it('emits from touchend when the browser dispatches touch events directly', () => {
    const fixture = TestBed.createComponent(CardFaceToggleButtonComponent);
    const pressedSpy = vi.fn();
    fixture.componentInstance.pressed.subscribe(pressedSpy);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(pressedSpy).toHaveBeenCalledTimes(1);
    expect(pressedSpy.mock.calls[0]?.[0].type).toBe('touchend');
  });

  it('allows a later click after the touch dedupe window', () => {
    vi.useFakeTimers();

    const fixture = TestBed.createComponent(CardFaceToggleButtonComponent);
    const pressedSpy = vi.fn();
    fixture.componentInstance.pressed.subscribe(pressedSpy);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    vi.advanceTimersByTime(500);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(pressedSpy).toHaveBeenCalledTimes(2);
    expect(pressedSpy.mock.calls[1]?.[0]).toBeInstanceOf(MouseEvent);

    vi.useRealTimers();
  });
});
