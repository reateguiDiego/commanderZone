import { ElementRef, Injectable, NgZone, inject, signal } from '@angular/core';
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';

gsap.registerPlugin(Flip);

type CardPunchVariant = 'play' | 'tap' | 'damage';

interface ThrowGhostOptions {
  readonly rotate?: number;
  readonly scaleToTarget?: boolean;
  readonly sourceRect?: MotionRect | null;
  readonly onComplete?: () => void;
}

interface MotionRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface HandElementSnapshot extends MotionRect {
  readonly instanceId: string | null;
}

@Injectable()
export class GameTableMotionService {
  private readonly ngZone = inject(NgZone);
  private readonly handMotionActiveState = signal(false);
  readonly handMotionActive = this.handMotionActiveState.asReadonly();
  private handMotionActiveCount = 0;
  private context: gsap.Context | null = null;
  private host: HTMLElement | null = null;
  private reducedMotionQuery: MediaQueryList | null = null;

  init(hostRef: ElementRef<HTMLElement>): void {
    this.destroy();
    const host = hostRef.nativeElement;
    this.host = host;
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.ngZone.runOutsideAngular(() => {
      this.context = gsap.context(() => undefined, host);
    });
  }

  destroy(): void {
    this.context?.revert();
    this.handMotionActiveCount = 0;
    this.handMotionActiveState.set(false);
    this.context = null;
    this.host = null;
    this.reducedMotionQuery = null;
  }

  punchCard(instanceId: string, variant: CardPunchVariant = 'play'): void {
    const card = this.findCard(instanceId);
    if (!card) {
      return;
    }

    this.runInContext(() => {
      gsap.killTweensOf(card);

      if (this.prefersReducedMotion()) {
        gsap.fromTo(card, { filter: 'brightness(1.12)' }, { clearProps: 'filter', duration: 0.14, ease: 'power1.out' });
        return;
      }

      const config = this.punchConfig(variant);
      gsap.fromTo(
        card,
        {
          filter: config.filter,
          rotate: config.rotate,
          scale: config.scale,
          y: config.y,
        },
        {
          clearProps: 'filter,rotate,scale,y',
          duration: config.duration,
          ease: 'back.out(2.1)',
          rotate: 0,
          scale: 1,
          y: 0,
        },
      );
    });
  }

  throwGhost(fromInstanceId: string, target: HTMLElement | string, options: ThrowGhostOptions = {}): void {
    const source = this.findCard(fromInstanceId);
    this.throwElementGhost(source, target, options);
  }

  throwElementGhost(source: HTMLElement | string | null, target: HTMLElement | string, options: ThrowGhostOptions = {}): void {
    const resolvedSource = typeof source === 'string' ? this.resolveTarget(source) : source;
    const destination = this.resolveTarget(target);
    if (!resolvedSource || !destination) {
      options.onComplete?.();
      return;
    }

    this.runInContext(() => {
      const sourceRect = resolvedSource.getBoundingClientRect();
      const startRect = options.sourceRect ?? sourceRect;
      const targetRect = destination.getBoundingClientRect();
      const ghost = this.createGhost(resolvedSource, startRect);
      if (!ghost) {
        options.onComplete?.();
        return;
      }

      const scaleX = targetRect.width > 0 ? targetRect.width / startRect.width : 1;
      const scaleY = targetRect.height > 0 ? targetRect.height / startRect.height : 1;
      const scale = options.scaleToTarget ? Math.min(scaleX, scaleY) : 0.82;
      const endX = targetRect.left + targetRect.width / 2 - (startRect.left + startRect.width / 2);
      const endY = targetRect.top + targetRect.height / 2 - (startRect.top + startRect.height / 2);

      if (this.prefersReducedMotion()) {
        ghost.remove();
        options.onComplete?.();
        return;
      }

      gsap.to(ghost, {
        duration: 0.4,
        ease: 'power3.out',
        opacity: 0,
        rotate: options.rotate ?? 0,
        scale,
        x: endX,
        y: endY,
        onComplete: () => {
          ghost.remove();
          options.onComplete?.();
        },
      });
    });
  }

  impactZone(target: HTMLElement | string): void {
    const element = this.resolveTarget(target);
    if (!element) {
      return;
    }

    if (this.isPopulatedHandTarget(element)) {
      return;
    }

    this.runInContext(() => {
      gsap.killTweensOf(element);

      if (this.prefersReducedMotion()) {
        gsap.fromTo(element, { filter: 'brightness(1.1)' }, { clearProps: 'filter', duration: 0.14, ease: 'power1.out' });
        return;
      }

      gsap.fromTo(
        element,
        {
          boxShadow: 'inset 0 0 0 2px rgb(215 180 106 / 44%), 0 0 1.2rem rgb(215 180 106 / 26%)',
          filter: 'brightness(1.16) saturate(1.08)',
          scale: 0.98,
        },
        {
          boxShadow: 'inset 0 0 0 0 rgb(215 180 106 / 0%), 0 0 0 rgb(215 180 106 / 0%)',
          clearProps: 'boxShadow,filter,scale',
          duration: 0.46,
          ease: 'power2.out',
          filter: 'brightness(1)',
          scale: 1,
        },
      );
    });
  }

  private isPopulatedHandTarget(element: HTMLElement): boolean {
    const handRoot = element.closest<HTMLElement>('.game-table-hand, .hand-fan');
    if (!handRoot || handRoot.classList.contains('hand-row-empty')) {
      return false;
    }

    const fanRoot = handRoot.classList.contains('hand-fan')
      ? handRoot
      : handRoot.querySelector<HTMLElement>('.hand-fan');

    return Boolean(fanRoot?.querySelector('.hand-card'));
  }

  prepareCardFlip(selector = '[data-card-instance-id], [data-motion-origin-card-id]'): () => void {
    const host = this.host;
    if (!host) {
      return () => undefined;
    }

    const elements = this.cardElements(selector);
    const state = Flip.getState(elements);
    const isHandFlip = selector.includes('data-zone="hand"') || elements.some((element) => element.dataset['zone'] === 'hand');
    const clearPreparedHandMotion = isHandFlip ? this.markHandMotionActive() : undefined;

    return () => {
      this.runInContext(() => {
        if (this.prefersReducedMotion()) {
          clearPreparedHandMotion?.();
          return;
        }

        Flip.from(state, {
          absolute: false,
          duration: 0.34,
          ease: 'power3.out',
          nested: true,
          onComplete: clearPreparedHandMotion,
          onInterrupt: clearPreparedHandMotion,
          prune: true,
          targets: this.cardElements(selector),
        });
      });
    };
  }

  prepareHandDropHandoff(selector = '[data-zone="hand"][data-card-instance-id]'): () => void {
    const host = this.host;
    if (!host) {
      return () => undefined;
    }

    const beforeElements = this.cardElements(selector);
    const beforeInstanceIds = this.cardInstanceIds(beforeElements);
    const beforeCount = beforeElements.length;
    const beforeSnapshots = this.handElementSnapshots(beforeElements);
    const clearPreparedHandMotion = this.markHandMotionActive();
    let cleared = false;
    let animationStarted = false;
    let clearFallbackTimer: number | null = null;
    let renderWatchFrame: number | null = null;
    const clearHandMotion = () => {
      if (cleared) {
        return;
      }

      cleared = true;
      stopRenderWatcher();
      if (clearFallbackTimer !== null) {
        window.clearTimeout(clearFallbackTimer);
        clearFallbackTimer = null;
      }
      clearPreparedHandMotion();
    };
    const scheduleClearFallback = () => {
      if (clearFallbackTimer !== null) {
        return;
      }

      clearFallbackTimer = window.setTimeout(clearHandMotion, 1200);
    };
    const stopRenderWatcher = () => {
      if (renderWatchFrame === null) {
        return;
      }

      window.cancelAnimationFrame(renderWatchFrame);
      renderWatchFrame = null;
    };
    const playPreparedMotion = (currentElements: HTMLElement[]): void => {
      if (animationStarted || cleared) {
        return;
      }

      animationStarted = true;
      stopRenderWatcher();
      scheduleClearFallback();
      this.runInContext(() => {
        if (this.prefersReducedMotion()) {
          clearHandMotion();
          return;
        }

        try {
          const addedElements = this.addedCardElements(currentElements, beforeInstanceIds, beforeCount);
          if (addedElements.length > 0 || currentElements.length > beforeCount) {
            this.animateHandGrowth(currentElements, addedElements);
          }

          if (currentElements.length > 0) {
            this.animateHandLayoutShift(currentElements, beforeSnapshots, {
              duration: currentElements.length > beforeCount ? 0.74 : 0.6,
              ease: currentElements.length > beforeCount ? 'power2.out' : 'power3.out',
              onComplete: clearHandMotion,
              onInterrupt: clearHandMotion,
            });
          } else {
            clearHandMotion();
          }
        } catch {
          clearHandMotion();
        }
      });
    };
    const playIfLayoutChanged = (): boolean => {
      const currentElements = this.cardElements(selector);
      if (!this.hasHandLayoutChanged(currentElements, beforeSnapshots)) {
        return false;
      }

      playPreparedMotion(currentElements);

      return true;
    };
    const watchRenderedLayout = () => {
      renderWatchFrame = null;
      if (cleared || animationStarted) {
        return;
      }

      if (playIfLayoutChanged()) {
        return;
      }

      renderWatchFrame = window.requestAnimationFrame(watchRenderedLayout);
    };

    renderWatchFrame = window.requestAnimationFrame(watchRenderedLayout);

    return () => {
      scheduleClearFallback();
      playIfLayoutChanged();
    };
  }

  prepareHandLayoutFlip(root: HTMLElement, selector = '[data-zone="hand"][data-card-instance-id]'): () => void {
    const elements = this.handCardElements(root, selector);
    if (elements.length === 0) {
      return () => undefined;
    }

    Flip.killFlipsOf(elements, true);
    const state = Flip.getState(elements);

    return () => {
      window.requestAnimationFrame(() => {
        this.runInContext(() => {
          if (this.prefersReducedMotion()) {
            return;
          }

          const currentElements = this.handCardElements(root, selector);
          if (currentElements.length === 0) {
            return;
          }

          Flip.killFlipsOf(currentElements, true);
          Flip.from(state, {
            absolute: false,
            duration: 0.48,
            ease: 'power3.out',
            nested: true,
            prune: true,
            scale: false,
            targets: currentElements,
          });
        });
      });
    };
  }

  private addedCardElements(
    currentElements: readonly HTMLElement[],
    beforeInstanceIds: ReadonlySet<string>,
    beforeCount: number,
  ): HTMLElement[] {
    const addedById = currentElements.filter((element) => {
      const instanceId = this.cardInstanceId(element);

      return instanceId !== null && !beforeInstanceIds.has(instanceId);
    });

    if (addedById.length > 0) {
      return addedById;
    }

    return currentElements.length > beforeCount
      ? currentElements.slice(beforeCount)
      : [];
  }

  private handElementSnapshots(elements: readonly HTMLElement[]): HandElementSnapshot[] {
    return elements.map((element) => {
      const rect = element.getBoundingClientRect();

      return {
        height: rect.height,
        instanceId: this.cardInstanceId(element),
        left: rect.left,
        top: rect.top,
        width: rect.width,
      };
    });
  }

  private hasHandLayoutChanged(
    currentElements: readonly HTMLElement[],
    beforeSnapshots: readonly HandElementSnapshot[],
  ): boolean {
    if (currentElements.length !== beforeSnapshots.length) {
      return true;
    }

    return currentElements.some((element, index) => {
      const beforeSnapshot = beforeSnapshots[index];
      if (!beforeSnapshot) {
        return true;
      }

      const instanceId = this.cardInstanceId(element);
      return instanceId !== beforeSnapshot.instanceId;
    });
  }

  private animateHandLayoutShift(
    currentElements: readonly HTMLElement[],
    beforeSnapshots: readonly HandElementSnapshot[],
    options: {
      readonly duration: number;
      readonly ease: string;
      readonly onComplete: () => void;
      readonly onInterrupt: () => void;
    },
  ): void {
    const snapshotsByInstanceId = new Map(beforeSnapshots
      .filter((snapshot) => snapshot.instanceId !== null)
      .map((snapshot) => [snapshot.instanceId, snapshot]));
    const shiftedElements: HTMLElement[] = [];
    const tolerance = 0.75;

    currentElements.forEach((element, index) => {
      const instanceId = this.cardInstanceId(element);
      const beforeSnapshot = instanceId ? snapshotsByInstanceId.get(instanceId) : beforeSnapshots[index];
      if (!beforeSnapshot) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const shiftX = beforeSnapshot.left - rect.left;
      const shiftY = beforeSnapshot.top - rect.top;

      if (Math.abs(shiftX) <= tolerance && Math.abs(shiftY) <= tolerance) {
        return;
      }

      element.style.setProperty('--hand-shift-x', `${shiftX}px`);
      element.style.setProperty('--hand-shift-y', `${shiftY}px`);
      shiftedElements.push(element);
    });

    if (shiftedElements.length === 0) {
      options.onComplete();
      return;
    }

    let finished = false;
    const clearShift = () => {
      shiftedElements.forEach((element) => {
        element.style.removeProperty('--hand-shift-x');
        element.style.removeProperty('--hand-shift-y');
      });
    };
    const finish = (callback: () => void) => {
      if (finished) {
        return;
      }

      finished = true;
      clearShift();
      callback();
    };

    gsap.killTweensOf(shiftedElements);
    gsap.to(shiftedElements, {
      '--hand-shift-x': '0px',
      '--hand-shift-y': '0px',
      duration: options.duration,
      ease: options.ease,
      onComplete: () => finish(options.onComplete),
      onInterrupt: () => finish(options.onInterrupt),
    });
  }

  private animateHandGrowth(currentElements: readonly HTMLElement[], addedElements: readonly HTMLElement[]): void {
    const handSurface = currentElements[0]?.closest<HTMLElement>('.hand-area')
      ?? currentElements[0]?.closest<HTMLElement>('.hand-fan')
      ?? null;

    if (handSurface) {
      gsap.killTweensOf(handSurface);
      gsap.fromTo(
        handSurface,
        {
          boxShadow: '0 -1.15rem 2.8rem rgb(215 180 106 / 18%), inset 0 0 0 1px rgb(215 180 106 / 22%)',
          filter: 'brightness(1.08) saturate(1.06)',
        },
        {
          boxShadow: '0 0 0 rgb(215 180 106 / 0%), inset 0 0 0 0 rgb(215 180 106 / 0%)',
          clearProps: 'boxShadow,filter',
          duration: 0.58,
          ease: 'power2.out',
          filter: 'brightness(1)',
        },
      );
    }

    if (addedElements.length === 0) {
      return;
    }

    gsap.killTweensOf(addedElements);
    gsap.fromTo(
      addedElements,
      {
        filter: 'brightness(1.28) saturate(1.14)',
      },
      {
        clearProps: 'filter',
        duration: 0.42,
        ease: 'power2.out',
        filter: 'brightness(1)',
        stagger: 0.025,
      },
    );
  }

  private markHandMotionActive(): () => void {
    const host = this.host;
    if (!host) {
      return () => undefined;
    }

    let cleared = false;
    this.handMotionActiveCount += 1;
    this.handMotionActiveState.set(true);

    return () => {
      if (cleared) {
        return;
      }

      cleared = true;
      this.handMotionActiveCount = Math.max(0, this.handMotionActiveCount - 1);
      if (this.handMotionActiveCount === 0) {
        this.handMotionActiveState.set(false);
      }
    };
  }

  prepareCardRotationFlip(instanceId: string): () => void {
    const source = this.findCard(instanceId);
    if (!source) {
      return () => undefined;
    }

    const state = Flip.getState(source);

    return () => {
      this.runInContext(() => {
        const target = this.findCard(instanceId);
        if (!target) {
          return;
        }

        gsap.killTweensOf(target);
        target.classList.add('cz-card-rotation-flip');

        if (this.prefersReducedMotion()) {
          gsap.fromTo(
            target,
            { filter: 'brightness(1.08)' },
            {
              clearProps: 'filter',
              duration: 0.14,
              ease: 'power1.out',
              onComplete: () => target.classList.remove('cz-card-rotation-flip'),
            },
          );
          return;
        }

        Flip.from(state, {
          absolute: false,
          duration: 0.28,
          ease: 'power2.inOut',
          nested: true,
          prune: true,
          targets: [target],
          onComplete: () => target.classList.remove('cz-card-rotation-flip'),
        });
      });
    };
  }

  private runInContext(animation: () => void): void {
    if (!this.context) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.context?.add(animation);
    });
  }

  private findCard(instanceId: string): HTMLElement | null {
    const candidates = this.cardElements('[data-card-instance-id], [data-motion-origin-card-id]')
      .filter((element) =>
        element.dataset['cardInstanceId'] === instanceId
        || element.dataset['motionOriginCardId'] === instanceId,
      );

    return this.bestVisibleElement(candidates);
  }

  private cardElements(selector: string): HTMLElement[] {
    return this.host ? Array.from(this.host.querySelectorAll<HTMLElement>(selector)) : [];
  }

  private handCardElements(root: HTMLElement, selector: string): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  }

  private cardInstanceIds(elements: readonly HTMLElement[]): ReadonlySet<string> {
    return new Set(elements
      .map((element) => this.cardInstanceId(element))
      .filter((instanceId): instanceId is string => instanceId !== null));
  }

  private cardInstanceId(element: HTMLElement): string | null {
    return element.dataset['cardInstanceId'] ?? element.dataset['motionOriginCardId'] ?? null;
  }

  private resolveTarget(target: HTMLElement | string): HTMLElement | null {
    if (target instanceof HTMLElement) {
      return this.isVisibleTarget(target) ? target : null;
    }

    return this.bestVisibleElement(this.cardElements(target));
  }

  private createGhost(source: HTMLElement, sourceRect: MotionRect): HTMLElement | null {
    const host = this.host;
    if (!host || sourceRect.width <= 0 || sourceRect.height <= 0) {
      return null;
    }

    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('cz-motion-ghost');
    ghost.style.position = 'fixed';
    ghost.style.left = `${sourceRect.left}px`;
    ghost.style.top = `${sourceRect.top}px`;
    ghost.style.zIndex = '5000';
    ghost.style.width = `${sourceRect.width}px`;
    ghost.style.height = `${sourceRect.height}px`;
    ghost.style.margin = '0';
    ghost.style.pointerEvents = 'none';
    ghost.style.transformOrigin = '50% 50%';
    ghost.style.willChange = 'transform, opacity';
    document.body.appendChild(ghost);

    return ghost;
  }

  private bestVisibleElement(elements: readonly HTMLElement[]): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestArea = 0;

    for (const element of elements) {
      if (!this.isVisibleTarget(element)) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = element;
        bestArea = area;
      }
    }

    return best;
  }

  private isVisibleTarget(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = window.getComputedStyle(element);

    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0';
  }

  private punchConfig(variant: CardPunchVariant): {
    readonly duration: number;
    readonly filter: string;
    readonly rotate: number;
    readonly scale: number;
    readonly y: number;
  } {
    switch (variant) {
      case 'tap':
        return { duration: 0.3, filter: 'brightness(1.2) saturate(1.08)', rotate: -4, scale: 1.04, y: 0 };
      case 'damage':
        return { duration: 0.36, filter: 'brightness(1.28) saturate(1.18)', rotate: 3, scale: 1.06, y: -3 };
      case 'play':
        return { duration: 0.34, filter: 'brightness(1.22) saturate(1.1)', rotate: 0, scale: 1.07, y: -4 };
    }
  }

  private prefersReducedMotion(): boolean {
    return this.reducedMotionQuery?.matches ?? false;
  }

}
