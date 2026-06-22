import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

const MANA_STYLESHEET_ID = 'cz-mana-stylesheet';
const MANA_STYLESHEET_HREF = '/vendor/mana/css/mana.min.css';

@Injectable({ providedIn: 'root' })
export class ManaStylesService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private loaded = false;

  load(): void {
    if (this.loaded || !isPlatformBrowser(this.platformId)) {
      return;
    }

    if (this.document.getElementById(MANA_STYLESHEET_ID)) {
      this.loaded = true;
      return;
    }

    const link = this.document.createElement('link');
    link.id = MANA_STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = MANA_STYLESHEET_HREF;
    this.document.head.appendChild(link);
    this.loaded = true;
  }
}
