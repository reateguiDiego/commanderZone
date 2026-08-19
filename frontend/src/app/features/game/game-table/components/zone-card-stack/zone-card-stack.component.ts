import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, input, untracked, viewChild } from '@angular/core';
import { gsap } from 'gsap';

interface ZoneCardStackLayer {
  key: number;
  zIndex: number;
  offset: number;
}

@Component({
  selector: 'app-zone-card-stack',
  templateUrl: './zone-card-stack.component.html',
  styleUrl: './zone-card-stack.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneCardStackComponent implements OnDestroy {
  private readonly maxVisualCards = 10;

  readonly image = input.required<string>();
  readonly layerImage = input<string | null>(null);
  readonly label = input.required<string>();
  readonly count = input.required<number>();
  readonly showRevealIndicator = input(false);

  private readonly topCard = viewChild<ElementRef<HTMLImageElement>>('topCard');
  private revealAnimation: gsap.core.Tween | null = null;
  private visibilitySignature: string | null = null;
  private readonly animateVisibilityChange = effect(() => {
    const signature = `${this.image()}|${this.showRevealIndicator()}`;
    const topCard = this.topCard()?.nativeElement;
    if (!topCard) {
      return;
    }
    if (this.visibilitySignature === null) {
      this.visibilitySignature = signature;
      return;
    }
    if (this.visibilitySignature === signature) {
      return;
    }
    this.visibilitySignature = signature;
    untracked(() => this.playRevealAnimation(topCard));
  });

  readonly stackLayers = computed(() => {
    const visualCardCount = this.layerImage() ? Math.min(this.maxVisualCards, Math.max(0, Math.floor(this.count()))) : 1;
    const layerCount = Math.max(0, visualCardCount - 1);
    const maxOffset = 7;

    return Array.from({ length: layerCount }, (_value, index): ZoneCardStackLayer => {
      const depthFromTop = index + 1;
      const normalizedDepth = layerCount <= 1 ? 1 : depthFromTop / layerCount;

      return {
        key: depthFromTop,
        zIndex: layerCount - index,
        offset: Math.round(maxOffset * normalizedDepth * 100) / 100,
      };
    });
  });

  ngOnDestroy(): void {
    this.revealAnimation?.kill();
  }

  private playRevealAnimation(topCard: HTMLImageElement): void {
    if (topCard.getClientRects().length === 0 || topCard.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    this.revealAnimation?.kill();
    gsap.killTweensOf(topCard);
    this.revealAnimation = gsap.fromTo(topCard, {
      autoAlpha: 0,
      scale: 0.94,
      rotateY: -10,
    }, {
      autoAlpha: 1,
      scale: 1,
      rotateY: 0,
      duration: 0.22,
      ease: 'power2.out',
      clearProps: 'transform,opacity,visibility',
      onComplete: () => {
        this.revealAnimation = null;
      },
    });
  }
}
