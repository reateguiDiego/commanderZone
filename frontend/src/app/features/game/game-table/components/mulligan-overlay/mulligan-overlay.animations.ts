import { ElementRef, NgZone } from '@angular/core';
import { gsap } from 'gsap';
import { MulliganRule } from '../../../../../core/models/game.model';

export class MulliganOverlayAnimations {
  private context: gsap.Context | null;
  private handAnimationFrame: number | null = null;
  private pillAnimationFrame: number | null = null;
  private handTimeline: gsap.core.Timeline | null = null;
  private selectedCardsTween: gsap.core.Tween | null = null;
  private knownPillIds = new Set<string>();
  private lastHandKey = '';
  private readonly floatingClones = new Set<HTMLElement>();

  constructor(
    private readonly hostRef: ElementRef<HTMLElement>,
    private readonly ngZone: NgZone,
  ) {
    this.context = gsap.context(() => undefined, this.host);
  }

  syncHand(handKey: string): void {
    if (!handKey) {
      this.lastHandKey = '';
      this.cancelHandFrame();
      return;
    }

    if (handKey === this.lastHandKey) {
      return;
    }

    this.lastHandKey = handKey;
    this.cancelHandFrame();
    this.handAnimationFrame = this.requestFrame(() => {
      this.handAnimationFrame = null;
      this.animateHandEntry();
    });
  }

  syncPills(selectedIds: readonly string[]): void {
    const nextIds = new Set(selectedIds);
    const addedIds = selectedIds.filter((id) => !this.knownPillIds.has(id));
    this.knownPillIds = nextIds;

    if (addedIds.length === 0) {
      return;
    }

    this.cancelPillFrame();
    this.pillAnimationFrame = this.requestFrame(() => {
      this.pillAnimationFrame = null;
      this.animatePillEntry(addedIds);
    });
  }

  animateHandExit(): void {
    const cards = this.handCardElements();
    if (cards.length === 0) {
      return;
    }

    this.runInContext(() => {
      this.handTimeline?.kill();
      gsap.killTweensOf(cards);

      if (this.prefersReducedMotion()) {
        this.handTimeline = gsap.timeline();
        this.handTimeline.to(cards, {
          autoAlpha: 0.42,
          duration: 0.12,
          ease: 'power1.out',
        });
        return;
      }

      this.handTimeline = gsap.timeline();
      this.handTimeline.to(cards, {
        autoAlpha: 0,
        duration: 0.3,
        ease: 'power2.in',
        rotate: (index: number) => (index % 2 === 0 ? -2.5 : 2.5),
        scale: 0.92,
        stagger: {
          amount: Math.min(0.18, cards.length * 0.018),
          from: 'end',
        },
        x: (index: number) => (index - (cards.length - 1) / 2) * 10,
        y: 96,
      });
    });
  }

  animateSelectedCardsToLibrary(instanceIds: readonly string[], rule: MulliganRule): void {
    const selectedCards = instanceIds
      .map((instanceId) => this.findHandCard(instanceId))
      .filter((card): card is HTMLElement => card !== null);

    if (selectedCards.length === 0) {
      return;
    }

    this.runInContext(() => {
      this.selectedCardsTween?.kill();
      gsap.killTweensOf(selectedCards);

      if (this.prefersReducedMotion()) {
        this.selectedCardsTween = gsap.to(selectedCards, {
          autoAlpha: 0.45,
          duration: 0.12,
          ease: 'power1.out',
        });
        return;
      }

      const isGenerous = rule === 'GENEROUS';
      this.selectedCardsTween = gsap.to(selectedCards, {
        autoAlpha: 0,
        duration: 0.28,
        ease: 'power2.in',
        rotate: (index: number) => isGenerous ? (index % 2 === 0 ? 4 : -4) : 2 + index * 0.4,
        scale: 0.88,
        stagger: isGenerous ? 0 : 0.035,
        x: (index: number) => isGenerous ? (index % 2 === 0 ? -28 : 28) : 18 + index * 8,
        y: 112,
      });
    });
  }

  animatePillRemoval(instanceId: string): void {
    const pill = this.findBottomPill(instanceId);
    if (!pill) {
      return;
    }

    const rect = pill.getBoundingClientRect();
    const clone = pill.cloneNode(true) as HTMLElement;
    clone.setAttribute('aria-hidden', 'true');
    clone.classList.add('bottom-pill-floating');
    Object.assign(clone.style, {
      height: `${rect.height}px`,
      left: `${rect.left}px`,
      margin: '0',
      pointerEvents: 'none',
      position: 'fixed',
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      zIndex: '4700',
    });

    document.body.appendChild(clone);
    this.floatingClones.add(clone);

    this.runInContext(() => {
      const reducedMotion = this.prefersReducedMotion();
      gsap.to(clone, {
        autoAlpha: 0,
        duration: reducedMotion ? 0.08 : 0.16,
        ease: 'power1.out',
        onComplete: () => this.removeFloatingClone(clone),
        scale: reducedMotion ? 1 : 0.94,
        y: reducedMotion ? 0 : -6,
      });
    });
  }

  resetTransientState(): void {
    this.knownPillIds.clear();
    this.lastHandKey = '';
    this.cancelHandFrame();
    this.cancelPillFrame();
  }

  destroy(): void {
    this.cancelHandFrame();
    this.cancelPillFrame();
    this.handTimeline?.kill();
    this.selectedCardsTween?.kill();
    this.removeFloatingClones();
    this.context?.revert();
    this.context = null;
  }

  private animateHandEntry(): void {
    const cards = this.handCardElements();
    if (cards.length === 0) {
      return;
    }

    this.runInContext(() => {
      this.handTimeline?.kill();
      gsap.killTweensOf(cards);

      if (this.prefersReducedMotion()) {
        this.handTimeline = gsap.timeline();
        this.handTimeline.fromTo(cards, { autoAlpha: 0 }, {
          autoAlpha: 1,
          clearProps: 'opacity,visibility',
          duration: 0.12,
          ease: 'power1.out',
        });
        return;
      }

      this.handTimeline = gsap.timeline();
      this.handTimeline.fromTo(
        cards,
        {
          autoAlpha: 0,
          rotate: (index: number) => (index % 2 === 0 ? -3 : 3),
          scale: 0.965,
          y: 28,
        },
        {
          autoAlpha: 1,
          clearProps: 'opacity,visibility,rotate,scale,transform,y',
          duration: 0.46,
          ease: 'power3.out',
          rotate: 0,
          scale: 1,
          stagger: Math.min(0.045, 0.26 / Math.max(cards.length, 1)),
          y: 0,
        },
      );
    });
  }

  private animatePillEntry(instanceIds: readonly string[]): void {
    const pills = instanceIds
      .map((instanceId) => this.findBottomPill(instanceId))
      .filter((pill): pill is HTMLElement => pill !== null);

    if (pills.length === 0) {
      return;
    }

    this.runInContext(() => {
      gsap.killTweensOf(pills);

      if (this.prefersReducedMotion()) {
        gsap.fromTo(pills, { autoAlpha: 0 }, {
          autoAlpha: 1,
          clearProps: 'opacity,visibility',
          duration: 0.1,
          ease: 'power1.out',
        });
        return;
      }

      gsap.fromTo(
        pills,
        { autoAlpha: 0, scale: 0.96, y: 6 },
        {
          autoAlpha: 1,
          clearProps: 'opacity,visibility,scale,transform,y',
          duration: 0.22,
          ease: 'power2.out',
          scale: 1,
          stagger: 0.025,
          y: 0,
        },
      );
    });
  }

  private runInContext(animation: () => void): void {
    if (!this.context) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.context?.add(animation);
    });
  }

  private handCardElements(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>('.mulligan-card[data-card-instance-id]'));
  }

  private findHandCard(instanceId: string): HTMLElement | null {
    return this.host.querySelector<HTMLElement>(`.mulligan-card[data-card-instance-id="${cssEscape(instanceId)}"]`);
  }

  private findBottomPill(instanceId: string): HTMLElement | null {
    return this.host.querySelector<HTMLElement>(`[data-bottom-pill-id="${cssEscape(instanceId)}"]`);
  }

  private get host(): HTMLElement {
    return this.hostRef.nativeElement;
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private requestFrame(callback: FrameRequestCallback): number {
    return window.requestAnimationFrame(callback);
  }

  private cancelHandFrame(): void {
    if (this.handAnimationFrame !== null) {
      window.cancelAnimationFrame(this.handAnimationFrame);
      this.handAnimationFrame = null;
    }
  }

  private cancelPillFrame(): void {
    if (this.pillAnimationFrame !== null) {
      window.cancelAnimationFrame(this.pillAnimationFrame);
      this.pillAnimationFrame = null;
    }
  }

  private removeFloatingClone(clone: HTMLElement): void {
    clone.remove();
    this.floatingClones.delete(clone);
  }

  private removeFloatingClones(): void {
    for (const clone of this.floatingClones) {
      clone.remove();
    }

    this.floatingClones.clear();
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
