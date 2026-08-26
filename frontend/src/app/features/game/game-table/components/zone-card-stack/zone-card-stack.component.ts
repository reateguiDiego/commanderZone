import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { gsap } from 'gsap';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';

interface ZoneCardStackLayer {
  key: number;
  zIndex: number;
  offset: number;
}

interface ShuffleCardMotion {
  x: number;
  y: number;
  rotation: number;
}

interface ShuffleCardVariation {
  horizontalScale: number;
  verticalScale: number;
  rotationScale: number;
  verticalOffset: number;
}

@Component({
  selector: 'app-zone-card-stack',
  imports: [LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './zone-card-stack.component.html',
  styleUrl: './zone-card-stack.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneCardStackComponent implements OnDestroy {
  private readonly maxVisualCards = 10;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly image = input.required<string>();
  readonly layerImage = input<string | null>(null);
  readonly faceToggleEnabled = input(false);
  readonly label = input.required<string>();
  readonly count = input.required<number>();
  readonly showRevealIndicator = input(false);
  readonly shufflePlayerId = input<string | null>(null);
  readonly shuffleRevision = input<number | null>(null);

  private readonly topCard = viewChild<ElementRef<HTMLImageElement>>('topCard');
  private readonly shuffleTopCardImage = signal<string | null>(null);
  private readonly alternateFaceVisible = signal(false);
  private revealAnimation: gsap.core.Tween | null = null;
  private shuffleAnimation: gsap.core.Timeline | null = null;
  private restoreShuffleStacking: (() => void) | null = null;
  private visibilitySignature: string | null = null;
  private lastShufflePlayerId: string | null = null;
  private lastShuffleRevision: number | null = null;
  private shuffleRevisionInitialized = false;
  readonly alternateFaceToggled = output<{ event: MouseEvent; showingAlternateFace: boolean }>();
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
  private readonly animateShuffle = effect(() => {
    const playerId = this.shufflePlayerId();
    const revision = this.shuffleRevision();

    if (!this.shuffleRevisionInitialized || playerId !== this.lastShufflePlayerId) {
      this.shuffleRevisionInitialized = true;
      this.lastShufflePlayerId = playerId;
      this.lastShuffleRevision = revision;
      return;
    }

    if (revision === null || revision === this.lastShuffleRevision) {
      this.lastShuffleRevision = revision;
      return;
    }

    this.lastShuffleRevision = revision;
    untracked(() => this.playShuffleAnimation());
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
  readonly canShowFaceToggle = computed(() => this.faceToggleEnabled());
  readonly renderedTopCardImage = computed(() => this.shuffleTopCardImage() ?? this.image());

  ngOnDestroy(): void {
    this.stopRevealAnimation();
    this.stopShuffleAnimation();
  }

  toggleAlternateFace(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.alternateFaceVisible.update((visible) => {
      const showingAlternateFace = !visible;
      this.alternateFaceToggled.emit({ event, showingAlternateFace });
      return showingAlternateFace;
    });
  }

  stopFaceTogglePointer(event: PointerEvent): void {
    event.stopPropagation();
    if (event.button === 0) {
      event.preventDefault();
    }
  }

  private playRevealAnimation(topCard: HTMLImageElement): void {
    if (topCard.getClientRects().length === 0 || topCard.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    this.stopRevealAnimation();
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

  private playShuffleAnimation(): void {
    const cards = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.zone-card-stack-layer, .zone-card-stack-top'));
    if (cards.length === 0 || cards[0]?.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    this.stopRevealAnimation();
    this.stopShuffleAnimation();
    gsap.killTweensOf(cards);
    this.host.nativeElement.classList.add('is-shuffling');
    this.maskRevealedTopCardDuringShuffle();

    const variations = cards.map(() => this.shuffleCardVariation());
    const spread = cards.map((_card, index) => this.shuffleSpreadMotion(index, cards.length, variations[index]!));
    const interleave = cards.map((_card, index) => this.shuffleInterleaveMotion(index, cards.length, variations[index]!));
    const originalZIndexes = cards.map((card) => card.style.zIndex);
    const topCardIndex = cards.length - 1;
    const promotedCardIndex = this.promotedCardIndex(cards.length);
    const shuffleZIndexBase = 3_201;
    const initialZIndexes = cards.map((_card, index) => index === topCardIndex ? shuffleZIndexBase + 20 : shuffleZIndexBase + index);
    const interleavedZIndexes = cards.map((_card, index) => {
      if (index === promotedCardIndex) {
        return shuffleZIndexBase + 21;
      }

      return index === topCardIndex ? shuffleZIndexBase + 10 : shuffleZIndexBase + index;
    });

    this.restoreShuffleStacking = () => {
      cards.forEach((card, index) => {
        card.style.zIndex = originalZIndexes[index] ?? '';
      });
      this.restoreShuffleStacking = null;
    };

    this.shuffleAnimation = gsap.timeline({
      defaults: { overwrite: 'auto' },
      onComplete: () => {
        this.restoreShuffleStacking?.();
        this.clearShuffleTopCardMask();
        this.host.nativeElement.classList.remove('is-shuffling');
        this.shuffleAnimation = null;
      },
    })
      .set(cards, {
        transformOrigin: '50% 50%',
        autoAlpha: 1,
        willChange: 'transform',
        zIndex: (index) => initialZIndexes[index] ?? 1,
      })
      .to(cards, {
        x: (index) => spread[index]?.x ?? 0,
        y: (index) => spread[index]?.y ?? 0,
        rotation: (index) => spread[index]?.rotation ?? 0,
        duration: 0.16,
        ease: 'power2.out',
        stagger: { each: 0.018, from: 'center' },
      })
      .set(cards, {
        zIndex: (index) => interleavedZIndexes[index] ?? 1,
      })
      .to(cards, {
        x: (index) => interleave[index]?.x ?? 0,
        y: (index) => interleave[index]?.y ?? 0,
        rotation: (index) => interleave[index]?.rotation ?? 0,
        duration: 0.16,
        ease: 'power1.inOut',
        stagger: { each: 0.014, from: 'edges' },
      })
      .to(cards, {
        x: 0,
        y: 0,
        rotation: 0,
        duration: 0.18,
        ease: 'power2.inOut',
        stagger: { each: 0.014, from: 'end' },
      })
      .set(cards, { clearProps: 'transform,willChange,opacity,visibility' });
  }

  private stopRevealAnimation(): void {
    this.revealAnimation?.kill();
    this.revealAnimation = null;

    const topCard = this.topCard()?.nativeElement;
    if (topCard) {
      gsap.set(topCard, { clearProps: 'transform,opacity,visibility' });
    }
  }

  private stopShuffleAnimation(): void {
    this.shuffleAnimation?.kill();
    this.shuffleAnimation = null;
    this.restoreShuffleStacking?.();
    this.clearShuffleTopCardMask();
    this.host.nativeElement.classList.remove('is-shuffling');
  }

  private maskRevealedTopCardDuringShuffle(): void {
    const cardBackImage = this.layerImage();
    if (!this.showRevealIndicator() || !cardBackImage) {
      return;
    }

    this.shuffleTopCardImage.set(cardBackImage);
  }

  private clearShuffleTopCardMask(): void {
    this.shuffleTopCardImage.set(null);
  }

  private promotedCardIndex(cardCount: number): number | null {
    if (cardCount < 2) {
      return null;
    }

    return Math.floor(Math.random() * (cardCount - 1));
  }

  private shuffleCardVariation(): ShuffleCardVariation {
    return {
      horizontalScale: 0.8 + Math.random() * 0.45,
      verticalScale: 0.8 + Math.random() * 0.5,
      rotationScale: 0.78 + Math.random() * 0.44,
      verticalOffset: (Math.random() - 0.5) * 5,
    };
  }

  private shuffleSpreadMotion(index: number, total: number, variation: ShuffleCardVariation): ShuffleCardMotion {
    const direction = index % 2 === 0 ? -1 : 1;
    const depth = Math.floor(index / 2);
    const centeredIndex = index - (total - 1) / 2;
    const verticalDirection = index % 3 === 0 ? -1 : index % 3 === 1 ? 1 : -0.45;

    return {
      x: (direction * (12 + depth * 4) + centeredIndex * 1.1) * variation.horizontalScale,
      y: verticalDirection * (10 + (depth % 3) * 3.5) * variation.verticalScale + variation.verticalOffset,
      rotation: direction * (5 + (index % 4) * 2) * variation.rotationScale,
    };
  }

  private shuffleInterleaveMotion(index: number, total: number, variation: ShuffleCardVariation): ShuffleCardMotion {
    const direction = index % 2 === 0 ? 1 : -1;
    const depth = Math.floor(index / 2);
    const centeredIndex = index - (total - 1) / 2;
    const verticalOffsets = [-8, 7, -4, 10];

    return {
      x: (direction * (6 + depth * 2) - centeredIndex * 0.8) * variation.horizontalScale,
      y: (verticalOffsets[index % verticalOffsets.length] ?? 0) * variation.verticalScale + variation.verticalOffset,
      rotation: direction * (2.5 + (index % 3) * 1.4) * variation.rotationScale,
    };
  }
}
