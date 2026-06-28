import { gsap } from 'gsap';

export type DeckFaceToggleAnimationSurface = 'card-image' | 'text-preview';
const DECK_DESKTOP_LAYOUT_MAX_WIDTH = 1180;

interface DeckFaceToggleAnimationOptions {
  readonly animateTrigger?: boolean;
}

export function runDeckFaceToggleAnimation(
  source: EventTarget | null,
  surface: DeckFaceToggleAnimationSurface,
  options: DeckFaceToggleAnimationOptions = {},
): void {
  if (shouldSkipDeckFaceAnimation()) {
    return;
  }

  const trigger = htmlElement(source);
  if (options.animateTrigger ?? true) {
    animateTrigger(trigger);
  }

  const cardFrame = imageFrame(trigger);
  const row = trigger?.closest<HTMLElement>('.deck-card-row') ?? null;

  const scheduleFrame = typeof window !== 'undefined'
    ? window.requestAnimationFrame.bind(window)
    : (callback: FrameRequestCallback) => callback(0);

  scheduleFrame(() => {
    const target = surface === 'card-image'
      ? cardImageTarget(cardFrame)
      : textPreviewTarget() ?? row;

    if (!target) {
      return;
    }

    animateCardFace(target);
  });
}

function animateTrigger(trigger: HTMLElement | null): void {
  if (!trigger) {
    return;
  }

  const icon = trigger.querySelector<HTMLElement>('lucide-icon') ?? trigger;
  gsap.killTweensOf(icon);
  gsap.fromTo(
    icon,
    { rotation: -160, scale: 0.82 },
    {
      rotation: 0,
      scale: 1,
      duration: 0.46,
      ease: 'back.out(1.7)',
      clearProps: 'transform',
    },
  );
}

function animateCardFace(target: HTMLElement): void {
  gsap.killTweensOf(target);
  gsap.set(target, {
    transformPerspective: 900,
    transformOrigin: '50% 50%',
    willChange: 'transform, filter',
  });
  gsap.fromTo(
    target,
    {
      filter: 'brightness(1.35) saturate(1.16) contrast(1.04)',
      rotationY: -78,
      scale: 0.97,
    },
    {
      filter: 'brightness(1) saturate(1) contrast(1)',
      rotationY: 0,
      scale: 1,
      duration: 0.58,
      ease: 'power3.out',
      clearProps: 'transform,filter,willChange',
    },
  );
}

function cardImageTarget(frame: HTMLElement | null): HTMLElement | null {
  return frame?.querySelector<HTMLElement>('img, .spoiler-card-fallback, .commander-card-fallback') ?? frame;
}

function imageFrame(source: HTMLElement | null): HTMLElement | null {
  if (!source) {
    return null;
  }

  if (source.matches('.spoiler-image-frame, .commander-card-image')) {
    return source;
  }

  return source.querySelector<HTMLElement>('.spoiler-image-frame, .commander-card-image')
    ?? source.closest<HTMLElement>('.spoiler-image-frame, .commander-card-image');
}

function textPreviewTarget(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.querySelector<HTMLElement>('.card-hover-preview img, .card-hover-preview .card-fallback');
}

function htmlElement(source: EventTarget | null): HTMLElement | null {
  if (typeof HTMLElement === 'undefined' || !(source instanceof HTMLElement)) {
    return null;
  }

  return source;
}

function shouldReduceMotion(): boolean {
  return matchesMedia('(prefers-reduced-motion: reduce)');
}

function shouldSkipDeckFaceAnimation(): boolean {
  return shouldReduceMotion()
    || matchesMedia(`(max-width: ${DECK_DESKTOP_LAYOUT_MAX_WIDTH}px)`)
    || matchesMedia('(pointer: coarse)')
    || matchesMedia('(any-pointer: coarse)')
    || matchesMedia('(hover: none)');
}

function matchesMedia(query: string): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches;
}
