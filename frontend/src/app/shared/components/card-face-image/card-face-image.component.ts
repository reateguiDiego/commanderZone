import { ChangeDetectionStrategy, Component, ElementRef, HostBinding, OnDestroy, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { gsap } from 'gsap';
import { Card, CardFace } from '../../../core/models/card.model';
import { DeviceProfileService } from '../../services/device-profile.service';
import { CardFaceToggleButtonComponent, CardFaceToggleButtonSize } from '../card-face-toggle-button/card-face-toggle-button.component';
import { CardFaceImageSource, cardDisplayFace, cardFaceImage, hasAlternateCardFace, readableCardFaceImage } from '../../utils/card-faces';

export type CardFaceImageVariant = 'result' | 'spoiler' | 'detail' | 'printing';

@Component({
  selector: 'app-card-face-image',
  imports: [CardFaceToggleButtonComponent],
  templateUrl: './card-face-image.component.html',
  styleUrl: './card-face-image.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardFaceImageComponent implements OnDestroy {
  private readonly device = inject(DeviceProfileService);
  readonly card = input.required<CardFaceImageSource | Card>();
  readonly variant = input<CardFaceImageVariant>('result');
  readonly battle = input(false);
  readonly loading = input<'lazy' | 'eager'>('lazy');
  readonly fallback = input<string | null>(null);
  readonly preferLarge = input(false);
  readonly showToggle = input(true);
  readonly controlledFlipped = input<boolean | null>(null);
  readonly flippedChange = output<boolean>();

  readonly flipped = signal(false);
  readonly hasAlternateFace = computed(() => hasAlternateCardFace(this.card()));
  readonly visibleFace = computed<CardFace | null>(() => cardDisplayFace(this.card(), this.flipped()));
  readonly imageUrl = computed(() => this.preferLarge()
    ? readableCardFaceImage(this.card(), this.flipped())
    : cardFaceImage(this.card(), this.flipped()));
  readonly displayName = computed(() => this.fallback()?.trim() || this.card().name);
  readonly toggleSize = computed<CardFaceToggleButtonSize>(() => {
    switch (this.variant()) {
      case 'detail':
      case 'spoiler':
        return 'lg';
      case 'result':
        return 'md';
      default:
        return 'md';
    }
  });
  readonly altText = computed(() => {
    const suffix = this.flipped() ? 'back face' : 'front face';

    return `${this.card().name} - ${suffix}`;
  });
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private animation: gsap.core.Tween | null = null;
  private pendingFlipFrame: number | null = null;
  private lastControlledFlip: boolean | null = null;
  private readonly syncControlledFlip = effect(() => {
    const controlledFlipped = this.controlledFlipped();
    const nextFlipped = this.hasAlternateFace() ? (controlledFlipped ?? false) : false;

    if (controlledFlipped === null) {
      this.lastControlledFlip = null;
      return;
    }

    if (this.lastControlledFlip === null) {
      this.lastControlledFlip = nextFlipped;
      this.setFaceFlipped(nextFlipped, { animate: false, emit: false });
      return;
    }

    if (this.lastControlledFlip === nextFlipped) {
      return;
    }

    this.lastControlledFlip = nextFlipped;
    this.setFaceFlipped(nextFlipped, { animate: true, emit: false });
  }, { allowSignalWrites: true });

  ngOnDestroy(): void {
    this.animation?.kill();
    this.clearPendingFlipFrame();
  }

  @HostBinding('class.card-face-image--battle')
  get isBattle(): boolean {
    const visibleFaceType = this.visibleFace()?.typeLine?.trim().toLowerCase();
    if (visibleFaceType) {
      return visibleFaceType.startsWith('battle');
    }

    return this.battle();
  }

  @HostBinding('class.card-face-image--result')
  get isResult(): boolean {
    return this.variant() === 'result';
  }

  @HostBinding('class.card-face-image--spoiler')
  get isSpoiler(): boolean {
    return this.variant() === 'spoiler';
  }

  @HostBinding('class.card-face-image--detail')
  get isDetail(): boolean {
    return this.variant() === 'detail';
  }

  @HostBinding('class.card-face-image--printing')
  get isPrinting(): boolean {
    return this.variant() === 'printing';
  }

  toggleFace(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    event?.stopImmediatePropagation?.();

    if (!this.hasAlternateFace()) {
      return;
    }

    this.setFaceFlipped(!this.flipped(), { animate: true, emit: true });
  }

  private setFaceFlipped(nextFlipped: boolean, options: { animate: boolean; emit: boolean }): void {
    if (this.flipped() === nextFlipped) {
      return;
    }

    const stage = this.stage()?.nativeElement;
    if (!stage) {
      this.flipped.set(nextFlipped);
      if (options.emit) {
        this.flippedChange.emit(this.flipped());
      }
      return;
    }

    this.clearPendingFlipFrame();
    this.animation?.kill();
    gsap.killTweensOf(stage);

    if (!options.animate || this.shouldSkipFlipAnimation()) {
      gsap.set(stage, { clearProps: 'transform' });
      this.flipped.set(nextFlipped);
      if (options.emit) {
        this.flippedChange.emit(this.flipped());
      }
      this.animation = null;
      return;
    }

    this.animation = gsap.to(stage, {
      rotateY: 90,
      duration: 0.16,
      ease: 'power2.in',
      onComplete: () => {
        this.flipped.set(nextFlipped);
        if (options.emit) {
          this.flippedChange.emit(this.flipped());
        }
        this.runAfterNextFrame(() => {
          gsap.set(stage, { rotateY: -90 });
          this.animation = gsap.to(stage, {
            rotateY: 0,
            duration: 0.16,
            ease: 'power2.out',
            onComplete: () => {
              gsap.set(stage, { clearProps: 'transform' });
              this.animation = null;
            },
          });
        });
      },
    });
  }

  private runAfterNextFrame(callback: () => void): void {
    const view = this.stage()?.nativeElement.ownerDocument.defaultView;
    if (!view?.requestAnimationFrame) {
      callback();
      return;
    }

    this.pendingFlipFrame = view.requestAnimationFrame(() => {
      this.pendingFlipFrame = null;
      callback();
    });
  }

  private clearPendingFlipFrame(): void {
    if (this.pendingFlipFrame === null) {
      return;
    }

    this.stage()?.nativeElement.ownerDocument.defaultView?.cancelAnimationFrame(this.pendingFlipFrame);
    this.pendingFlipFrame = null;
  }

  private shouldSkipFlipAnimation(): boolean {
    return !this.device.isDesktopLayout() || this.device.hasCoarsePointer() || !this.device.hasHover();
  }
}
