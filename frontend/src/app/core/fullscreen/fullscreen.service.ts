import { Injectable } from '@angular/core';

const PSEUDO_FULLSCREEN_CLASS = 'app-pseudo-fullscreen';

type FullscreenCapableElement = HTMLElement & {
  requestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

@Injectable({ providedIn: 'root' })
export class FullscreenService {
  private pseudoScrollY = 0;

  isFullscreen(): boolean {
    const document = this.document();
    if (!document) {
      return false;
    }

    return this.isNativeFullscreen(document) || document.body.classList.contains(PSEUDO_FULLSCREEN_CLASS);
  }

  async toggleFullscreen(target: HTMLElement | null = this.document()?.documentElement ?? null): Promise<boolean> {
    const document = this.document();
    if (!document || !target) {
      return false;
    }

    if (this.isFullscreen()) {
      await this.exitNativeFullscreen(document);
      this.disablePseudoFullscreen(document);
      return false;
    }

    const fullscreenEnabled = await this.requestNativeFullscreen(target);
    if (fullscreenEnabled) {
      this.disablePseudoFullscreen(document);
      return true;
    }

    this.enablePseudoFullscreen(document);
    return true;
  }

  private document(): Document | null {
    return globalThis.document ?? null;
  }

  private window(): Window | null {
    return globalThis.window ?? null;
  }

  private isNativeFullscreen(document: Document): boolean {
    const fullscreenDocument = document as FullscreenCapableDocument;
    return Boolean(
      document.fullscreenElement
      || fullscreenDocument.webkitFullscreenElement
      || fullscreenDocument.msFullscreenElement,
    );
  }

  private async requestNativeFullscreen(target: HTMLElement): Promise<boolean> {
    const fullscreenTarget = target as FullscreenCapableElement;
    const methods = [
      fullscreenTarget.requestFullscreen,
      fullscreenTarget.webkitRequestFullscreen,
      fullscreenTarget.msRequestFullscreen,
    ];

    for (const method of methods) {
      if (!method) {
        continue;
      }

      try {
        await Promise.resolve(method.call(target));
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private async exitNativeFullscreen(document: Document): Promise<void> {
    const fullscreenDocument = document as FullscreenCapableDocument;
    const methods = [
      document.exitFullscreen,
      fullscreenDocument.webkitExitFullscreen,
      fullscreenDocument.msExitFullscreen,
    ];

    for (const method of methods) {
      if (!method) {
        continue;
      }

      try {
        await Promise.resolve(method.call(document));
        return;
      } catch {
        continue;
      }
    }
  }

  private enablePseudoFullscreen(document: Document): void {
    const window = this.window();
    this.pseudoScrollY = window?.scrollY ?? 0;

    document.documentElement.classList.add(PSEUDO_FULLSCREEN_CLASS);
    document.body.classList.add(PSEUDO_FULLSCREEN_CLASS);
    document.body.style.top = `-${this.pseudoScrollY}px`;
  }

  private disablePseudoFullscreen(document: Document): void {
    const window = this.window();
    const wasPseudoFullscreen = document.body.classList.contains(PSEUDO_FULLSCREEN_CLASS);

    document.documentElement.classList.remove(PSEUDO_FULLSCREEN_CLASS);
    document.body.classList.remove(PSEUDO_FULLSCREEN_CLASS);
    document.body.style.top = '';

    if (wasPseudoFullscreen && window) {
      window.scrollTo(0, this.pseudoScrollY);
    }
  }
}
