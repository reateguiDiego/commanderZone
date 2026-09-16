import {
  Directive,
  ElementRef,
  HostListener,
  OnChanges,
  OnDestroy,
  Renderer2,
  inject,
  input,
} from '@angular/core';
import {
  ImagePreloadQueueService,
  type ImagePreloadQueuePriority,
  type ImagePreloadRequest,
} from '../../../../shared/services/image-preload-queue.service';
import { imageRequestUrl } from '../../../../shared/utils/image-request-url';

/** Schedules a visible game image before assigning its native src attribute. */
@Directive({
  selector: 'img[appGameScheduledImage]',
})
export class GameScheduledImageDirective implements OnChanges, OnDestroy {
  private readonly imageElement = inject<ElementRef<HTMLImageElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);
  private readonly scheduler = inject(ImagePreloadQueueService);
  private request: ImagePreloadRequest | null = null;
  private complete: ((loaded: boolean) => void) | null = null;

  readonly imageUrl = input<string | null>(null, { alias: 'appGameScheduledImage' });
  readonly priority = input<ImagePreloadQueuePriority>('visible', { alias: 'gameImagePriority' });

  ngOnChanges(): void {
    this.scheduleImage();
  }

  ngOnDestroy(): void {
    this.clearScheduledImage();
  }

  @HostListener('load')
  imageLoaded(): void {
    this.setImageState('loaded');
    this.complete?.(true);
    this.complete = null;
  }

  @HostListener('error')
  imageFailed(): void {
    this.setImageState('failed');
    this.complete?.(false);
    this.complete = null;
  }

  private scheduleImage(): void {
    this.clearScheduledImage();
    const sourceImageUrl = this.imageUrl()?.trim();
    if (!sourceImageUrl) {
      return;
    }

    this.setImageState('loading');
    const imageUrl = imageRequestUrl(sourceImageUrl);

    const request = this.scheduler.schedule({
      key: imageUrl,
      priority: this.priority(),
      start: (complete) => {
        this.complete = complete;
        this.renderer.setProperty(this.imageElement, 'loading', 'eager');
        this.renderer.setProperty(
          this.imageElement,
          'fetchPriority',
          this.priority() === 'critical' || this.priority() === 'interaction' ? 'high' : 'auto',
        );
        this.renderer.setAttribute(this.imageElement, 'src', imageUrl);
        return () => {
          if (this.complete === complete) {
            this.complete = null;
          }
          this.renderer.removeAttribute(this.imageElement, 'src');
        };
      },
    });
    this.request = request;
    void request.completed.finally(() => {
      if (this.request === request) {
        this.request = null;
      }
    });
  }

  private clearScheduledImage(): void {
    this.request?.cancel();
    this.request = null;
    this.complete = null;
    this.renderer.removeAttribute(this.imageElement, 'src');
    this.setImageState(null);
  }

  private setImageState(state: 'loading' | 'loaded' | 'failed' | null): void {
    this.renderer.removeClass(this.imageElement, 'cz-game-card-image--loading');
    this.renderer.removeClass(this.imageElement, 'cz-game-card-image--failed');

    if (state === 'loading') {
      this.renderer.addClass(this.imageElement, 'cz-game-card-image--loading');
      this.renderer.setAttribute(this.imageElement, 'aria-busy', 'true');
      return;
    }

    this.renderer.removeAttribute(this.imageElement, 'aria-busy');
    if (state === 'failed') {
      this.renderer.addClass(this.imageElement, 'cz-game-card-image--failed');
    }
  }
}
