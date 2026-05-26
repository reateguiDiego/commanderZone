import { TestBed } from '@angular/core/testing';
import { GameDebugSnapshotMetricsService } from './game-debug-snapshot-metrics.service';

describe('GameDebugSnapshotMetricsService', () => {
  let service: GameDebugSnapshotMetricsService;
  let channels: FakeBroadcastChannel[];
  const originalBroadcastChannel = globalThis.BroadcastChannel;

  beforeEach(() => {
    channels = [];
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: class extends FakeBroadcastChannel {
        constructor(name: string) {
          super(name, channels);
        }
      },
    });

    TestBed.configureTestingModule({
      providers: [GameDebugSnapshotMetricsService],
    });
    service = TestBed.inject(GameDebugSnapshotMetricsService);
  });

  afterEach(() => {
    service.stop();
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: originalBroadcastChannel,
    });
  });

  it('stores queue metrics and dead-letter events for the observed game', () => {
    service.observe('game-1');
    const channel = channels[0];

    channel.emit({
      kind: 'queue_metrics',
      gameId: 'game-1',
      queueDepth: 3,
      inFlight: true,
      enqueueTotal: 10,
      drainTotal: 7,
      dropTotal: 2,
      retryTotal: 1,
      resyncTotal: 4,
      lateAckIgnoredTotal: 0,
      rejectedTotal: 3,
      circuitBlockedTotal: 1,
      queueFullTotal: 1,
      enqueueRate: 0.25,
      drainRate: 0.2,
      measuredAt: '2026-05-24T18:00:00.000Z',
    });
    channel.emit({
      kind: 'dead_letter_event',
      gameId: 'game-1',
      commandType: 'card.position.changed',
      reason: 'queue_dropped',
      retryCount: 0,
      createdAt: '2026-05-24T18:00:01.000Z',
      details: 'Dropped',
    });

    expect(service.queueMetrics()).toMatchObject({
      queueDepth: 3,
      inFlight: true,
      enqueueTotal: 10,
      drainTotal: 7,
      dropTotal: 2,
      rejectedTotal: 3,
    });
    expect(service.deadLetterEvents()).toEqual([
      expect.objectContaining({
        commandType: 'card.position.changed',
        reason: 'queue_dropped',
      }),
    ]);
  });

  it('resets local debug queue state when observation restarts', () => {
    service.observe('game-1');
    const firstChannel = channels[0];
    firstChannel.emit({
      kind: 'queue_metrics',
      gameId: 'game-1',
      queueDepth: 1,
      inFlight: false,
      enqueueTotal: 1,
      drainTotal: 1,
      dropTotal: 0,
      retryTotal: 0,
      resyncTotal: 0,
      lateAckIgnoredTotal: 0,
      enqueueRate: 0.02,
      drainRate: 0.02,
      measuredAt: '2026-05-24T18:00:00.000Z',
    });
    firstChannel.emit({
      kind: 'dead_letter_event',
      gameId: 'game-1',
      commandType: 'life.changed',
      reason: 'timeout',
      retryCount: 0,
      createdAt: '2026-05-24T18:00:01.000Z',
      details: null,
    });

    service.observe('game-2');
    expect(service.queueMetrics()).toBeNull();
    expect(service.deadLetterEvents()).toEqual([]);
  });

  it('keeps only the most recent 100 dead-letter events', () => {
    service.observe('game-1');
    const channel = channels[0];

    for (let index = 0; index < 130; index += 1) {
      channel.emit({
        kind: 'dead_letter_event',
        gameId: 'game-1',
        commandType: 'counter.changed',
        reason: 'queue_dropped',
        retryCount: 0,
        createdAt: `2026-05-24T18:00:${String(index % 60).padStart(2, '0')}.000Z`,
        details: `event-${index}`,
      });
    }

    expect(service.deadLetterEvents().length).toBe(100);
    expect(service.deadLetterEvents().at(0)?.details).toBe('event-30');
    expect(service.deadLetterEvents().at(-1)?.details).toBe('event-129');
  });
});

class FakeBroadcastChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly sentMessages: unknown[] = [];
  closed = false;

  constructor(readonly name: string, private readonly registry: FakeBroadcastChannel[]) {
    this.registry.push(this);
  }

  postMessage(message: unknown): void {
    this.sentMessages.push(message);
  }

  close(): void {
    this.closed = true;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}
