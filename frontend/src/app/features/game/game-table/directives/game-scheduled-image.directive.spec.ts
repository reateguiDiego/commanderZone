import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ImagePreloadQueueService,
  type ImagePreloadRequest,
  type ScheduledImageRequest,
} from '../../../../shared/services/image-preload-queue.service';
import { GameScheduledImageDirective } from './game-scheduled-image.directive';

@Component({
  imports: [GameScheduledImageDirective],
  template: `<img [appGameScheduledImage]="imageUrl" alt="Test card" />`,
})
class HostComponent {
  imageUrl: string | null = 'https://cards.example.test/test-card.jpg';
}

describe('GameScheduledImageDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let image: HTMLImageElement;
  let scheduledRequest: ScheduledImageRequest | null;

  beforeEach(async () => {
    scheduledRequest = null;
    const imagePreloadQueue = {
      schedule: vi.fn((request: ScheduledImageRequest): ImagePreloadRequest => {
        scheduledRequest = request;
        request.start(vi.fn());
        return { completed: Promise.resolve(true), cancel: vi.fn() };
      }),
    };

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: ImagePreloadQueueService, useValue: imagePreloadQueue }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    image = fixture.nativeElement.querySelector('img');
  });

  it('shows the loading card treatment until the image load event', () => {
    expect(scheduledRequest).not.toBeNull();
    expect(image.classList.contains('cz-game-card-image--loading')).toBe(true);
    expect(image.getAttribute('aria-busy')).toBe('true');

    image.dispatchEvent(new Event('load'));

    expect(image.classList.contains('cz-game-card-image--loading')).toBe(false);
    expect(image.classList.contains('cz-game-card-image--failed')).toBe(false);
    expect(image.hasAttribute('aria-busy')).toBe(false);
  });

  it('keeps a styled fallback when the image cannot be loaded', () => {
    image.dispatchEvent(new Event('error'));

    expect(image.classList.contains('cz-game-card-image--loading')).toBe(false);
    expect(image.classList.contains('cz-game-card-image--failed')).toBe(true);
    expect(image.hasAttribute('aria-busy')).toBe(false);
  });
});
