import { ElementRef, NgZone } from '@angular/core';
import { gsap } from 'gsap';
import { MulliganRule } from '../../../../../core/models/game.model';

export class MulliganOverlayAnimations {
  private readonly maxHandImageWaitMs = 4000;
  private context: gsap.Context | null;
  private handAnimationFrame: number | null = null;
  private handTimeline: gsap.core.Timeline | null = null;
  private selectedCardsTween: gsap.core.Tween | null = null;
  private lastHandKey = '';
  private handEntryRunId = 0;

  constructor(
    private readonly hostRef: ElementRef<HTMLElement>,
    private readonly ngZone: NgZone,
  ) {
    this.context = gsap.context(() => undefined, this.host);
  }

  syncHand(handKey: string): void {
    if (!handKey) {
      this.lastHandKey = '';
      this.handEntryRunId += 1;
      this.cancelHandFrame();
      return;
    }

    if (handKey === this.lastHandKey) {
      return;
    }

    this.lastHandKey = handKey;
    const runId = ++this.handEntryRunId;
    this.cancelHandFrame();
    this.handAnimationFrame = this.requestFrame(() => {
      this.handAnimationFrame = null;
      void this.animateHandEntry(runId);
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

  resetTransientState(): void {
    this.lastHandKey = '';
    this.handEntryRunId += 1;
    this.cancelHandFrame();
  }

  destroy(): void {
    this.handEntryRunId += 1;
    this.cancelHandFrame();
    this.handTimeline?.kill();
    this.selectedCardsTween?.kill();
    this.context?.revert();
    this.context = null;
  }

  private async animateHandEntry(runId: number): Promise<void> {
    const cards = this.handCardElements();
    if (cards.length === 0) {
      return;
    }

    this.runInContext(() => {
      this.handTimeline?.kill();
      gsap.killTweensOf(cards);
      gsap.set(cards, { autoAlpha: 0 });
    });

    await this.waitForHandImages(cards);

    if (runId !== this.handEntryRunId) {
      return;
    }

    this.runInContext(() => {
      this.handTimeline?.kill();
      gsap.killTweensOf(cards);

      if (this.prefersReducedMotion()) {
        this.handTimeline = gsap.timeline();
        cards.forEach((card, index) => {
          this.handTimeline?.fromTo(card, { autoAlpha: 0 }, {
            autoAlpha: 1,
            clearProps: 'opacity,visibility',
            duration: 0.12,
            ease: 'power1.out',
          }, index * 0.035);
        });
        return;
      }

      this.handTimeline = gsap.timeline();
      const centerIndex = (cards.length - 1) / 2;

      cards.forEach((card, index) => {
        const distanceFromCenter = index - centerIndex;
        const direction = distanceFromCenter === 0 ? (index % 2 === 0 ? -1 : 1) : Math.sign(distanceFromCenter);
        const delay = index * 0.072;

        this.handTimeline?.fromTo(
          card,
          {
            autoAlpha: 0,
            filter: 'blur(0.35rem)',
            rotate: direction * (4.5 + (index % 3)),
            scale: 0.88,
            x: direction * (18 + Math.abs(distanceFromCenter) * 4),
            y: 64 + (index % 2) * 16,
          },
          {
            autoAlpha: 1,
            clearProps: 'opacity,visibility,rotate,scale,transform,x,y,filter',
            duration: 0.62,
            ease: 'back.out(1.35)',
            filter: 'blur(0)',
            rotate: 0,
            scale: 1,
            x: 0,
            y: 0,
          },
          delay,
        );
      });
    });
  }

  animateFaceFlip(instanceId: string): void {
    const cardVisual = this.findCardVisual(instanceId);
    if (!cardVisual) {
      return;
    }

    this.runInContext(() => {
      gsap.killTweensOf(cardVisual);

      if (this.prefersReducedMotion()) {
        gsap.fromTo(cardVisual, { autoAlpha: 0.72 }, {
          autoAlpha: 1,
          clearProps: 'opacity,visibility',
          duration: 0.14,
          ease: 'power1.out',
        });
        return;
      }

      gsap.timeline()
        .fromTo(cardVisual, {
          filter: 'brightness(1) saturate(1)',
          rotateY: 0,
          scale: 1,
        }, {
          duration: 0.22,
          ease: 'power2.in',
          filter: 'brightness(1.32) saturate(1.14)',
          rotateY: 78,
          scale: 1.035,
        })
        .to(cardVisual, {
          clearProps: 'filter,rotateY,scale,transform',
          duration: 0.34,
          ease: 'back.out(1.12)',
          filter: 'brightness(1)',
          rotateY: 0,
          scale: 1,
        });
    });
  }

  private async waitForHandImages(cards: readonly HTMLElement[]): Promise<void> {
    const images = cards
      .map((card) => card.querySelector<HTMLImageElement>('.card-visual img'))
      .filter((image): image is HTMLImageElement => image !== null);

    if (images.length === 0) {
      return;
    }

    await Promise.race([
      Promise.all(images.map((image) => this.waitForImage(image))),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, this.maxHandImageWaitMs);
      }),
    ]);
  }

  private async waitForImage(image: HTMLImageElement): Promise<void> {
    if (image.complete) {
      await this.decodeImage(image);
      return;
    }

    await new Promise<void>((resolve) => {
      const finish = (): void => {
        image.removeEventListener('load', finish);
        image.removeEventListener('error', finish);
        resolve();
      };

      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
    });

    await this.decodeImage(image);
  }

  private async decodeImage(image: HTMLImageElement): Promise<void> {
    if (!image.decode) {
      return;
    }

    try {
      await image.decode();
    } catch {
      // Broken or cross-origin images should not block the mulligan UI indefinitely.
    }
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

  private findCardVisual(instanceId: string): HTMLElement | null {
    return this.host.querySelector<HTMLElement>(
      `[data-card-instance-id="${cssEscape(instanceId)}"] .card-visual`,
    );
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

}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
