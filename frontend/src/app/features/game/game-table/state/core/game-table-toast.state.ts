import { Injectable } from '@angular/core';
import { GameTableCoreState } from './game-table-core.state';

@Injectable()
export class GameTableToastState {
  private readonly toastDurationMs = 3000;
  private errorToastTimer: number | null = null;
  private targetToastTimer: number | null = null;

  constructor(private readonly core: GameTableCoreState) {}

  scheduleErrorDismiss(message: string | null, canDismiss: boolean): void {
    this.clearErrorDismissTimer();
    if (!message || !canDismiss) {
      return;
    }

    this.errorToastTimer = window.setTimeout(() => {
      if (this.core.error() === message) {
        this.core.error.set(null);
      }
      this.errorToastTimer = null;
    }, this.toastDurationMs);
  }

  showArrowTargetProgressToast(remainingTargets: number): void {
    const normalizedRemaining = Math.max(1, Math.floor(remainingTargets));
    this.showTargetToast(normalizedRemaining === 1
      ? 'Falta 1 objetivo.'
      : `Faltan ${normalizedRemaining} objetivos.`);
  }

  showTargetToast(message: string): void {
    this.clearTargetToastTimer();
    this.core.targetToast.set(message);
    this.targetToastTimer = window.setTimeout(() => {
      if (this.core.targetToast() === message) {
        this.core.targetToast.set(null);
      }
      this.targetToastTimer = null;
    }, this.toastDurationMs);
  }

  clearTargetToast(): void {
    this.clearTargetToastTimer();
    this.core.targetToast.set(null);
  }

  destroy(): void {
    this.clearErrorDismissTimer();
    this.clearTargetToastTimer();
  }

  private clearErrorDismissTimer(): void {
    if (this.errorToastTimer === null) {
      return;
    }

    window.clearTimeout(this.errorToastTimer);
    this.errorToastTimer = null;
  }

  private clearTargetToastTimer(): void {
    if (this.targetToastTimer === null) {
      return;
    }

    window.clearTimeout(this.targetToastTimer);
    this.targetToastTimer = null;
  }
}
