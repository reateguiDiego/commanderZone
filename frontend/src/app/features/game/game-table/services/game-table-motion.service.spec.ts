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
    stubMatchMedia(() => false);

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

  it('prepares hand growth feedback for hand layout changes', () => {
    const left = addHandCard(host, 'card-left', { left: 10, top: 20, width: 72, height: 100 });
    const playFlip = service.prepareHandDropHandoff();
    expect(service.handMotionActive()).toBe(true);

    const arriving = addHandCard(host, 'card-new', { left: 90, top: 20, width: 72, height: 100 });
    const existingRight = addHandCard(host, 'card-right', { left: 210, top: 20, width: 72, height: 100 });
    const cardVisuals = [left, arriving, existingRight].map((card) => card.querySelector<HTMLElement>('.card-visual')!);

    playFlip();

    expect(flipFromSpy).not.toHaveBeenCalled();
    expect(gsapFromToSpy).toHaveBeenCalledOnce();
    expect(gsapFromToSpy.mock.calls[0]?.[0]).toEqual(cardVisuals);
    expect(gsapFromToSpy.mock.calls[0]?.[1]).toMatchObject({
      filter: 'brightness(1.22) saturate(1.1) contrast(1.03)',
      scale: 1.022,
      transformOrigin: '50% 100%',
    });
    expect(gsapFromToSpy.mock.calls[0]?.[2]).toMatchObject({
      clearProps: 'filter,scale,transformOrigin',
      duration: 0.62,
      ease: 'power2.out',
      filter: 'brightness(1)',
      scale: 1,
      stagger: { each: 0.018, from: 'center' },
    });
    expect(service.handMotionActive()).toBe(false);
  });

  it('does not pulse the hand surface when a card enters hand', () => {
    const handArea = document.createElement('section');
    handArea.classList.add('hand-area');
    host.appendChild(handArea);
    const left = addHandCard(handArea, 'card-left', { left: 10, top: 20, width: 72, height: 100 });
    const playFlip = service.prepareHandDropHandoff();

    const arriving = addHandCard(handArea, 'card-new', { left: 90, top: 20, width: 72, height: 100 });
    const cardVisuals = [left, arriving].map((card) => card.querySelector<HTMLElement>('.card-visual')!);

    playFlip();

    expect(gsapFromToSpy).toHaveBeenCalledOnce();
    expect(gsapFromToSpy.mock.calls[0]?.[0]).toEqual(cardVisuals);
    expect(gsapFromToSpy.mock.calls[0]?.[0]).not.toBe(handArea);
  });

  it('keeps ghost throws enabled below 1200px viewport height', () => {
    reinitWithMatchMedia((query) => query === '(max-height: 1199px)');
    const source = addHandCard(host, 'card-1', { left: 10, top: 20, width: 72, height: 100 });
    const target = addMotionTarget(host, { left: 300, top: 240, width: 72, height: 100 });
    const onComplete = vi.fn();

    service.throwElementGhost(source, target, { onComplete });

    expect(onComplete).toHaveBeenCalledOnce();
    expect(gsapToSpy).toHaveBeenCalledOnce();
    expect(document.body.querySelector('.cz-motion-ghost')).toBeNull();
  });

  it('keeps ghost throws enabled in compact width viewports', () => {
    reinitWithMatchMedia((query) => query === '(max-width: 1180px)');
    const source = addHandCard(host, 'card-1', { left: 10, top: 20, width: 72, height: 100 });
    const target = addMotionTarget(host, { left: 300, top: 240, width: 72, height: 100 });
    const onComplete = vi.fn();

    service.throwElementGhost(source, target, { onComplete });

    expect(onComplete).toHaveBeenCalledOnce();
    expect(gsapToSpy).toHaveBeenCalledOnce();
    expect(document.body.querySelector('.cz-motion-ghost')).toBeNull();
  });

  it('keeps ghost throws enabled in aggressive compact viewports', () => {
    reinitWithMatchMedia((query) => query === '(max-width: 1180px)' || query === '(max-height: 1199px)');
    const source = addHandCard(host, 'card-1', { left: 10, top: 20, width: 72, height: 100 });
    const target = addMotionTarget(host, { left: 300, top: 240, width: 72, height: 100 });
    const onComplete = vi.fn();

    service.throwElementGhost(source, target, { onComplete });

    expect(onComplete).toHaveBeenCalledOnce();
    expect(gsapToSpy).toHaveBeenCalledOnce();
    expect(document.body.querySelector('.cz-motion-ghost')).toBeNull();
  });

  it('runs hand handoff motion below 1200px viewport height', () => {
    reinitWithMatchMedia((query) => query === '(max-height: 1199px)');
    addHandCard(host, 'card-before', { left: 10, top: 20, width: 72, height: 100 });

    const playHandoff = service.prepareHandDropHandoff();

    expect(service.handMotionActive()).toBe(true);

    addHandCard(host, 'card-after', { left: 100, top: 20, width: 72, height: 100 });
    playHandoff();

    expect(gsapFromToSpy).toHaveBeenCalledOnce();
    expect(service.handMotionActive()).toBe(false);
  });

  it('runs hand handoff motion in compact width viewports', () => {
    reinitWithMatchMedia((query) => query === '(max-width: 1180px)');
    addHandCard(host, 'card-before', { left: 10, top: 20, width: 72, height: 100 });

    const playHandoff = service.prepareHandDropHandoff();

    expect(service.handMotionActive()).toBe(true);

    addHandCard(host, 'card-after', { left: 100, top: 20, width: 72, height: 100 });
    playHandoff();

    expect(gsapFromToSpy).toHaveBeenCalledOnce();
    expect(service.handMotionActive()).toBe(false);
  });

  it('can run hand handoff motion without freezing hand interactions', () => {
    addHandCard(host, 'card-before', { left: 10, top: 20, width: 72, height: 100 });

    const playHandoff = service.prepareHandDropHandoff('[data-zone="hand"][data-card-instance-id]', { freezeHand: false });

    expect(service.handMotionActive()).toBe(false);

    addHandCard(host, 'card-after', { left: 100, top: 20, width: 72, height: 100 });
    playHandoff();

    expect(gsapFromToSpy).toHaveBeenCalledOnce();
    expect(service.handMotionActive()).toBe(false);
  });

  it('runs hand card FLIP below 1200px viewport height', () => {
    reinitWithMatchMedia((query) => query === '(max-height: 1199px)');
    const card = addHandCard(host, 'card-1');

    const playFlip = service.prepareCardFlip('[data-zone="hand"][data-card-instance-id]');

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

  it('runs hand layout FLIP below 1200px viewport height', () => {
    reinitWithMatchMedia((query) => query === '(max-height: 1199px)');
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const card = addHandCard(host, 'card-1');

    try {
      const playFlip = service.prepareHandLayoutFlip(host);

      playFlip();

      expect(flipFromSpy).toHaveBeenCalledOnce();
      expect(flipFromSpy.mock.calls[0]?.[1]).toMatchObject({
        duration: 0.48,
        ease: 'power3.out',
        targets: [card],
      });
    } finally {
      animationFrame.mockRestore();
    }
  });

  it('uses layered GSAP pulses when creating a land stack', () => {
    const bottom = addBattlefieldStackCard(host, 'land-bottom', 'land-stack-under');
    const top = addBattlefieldStackCard(host, 'land-top', 'land-stack-top');
    const bottomVisual = bottom.querySelector<HTMLElement>('.card-visual');
    const topVisual = top.querySelector<HTMLElement>('.card-visual');

    service.pulseLandStack(['land-bottom', 'land-top'], 'stack');

    expect(gsapFromToSpy).toHaveBeenCalledTimes(4);
    expect(gsapFromToSpy.mock.calls[0]?.[0]).toEqual([bottom]);
    expect(gsapFromToSpy.mock.calls[0]?.[1]).toMatchObject({
      filter: 'brightness(1.38) saturate(1.22)',
      scale: 1.085,
      transformOrigin: '50% 96%',
    });
    expect(gsapFromToSpy.mock.calls[0]?.[2]).toMatchObject({
      duration: 0.68,
      ease: 'back.out(2.35)',
      stagger: { each: 0.045, from: 'end' },
    });
    expect(gsapFromToSpy.mock.calls[1]?.[0]).toEqual([top]);
    expect(gsapFromToSpy.mock.calls[1]?.[2]).toMatchObject({
      delay: 0.065,
      duration: 0.46,
      ease: 'power3.out',
    });
    expect(gsapFromToSpy.mock.calls[2]?.[0]).toEqual([bottomVisual, topVisual]);
    expect(gsapFromToSpy.mock.calls[2]?.[2]).toMatchObject({
      duration: 0.78,
      ease: 'power2.out',
    });
    expect(gsapFromToSpy.mock.calls[3]?.[0]).toBeInstanceOf(HTMLElement);
    expect((gsapFromToSpy.mock.calls[3]?.[0] as HTMLElement).classList.contains('cz-land-stack-burst')).toBe(true);
    expect(gsapFromToSpy.mock.calls[3]?.[2]).toMatchObject({
      duration: 0.62,
      ease: 'power3.out',
      opacity: 0,
      scale: 1.85,
    });
  });

  it('rotates only the targeted stack card without muting sibling stack cards', () => {
    const bottom = addBattlefieldStackCard(host, 'land-bottom', 'land-stack-under', { left: 100, top: 86, width: 72, height: 100 });
    const top = addBattlefieldStackCard(host, 'land-top', 'land-stack-top', { left: 100, top: 100, width: 72, height: 100 });
    const otherStackCard = addBattlefieldStackCard(host, 'other-stack-card', 'land-stack-under', { left: 360, top: 100, width: 72, height: 100 });
    let completeRotation: (() => void) | undefined;
    flipFromSpy.mockImplementationOnce((_state: Parameters<typeof Flip.from>[0], vars: Parameters<typeof Flip.from>[1]) => {
      completeRotation = vars?.onComplete ? () => vars.onComplete?.() : undefined;

      return null as unknown as gsap.core.Timeline;
    });

    const playFlip = service.prepareCardRotationFlip('land-top');

    expect(bottom.classList).not.toContain('cz-card-rotation-muted');

    playFlip();

    expect(top.classList).toContain('cz-card-rotation-flip');
    expect(bottom.classList).not.toContain('cz-card-rotation-muted');
    expect(otherStackCard.classList).not.toContain('cz-card-rotation-muted');

    completeRotation?.();

    expect(top.classList).not.toContain('cz-card-rotation-flip');
    expect(bottom.classList).not.toContain('cz-card-rotation-muted');
  });

  function reinitWithMatchMedia(matches: (query: string) => boolean): void {
    service.destroy();
    stubMatchMedia(matches);
    service.init(new ElementRef(host));
  }
});

function stubMatchMedia(matches: (query: string) => boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

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

function addBattlefieldStackCard(
  host: HTMLElement,
  instanceId: string,
  roleClass: 'land-stack-top' | 'land-stack-under',
  rect?: { left: number; top: number; width: number; height: number },
): HTMLElement {
  const card = addHandCard(host, instanceId, rect);
  card.dataset['zone'] = 'battlefield';
  card.classList.add('land-stack-card', roleClass);

  return card;
}

function addMotionTarget(
  host: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
): HTMLElement {
  const target = document.createElement('div');
  target.getBoundingClientRect = (): DOMRect => ({
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
  host.appendChild(target);

  return target;
}
