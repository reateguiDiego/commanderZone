import { Injectable, OnDestroy, signal } from '@angular/core';
import { TableAssistantTimerState } from '../models/table-assistant.models';

@Injectable()
export class TableAssistantTimerService implements OnDestroy {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private timer: TableAssistantTimerState | null = null;

  readonly remainingSeconds = signal<number | null>(null);

  sync(timer: TableAssistantTimerState): void {
    this.timer = timer;
    this.clear();

    if (timer.mode === 'none') {
      this.remainingSeconds.set(null);
      return;
    }

    this.remainingSeconds.set(this.computeRemaining(timer));

    if (timer.status === 'running') {
      this.intervalId = setInterval(() => {
        this.remainingSeconds.set(this.timer ? this.computeRemaining(this.timer) : null);
      }, 1000);
    }
  }

  ngOnDestroy(): void {
    this.clear();
  }

  private computeRemaining(timer: TableAssistantTimerState): number | null {
    const remaining = timer.remainingSeconds ?? timer.durationSeconds;
    if (remaining === null) {
      return null;
    }

    if (timer.status !== 'running' || timer.startedAt === null) {
      return remaining;
    }

    const elapsed = Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000);

    return Math.max(0, remaining - elapsed);
  }

  private clear(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
