import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';

interface ScrollLockSnapshot {
  readonly htmlOverflow: string;
  readonly bodyOverflow: string;
  readonly bodyPosition: string;
  readonly bodyTop: string;
  readonly bodyLeft: string;
  readonly bodyRight: string;
  readonly bodyWidth: string;
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
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      scrollY,
    };

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
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
    body.style.position = this.snapshot.bodyPosition;
    body.style.top = this.snapshot.bodyTop;
    body.style.left = this.snapshot.bodyLeft;
    body.style.right = this.snapshot.bodyRight;
    body.style.width = this.snapshot.bodyWidth;
    if (scrollY > 0) {
      this.documentRef.defaultView?.scrollTo(0, scrollY);
    }
    this.snapshot = null;
  }
}
