import { Injectable } from '@angular/core';
import { publicAssetUrl } from '../assets/app-image-url';

const BACKGROUND_SESSION_KEY = 'commanderzone.backgroundImage';
const PREVIOUS_BACKGROUND_SESSION_KEY = 'commanderzone.previousBackgroundImage';
const BACKGROUND_IMAGES = Array.from(
  { length: 10 },
  (_, index) => publicAssetUrl(`assets/images/backgrounds/back_${index}.png`),
);

@Injectable({ providedIn: 'root' })
export class AppBackgroundService {
  private currentImageUrl = this.resolveSessionBackground();

  get imageUrl(): string {
    return this.currentImageUrl;
  }

  constructor() {
    this.applyBackground();
  }

  setDashboardMode(enabled: boolean): void {
    document.body.classList.toggle('dashboard-background', enabled);
  }

  useNewSessionBackground(): void {
    const previousImage = sessionStorage.getItem(PREVIOUS_BACKGROUND_SESSION_KEY);
    const nextImage = this.pickRandomBackground([this.currentImageUrl, previousImage]);
    sessionStorage.setItem(PREVIOUS_BACKGROUND_SESSION_KEY, this.currentImageUrl);
    this.currentImageUrl = nextImage;
    sessionStorage.setItem(BACKGROUND_SESSION_KEY, this.currentImageUrl);
    this.applyBackground();
  }

  private resolveSessionBackground(): string {
    const storedImage = sessionStorage.getItem(BACKGROUND_SESSION_KEY);
    if (storedImage) {
      const normalizedStoredImage = publicAssetUrl(storedImage);
      if (BACKGROUND_IMAGES.includes(normalizedStoredImage)) {
        sessionStorage.setItem(BACKGROUND_SESSION_KEY, normalizedStoredImage);
        return normalizedStoredImage;
      }
    }

    const image = this.pickRandomBackground();
    sessionStorage.setItem(BACKGROUND_SESSION_KEY, image);

    return image;
  }

  private applyBackground(): void {
    document.documentElement.style.setProperty('--app-session-background', `url("${this.currentImageUrl}")`);
  }

  private pickRandomBackground(excludedImages: readonly (string | null | undefined)[] = []): string {
    const excluded = new Set(excludedImages.filter((image): image is string => typeof image === 'string'));
    const candidates = BACKGROUND_IMAGES.filter((image) => !excluded.has(image));
    const images = candidates.length > 0 ? candidates : BACKGROUND_IMAGES;

    return images[this.randomIndex(images.length)];
  }

  private randomIndex(length: number): number {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);

    return values[0] % length;
  }
}
