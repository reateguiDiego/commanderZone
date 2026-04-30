import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FullscreenService {
  isFullscreen(): boolean {
    return this.document()?.fullscreenElement !== null;
  }

  async toggleFullscreen(target: HTMLElement | null = this.document()?.documentElement ?? null): Promise<boolean> {
    const document = this.document();
    if (!document || !target) {
      return false;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }

    await target.requestFullscreen();
    return true;
  }

  private document(): Document | null {
    return globalThis.document ?? null;
  }
}
