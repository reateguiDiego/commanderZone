import { Injectable, OnDestroy } from '@angular/core';

interface NotificationTone {
  readonly frequency: number;
  readonly durationSeconds: number;
  readonly delaySeconds: number;
  readonly type: OscillatorType;
  readonly volume: number;
}

@Injectable()
export class GameTableNotificationSoundService implements OnDestroy {
  private audioContext: AudioContext | null = null;
  private unlockListenersActive = false;
  private readonly unlockAudio = (): void => {
    void this.ensureRunningAudioContext();
  };

  startUserGestureUnlock(): void {
    if (this.unlockListenersActive || typeof document === 'undefined') {
      return;
    }

    this.unlockListenersActive = true;
    document.addEventListener('pointerdown', this.unlockAudio, { capture: true, passive: true });
    document.addEventListener('keydown', this.unlockAudio, { capture: true });
    document.addEventListener('touchstart', this.unlockAudio, { capture: true, passive: true });
  }

  ngOnDestroy(): void {
    this.removeUnlockListeners();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
  }

  playChatMessage(): void {
    this.playTones([
      { frequency: 740, durationSeconds: 0.055, delaySeconds: 0, type: 'sine', volume: 0.28 },
      { frequency: 980, durationSeconds: 0.075, delaySeconds: 0.065, type: 'sine', volume: 0.24 },
    ]);
  }

  playGameLogMessage(): void {
    this.playTones([
      { frequency: 520, durationSeconds: 0.065, delaySeconds: 0, type: 'triangle', volume: 0.256 },
      { frequency: 392, durationSeconds: 0.09, delaySeconds: 0.075, type: 'triangle', volume: 0.208 },
    ]);
  }

  private playTones(tones: readonly NotificationTone[]): void {
    void this.playTonesWhenAudioIsReady(tones);
  }

  private async playTonesWhenAudioIsReady(tones: readonly NotificationTone[]): Promise<void> {
    const audioContext = await this.ensureRunningAudioContext();
    if (!audioContext) {
      return;
    }

    for (const tone of tones) {
      this.playTone(audioContext, tone);
    }
  }

  private async ensureRunningAudioContext(): Promise<AudioContext | null> {
    const AudioContextConstructor = globalThis.AudioContext;
    if (!AudioContextConstructor) {
      return null;
    }

    try {
      this.audioContext ??= new AudioContextConstructor();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (this.audioContext.state !== 'running') {
        return null;
      }

      this.removeUnlockListeners();
      return this.audioContext;
    } catch {
      return null;
    }
  }

  private removeUnlockListeners(): void {
    if (!this.unlockListenersActive || typeof document === 'undefined') {
      return;
    }

    this.unlockListenersActive = false;
    document.removeEventListener('pointerdown', this.unlockAudio, { capture: true });
    document.removeEventListener('keydown', this.unlockAudio, { capture: true });
    document.removeEventListener('touchstart', this.unlockAudio, { capture: true });
  }

  private playTone(audioContext: AudioContext, tone: NotificationTone): void {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime + tone.delaySeconds;

    oscillator.frequency.value = tone.frequency;
    oscillator.type = tone.type;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(tone.volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.durationSeconds);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + tone.durationSeconds);
  }
}
