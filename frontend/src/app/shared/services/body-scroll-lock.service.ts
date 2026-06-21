import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';

interface ScrollLockSnapshot {
  readonly htmlOverflow: string;
  readonly bodyOverflow: string;
  readonly bodyPaddingRight: string;
  readonly scrollY: number;
}

@Injectable({ providedIn: 'root' })
export class BodyScrollLockService {
  private lockCount = 0;
  private snapshot: ScrollLockSnapshot | null = null;

  constructor(@Inject(DOCUMENT) private readonly documentRef: Document) {}

  lock(): void {
    if (this.lockCount === 0) {
      this.applyLock();
    }

    this.lockCount += 1;
  }

  unlock(): void {
    if (this.lockCount === 0) {
      return;
    }

    this.lockCount -= 1;
    if (this.lockCount === 0) {
      this.restoreLock();
    }
  }

  private applyLock(): void {
    const body = this.documentRef.body;
    const html = this.documentRef.documentElement;
    const scrollY = this.documentRef.defaultView?.scrollY ?? 0;

    this.snapshot = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
      scrollY,
    };

    const scrollbarWidth = Math.max(0, (this.documentRef.defaultView?.innerWidth ?? html.clientWidth) - html.clientWidth);
    const bodyPaddingRight = Number.parseFloat(this.documentRef.defaultView?.getComputedStyle(body).paddingRight ?? '0') || 0;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`;
    }
  }

  private restoreLock(): void {
    if (!this.snapshot) {
      return;
    }

    const body = this.documentRef.body;
    const html = this.documentRef.documentElement;
    const scrollY = this.snapshot.scrollY;

    html.style.overflow = this.snapshot.htmlOverflow;
    body.style.overflow = this.snapshot.bodyOverflow;
    body.style.paddingRight = this.snapshot.bodyPaddingRight;
    if (scrollY > 0) {
      this.documentRef.defaultView?.scrollTo(0, scrollY);
    }
    this.snapshot = null;
  }
}
