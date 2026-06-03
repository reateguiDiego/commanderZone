import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { publicAssetUrl } from '../assets/app-image-url';

const BACKGROUND_SESSION_KEY = 'commanderzone.backgroundImage';
const PREVIOUS_BACKGROUND_SESSION_KEY = 'commanderzone.previousBackgroundImage';
const BACKGROUND_IMAGES = Array.from(
  { length: 10 },
  (_, index) => publicAssetUrl(`assets/images/backgrounds/back_${index}.png`),
);

@Injectable({ providedIn: 'root' })
export class AppBackgroundService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private currentImageUrl = this.resolveSessionBackground();

  get imageUrl(): string {
    return this.currentImageUrl;
  }

  constructor() {
    this.applyBackground();
  }

  setDashboardMode(enabled: boolean): void {
    if (!this.isBrowser) {
      return;
    }

    this.document.body.classList.toggle('dashboard-background', enabled);
  }

  useNewSessionBackground(): void {
    const storage = this.sessionStorage();
    if (!storage) {
      return;
    }

    const previousImage = storage.getItem(PREVIOUS_BACKGROUND_SESSION_KEY);
    const nextImage = this.pickRandomBackground([this.currentImageUrl, previousImage]);
    storage.setItem(PREVIOUS_BACKGROUND_SESSION_KEY, this.currentImageUrl);
    this.currentImageUrl = nextImage;
    storage.setItem(BACKGROUND_SESSION_KEY, this.currentImageUrl);
    this.applyBackground();
  }

  private resolveSessionBackground(): string {
    const storage = this.sessionStorage();
    if (!storage) {
      return BACKGROUND_IMAGES[0];
    }

    const storedImage = storage.getItem(BACKGROUND_SESSION_KEY);
    if (storedImage) {
      const normalizedStoredImage = publicAssetUrl(storedImage);
      if (BACKGROUND_IMAGES.includes(normalizedStoredImage)) {
        storage.setItem(BACKGROUND_SESSION_KEY, normalizedStoredImage);
        return normalizedStoredImage;
      }
    }

    const image = this.pickRandomBackground();
    storage.setItem(BACKGROUND_SESSION_KEY, image);

    return image;
  }

  private applyBackground(): void {
    if (!this.isBrowser) {
      return;
    }

    this.document.documentElement.style.setProperty('--app-session-background', `url("${this.currentImageUrl}")`);
  }

  private pickRandomBackground(excludedImages: readonly (string | null | undefined)[] = []): string {
    const excluded = new Set(excludedImages.filter((image): image is string => typeof image === 'string'));
    const candidates = BACKGROUND_IMAGES.filter((image) => !excluded.has(image));
    const images = candidates.length > 0 ? candidates : BACKGROUND_IMAGES;

    return images[this.randomIndex(images.length)];
  }

  private randomIndex(length: number): number {
    if (!this.isBrowser) {
      return 0;
    }

    const values = new Uint32Array(1);
    crypto.getRandomValues(values);

    return values[0] % length;
  }

  private sessionStorage(): Storage | null {
    if (!this.isBrowser) {
      return null;
    }

    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  }
}
