import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { TableAssistantTimerState } from '../models/table-assistant.models';

@Injectable()
export class TableAssistantTimerService implements OnDestroy {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private timer: TableAssistantTimerState | null = null;
  private audioContext: AudioContext | null = null;
  private lastAlertSecond: number | null = null;

  readonly remainingSeconds = signal<number | null>(null);
  readonly alertLevel = computed<'none' | 'warning' | 'critical'>(() => {
    const remainingSeconds = this.remainingSeconds();
    if (remainingSeconds === null || remainingSeconds > 10 || remainingSeconds <= 0) {
      return 'none';
    }

    return remainingSeconds <= 3 ? 'critical' : 'warning';
  });

  sync(timer: TableAssistantTimerState): void {
    this.timer = timer;
    this.clear();

    if (timer.mode === 'none') {
      this.remainingSeconds.set(null);
      this.lastAlertSecond = null;
      return;
    }

    this.setRemaining(this.computeRemaining(timer));

    if (timer.status === 'running') {
      this.intervalId = setInterval(() => {
        this.setRemaining(this.timer ? this.computeRemaining(this.timer) : null);
      }, 1000);
    } else {
      this.lastAlertSecond = null;
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

  private setRemaining(seconds: number | null): void {
    this.remainingSeconds.set(seconds);
    this.playAlertIfNeeded(seconds);
  }

  private playAlertIfNeeded(seconds: number | null): void {
    if (this.timer?.status !== 'running' || seconds === null || seconds > 10 || seconds === this.lastAlertSecond) {
      return;
    }

    this.lastAlertSecond = seconds;
    if (seconds === 0) {
      this.playTurnEndSound();
      return;
    }

    this.playBeep(seconds <= 3 ? 920 : 640, seconds <= 3 ? 0.15 : 0.09);
  }

  private playTurnEndSound(): void {
    this.playBeep(392, 0.18, 0);
    this.playBeep(523, 0.22, 0.12);
    this.playBeep(659, 0.28, 0.24);
  }

  private playBeep(frequency: number, durationSeconds: number, delaySeconds = 0): void {
    const AudioContextConstructor = globalThis.AudioContext;
    if (!AudioContextConstructor) {
      return;
    }

    this.audioContext ??= new AudioContextConstructor();
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }

    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const now = this.audioContext.currentTime + delaySeconds;

    oscillator.frequency.value = frequency;
    oscillator.type = delaySeconds > 0 ? 'triangle' : 'sine';
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds);
  }
}
