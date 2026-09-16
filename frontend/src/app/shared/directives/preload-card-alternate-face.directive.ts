import { Directive, HostListener, OnDestroy, inject, input } from '@angular/core';
import {
  CardFaceImageResolution,
  CardFaceImageSource,
  cardFaceImage,
  hasAlternateCardFace,
} from '../utils/card-faces';
import { ImagePreloadQueueService, type ImagePreloadRequest } from '../services/image-preload-queue.service';

/**
 * Downloads the other normal-resolution face only after the rendered card image has loaded.
 * This keeps the visible image on the critical path while making a later face toggle instant.
 */
@Directive({
  selector: 'img[appPreloadCardAlternateFace]',
})
export class PreloadCardAlternateFaceDirective implements OnDestroy {
  private readonly imagePreloadQueue = inject(ImagePreloadQueueService);
  private alternateFacePreload: ImagePreloadRequest | null = null;

  readonly card = input<CardFaceImageSource | null>(null, { alias: 'appPreloadCardAlternateFace' });
  readonly visibleFaceIndex = input(0, { alias: 'cardVisibleFaceIndex' });
  readonly imageResolution = input<CardFaceImageResolution>('normal', {
    alias: 'cardImageResolution',
  });

  @HostListener('load')
  preloadAlternateFace(): void {
    const card = this.card();
    if (this.imageResolution() !== 'normal' || !hasAlternateCardFace(card)) {
      return;
    }

    const alternateFaceImage = cardFaceImage(card, this.visibleFaceIndex() === 0, 'normal');
    if (!alternateFaceImage) {
      return;
    }

    this.alternateFacePreload?.cancel();
    const preload = this.imagePreloadQueue.request(alternateFaceImage, 'background');
    this.alternateFacePreload = preload;
    void preload.completed.finally(() => {
      if (this.alternateFacePreload === preload) {
        this.alternateFacePreload = null;
      }
    });
  }

  ngOnDestroy(): void {
    this.alternateFacePreload?.cancel();
    this.alternateFacePreload = null;
  }
}
