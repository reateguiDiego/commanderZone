import { ChangeDetectionStrategy, Component, HostBinding, computed, input, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Card } from '../../../core/models/card.model';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { cardFaceImage, hasAlternateCardFace, readableCardFaceImage } from '../../utils/card-faces';

export type CardFaceImageVariant = 'result' | 'spoiler' | 'detail' | 'printing';

@Component({
  selector: 'app-card-face-image',
  imports: [LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './card-face-image.component.html',
  styleUrl: './card-face-image.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardFaceImageComponent {
  readonly card = input.required<Card>();
  readonly variant = input<CardFaceImageVariant>('result');
  readonly battle = input(false);
  readonly loading = input<'lazy' | 'eager'>('lazy');
  readonly fallback = input<string | null>(null);
  readonly preferLarge = input(false);

  readonly flipped = signal(false);
  readonly hasAlternateFace = computed(() => hasAlternateCardFace(this.card()));
  readonly imageUrl = computed(() => this.preferLarge()
    ? readableCardFaceImage(this.card(), this.flipped())
    : cardFaceImage(this.card(), this.flipped()));
  readonly displayName = computed(() => this.fallback()?.trim() || this.card().name);
  readonly altText = computed(() => {
    const suffix = this.flipped() ? 'back face' : 'front face';

    return `${this.card().name} - ${suffix}`;
  });

  @HostBinding('class.card-face-image--battle')
  get isBattle(): boolean {
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

  toggleFace(event: MouseEvent | PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.flipped.update((flipped) => !flipped);
  }

  stopPointer(event: PointerEvent): void {
    event.stopPropagation();
  }
}
