import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { GameTableMotionService } from './game-table-motion.service';

describe('GameTableMotionService', () => {
  let service: GameTableMotionService;
  let host: HTMLElement;
  let flipFromSpy: ReturnType<typeof vi.spyOn>;
  let gsapFromToSpy: ReturnType<typeof vi.spyOn>;
  let gsapToSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    flipFromSpy = vi.spyOn(Flip, 'from').mockImplementation((_state, vars) => {
      vars?.onComplete?.();

      return null as unknown as gsap.core.Timeline;
    });
    gsapFromToSpy = vi.spyOn(gsap, 'fromTo').mockImplementation((_targets, _fromVars, toVars) => {
      if (typeof toVars === 'object' && toVars && 'onComplete' in toVars && typeof toVars.onComplete === 'function') {
        toVars.onComplete();
      }

      return null as unknown as gsap.core.Tween;
    });
    gsapToSpy = vi.spyOn(gsap, 'to').mockImplementation((_targets, vars) => {
      if (typeof vars === 'object' && vars && 'onComplete' in vars && typeof vars.onComplete === 'function') {
        vars.onComplete();
      }

      return null as unknown as gsap.core.Tween;
    });
    TestBed.configureTestingModule({
      providers: [GameTableMotionService],
    });

    service = TestBed.inject(GameTableMotionService);
    host = document.createElement('section');
    document.body.appendChild(host);
    service.init(new ElementRef(host));
  });

  afterEach(() => {
    service.destroy();
    host.remove();
    flipFromSpy.mockRestore();
    gsapFromToSpy.mockRestore();
    gsapToSpy.mockRestore();
  });

  it('prepares a FLIP animation for hand card reorder', () => {
    const card = addHandCard(host, 'card-1');

    const playFlip = service.prepareCardFlip('[data-zone="hand"][data-card-instance-id]');

    expect(flipFromSpy).not.toHaveBeenCalled();
    expect(service.handMotionActive()).toBe(true);

    playFlip();

    expect(flipFromSpy).toHaveBeenCalledOnce();
    expect(flipFromSpy.mock.calls[0]?.[1]).toMatchObject({
      duration: 0.34,
      ease: 'power3.out',
      targets: [card],
    });
    expect(service.handMotionActive()).toBe(false);
  });

  it('prepares a 0.6s FLIP handoff for hand layout changes', () => {
    const existingLeft = addHandCard(host, 'card-left', { left: 10, top: 20, width: 72, height: 100 });
    const playFlip = service.prepareHandDropHandoff();
    expect(service.handMotionActive()).toBe(true);

    const arriving = addHandCard(host, 'card-new', { left: 90, top: 20, width: 72, height: 100 });
    const existingRight = addHandCard(host, 'card-right', { left: 210, top: 20, width: 72, height: 100 });

    playFlip();

    expect(flipFromSpy).toHaveBeenCalledOnce();
    expect(flipFromSpy.mock.calls[0]?.[1]).toMatchObject({
      duration: 0.6,
      ease: 'power3.out',
      scale: false,
      targets: [existingLeft, arriving, existingRight],
    });
    expect(gsapFromToSpy).toHaveBeenCalledOnce();
    expect(gsapFromToSpy.mock.calls[0]?.[0]).toEqual([arriving, existingRight]);
    expect(gsapFromToSpy.mock.calls[0]?.[1]).toMatchObject({
      filter: 'brightness(1.28) saturate(1.14)',
    });
    expect(gsapFromToSpy.mock.calls[0]?.[2]).toMatchObject({
      duration: 0.42,
      ease: 'power2.out',
      filter: 'brightness(1)',
    });
    expect(service.handMotionActive()).toBe(false);
  });

});

function addHandCard(
  host: HTMLElement,
  instanceId: string,
  rect: { left: number; top: number; width: number; height: number } = { left: 10, top: 20, width: 72, height: 100 },
): HTMLElement {
  const card = document.createElement('button');
  card.dataset['zone'] = 'hand';
  card.dataset['cardInstanceId'] = instanceId;
  card.dataset['flipId'] = instanceId;
  card.getBoundingClientRect = (): DOMRect => ({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    left: rect.left,
    toJSON: () => ({}),
  } as DOMRect);
  const visual = document.createElement('span');
  visual.classList.add('card-visual');
  card.appendChild(visual);
  host.appendChild(card);

  return card;
}
