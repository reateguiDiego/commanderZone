import { TestBed } from '@angular/core/testing';
import { GameTableNotificationSoundService } from './game-table-notification-sound.service';

class MockAudioParam {
  value = 0;
  readonly setValueAtTime = vi.fn();
  readonly exponentialRampToValueAtTime = vi.fn();
}

class MockOscillatorNode {
  readonly frequency = new MockAudioParam();
  type: OscillatorType = 'sine';
  readonly connect = vi.fn();
  readonly start = vi.fn();
  readonly stop = vi.fn();
}

class MockGainNode {
  readonly gain = new MockAudioParam();
  readonly connect = vi.fn();
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];
  static resumeImplementation: ((audioContext: MockAudioContext) => Promise<void>) | null = null;

  state: AudioContextState = 'suspended';
  currentTime = 10;
  readonly destination = {};
  readonly oscillators: MockOscillatorNode[] = [];
  readonly gains: MockGainNode[] = [];
  readonly close = vi.fn(async () => {
    this.state = 'closed';
  });
  readonly resume = vi.fn(() => MockAudioContext.resumeImplementation?.(this) ?? this.defaultResume());
  readonly createOscillator = vi.fn(() => {
    const oscillator = new MockOscillatorNode();
    this.oscillators.push(oscillator);

    return oscillator as unknown as OscillatorNode;
  });
  readonly createGain = vi.fn(() => {
    const gain = new MockGainNode();
    this.gains.push(gain);

    return gain as unknown as GainNode;
  });

  constructor() {
    MockAudioContext.instances.push(this);
  }

  private async defaultResume(): Promise<void> {
    this.state = 'running';
  }
}

describe('GameTableNotificationSoundService', () => {
  let service: GameTableNotificationSoundService;

  beforeEach(() => {
    MockAudioContext.instances = [];
    MockAudioContext.resumeImplementation = null;
    vi.stubGlobal('AudioContext', MockAudioContext);
    TestBed.configureTestingModule({
      providers: [GameTableNotificationSoundService],
    });
    service = TestBed.inject(GameTableNotificationSoundService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    vi.unstubAllGlobals();
  });

  it('waits for a suspended audio context before scheduling notification tones', async () => {
    let resumeAudio = (): void => {
      throw new Error('Expected the audio context resume promise to be pending.');
    };
    MockAudioContext.resumeImplementation = (audioContext) => new Promise<void>((resolve) => {
      resumeAudio = () => {
        audioContext.state = 'running';
        resolve();
      };
    });

    service.playGameLogMessage();
    const audioContext = MockAudioContext.instances[0]!;

    expect(audioContext.resume).toHaveBeenCalled();
    expect(audioContext.createOscillator).not.toHaveBeenCalled();

    resumeAudio();
    await vi.waitFor(() => expect(audioContext.createOscillator).toHaveBeenCalledTimes(2));
  });

  it('unlocks audio from the first user gesture and removes unlock listeners afterwards', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    service.startUserGestureUnlock();
    document.dispatchEvent(new Event('pointerdown'));

    await vi.waitFor(() => expect(MockAudioContext.instances[0]?.state).toBe('running'));
    expect(addEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), { capture: true, passive: true });
    expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), { capture: true });
  });
});
