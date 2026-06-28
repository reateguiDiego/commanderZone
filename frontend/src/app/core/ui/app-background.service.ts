import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, effect, inject } from '@angular/core';
import { publicAssetUrl } from '../assets/app-image-url';
import { AppThemeId } from '../theme/app-theme';
import { AppThemeService } from '../theme/app-theme.service';

const BACKGROUND_SESSION_KEY = 'commanderzone.backgroundImage';
const BACKGROUND_THEME_SESSION_KEY = 'commanderzone.backgroundTheme';
const PREVIOUS_BACKGROUND_SESSION_KEY = 'commanderzone.previousBackgroundImage';
const BACKGROUND_IMAGE_COUNT = 10;

@Injectable({ providedIn: 'root' })
export class AppBackgroundService {
  private readonly document = inject(DOCUMENT);
  private readonly appTheme = inject(AppThemeService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private currentThemeId = this.appTheme.themeId();
  private currentImageUrl = this.resolveSessionBackground(this.currentThemeId);

  get imageUrl(): string {
    return this.currentImageUrl;
  }

  constructor() {
    this.applyBackground();

    effect(() => {
      this.syncThemeBackground(this.appTheme.themeId());
    });
  }

  setDashboardMode(enabled: boolean): void {
    if (!this.isBrowser) {
      return;
    }

    this.document.body.classList.toggle('dashboard-background', enabled);
    if (enabled) {
      this.applyBackground();
    }
  }

  useNewSessionBackground(): void {
    const storage = this.sessionStorage();
    if (!storage) {
      return;
    }

    const previousImage = storage.getItem(PREVIOUS_BACKGROUND_SESSION_KEY);
    const nextImage = this.pickRandomBackground(this.currentThemeId, [this.currentImageUrl, previousImage]);
    storage.setItem(PREVIOUS_BACKGROUND_SESSION_KEY, this.currentImageUrl);
    this.currentImageUrl = nextImage;
    storage.setItem(BACKGROUND_SESSION_KEY, this.currentImageUrl);
    storage.setItem(BACKGROUND_THEME_SESSION_KEY, this.currentThemeId);
    this.applyBackground();
  }

  private resolveSessionBackground(themeId: AppThemeId): string {
    const themeImages = backgroundImagesForTheme(themeId);
    const storage = this.sessionStorage();
    if (!storage) {
      return themeImages[0];
    }

    const storedImage = storage.getItem(BACKGROUND_SESSION_KEY);
    const storedThemeId = storage.getItem(BACKGROUND_THEME_SESSION_KEY);
    if (storedThemeId === themeId && storedImage) {
      const normalizedStoredImage = publicAssetUrl(storedImage);
      if (themeImages.includes(normalizedStoredImage)) {
        storage.setItem(BACKGROUND_SESSION_KEY, normalizedStoredImage);
        return normalizedStoredImage;
      }
    }

    const image = this.pickRandomBackground(themeId);
    storage.setItem(BACKGROUND_SESSION_KEY, image);
    storage.setItem(BACKGROUND_THEME_SESSION_KEY, themeId);

    return image;
  }

  private syncThemeBackground(themeId: AppThemeId): void {
    if (themeId === this.currentThemeId && backgroundImagesForTheme(themeId).includes(this.currentImageUrl)) {
      this.applyBackground();
      return;
    }

    const storage = this.sessionStorage();
    const previousImage = this.currentImageUrl;
    this.currentThemeId = themeId;
    this.currentImageUrl = this.pickRandomBackground(themeId, [previousImage]);

    if (storage) {
      storage.setItem(PREVIOUS_BACKGROUND_SESSION_KEY, previousImage);
      storage.setItem(BACKGROUND_SESSION_KEY, this.currentImageUrl);
      storage.setItem(BACKGROUND_THEME_SESSION_KEY, themeId);
    }

    this.applyBackground();
  }

  private applyBackground(): void {
    if (!this.isBrowser) {
      return;
    }

    this.document.documentElement.style.setProperty('--app-session-background', `url("${this.currentImageUrl}")`);
  }

  private pickRandomBackground(themeId: AppThemeId, excludedImages: readonly (string | null | undefined)[] = []): string {
    const themeImages = backgroundImagesForTheme(themeId);
    const excluded = new Set(excludedImages.filter((image): image is string => typeof image === 'string'));
    const candidates = themeImages.filter((image) => !excluded.has(image));
    const images = candidates.length > 0 ? candidates : themeImages;

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

function backgroundImagesForTheme(themeId: AppThemeId): readonly string[] {
  return Array.from(
    { length: BACKGROUND_IMAGE_COUNT },
    (_, index) => publicAssetUrl(`assets/images/backgrounds/${themeId}/bg-${index + 1}.webp`),
  );
}
