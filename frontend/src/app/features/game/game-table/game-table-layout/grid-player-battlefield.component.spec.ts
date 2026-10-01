import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GameCardInstance } from '../../../../core/models/game.model';
import type { PlayerView } from '../game-table.store';
import { GridPlayerBattlefieldComponent } from './grid-player-battlefield.component';
import type {
  GridPlayerSummaryBindings,
  GridSeat,
  PlayerRegionTemplates,
} from './game-table-grid-seat.model';

describe('GridPlayerBattlefieldComponent summary collision deferral', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the existing collision measurement path during a pointer drag when the experiment is off', async () => {
    const frameQueue = installAnimationFrameQueue();
    const { fixture, summaryRect, cardRect } = await renderBattlefield({ activePointerDrag: true });

    frameQueue.flushAll();

    expect(summaryRect).toHaveBeenCalledTimes(1);
    expect(cardRect).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.summaryCompact()).toBe(true);
  });

  it('defers pending and repeated collision checks until an active pointer drag ends when the experiment is on', async () => {
    const frameQueue = installAnimationFrameQueue();
    const { fixture, summaryRect, cardRect } = await renderBattlefield({
      deferSummaryCollisionDuringPointerDrag: true,
    });
    const handPreviewQuery = vi.spyOn(document, 'querySelectorAll');

    fixture.componentRef.setInput('hasActiveBattlefieldPointerDrag', true);
    fixture.detectChanges();
    fixture.componentInstance.syncSummaryWithHandDragPreview();
    frameQueue.flushAll();

    expect(frameQueue.cancel).toHaveBeenCalled();
    expect(handPreviewQuery).not.toHaveBeenCalled();
    expect(summaryRect).not.toHaveBeenCalled();
    expect(cardRect).not.toHaveBeenCalled();

    fixture.componentRef.setInput('hasActiveBattlefieldPointerDrag', false);
    fixture.detectChanges();
    frameQueue.flushAll();

    expect(summaryRect).toHaveBeenCalledTimes(1);
    expect(cardRect).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.summaryCompact()).toBe(true);
  });

  it('continues to measure collisions outside a pointer drag when the experiment is on', async () => {
    const frameQueue = installAnimationFrameQueue();
    const { fixture, summaryRect, cardRect } = await renderBattlefield({
      deferSummaryCollisionDuringPointerDrag: true,
    });

    frameQueue.flushAll();

    expect(summaryRect).toHaveBeenCalledTimes(1);
    expect(cardRect).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.summaryCompact()).toBe(true);
  });
});

async function renderBattlefield(
  options: {
    activePointerDrag?: boolean;
    deferSummaryCollisionDuringPointerDrag?: boolean;
  } = {},
): Promise<{
  fixture: ComponentFixture<GridPlayerBattlefieldComponent>;
  summaryRect: ReturnType<typeof vi.fn>;
  cardRect: ReturnType<typeof vi.fn>;
}> {
  TestBed.overrideComponent(GridPlayerBattlefieldComponent, {
    set: {
      template: `
        <section class="player-cell">
          <div class="player-cell-summary"></div>
          <div class="player-cell-battlefield">
            <div data-testid="battlefield-zone">
              <div data-testid="game-card"></div>
            </div>
          </div>
        </section>
      `,
    },
  });
  await TestBed.configureTestingModule({
    imports: [GridPlayerBattlefieldComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(GridPlayerBattlefieldComponent);
  const playerSeat = seat();
  fixture.componentRef.setInput('playerSeat', playerSeat);
  fixture.componentRef.setInput('summaryPlayer', playerSeat.player);
  fixture.componentRef.setInput('playerCount', 1);
  fixture.componentRef.setInput('regions', {} as PlayerRegionTemplates);
  fixture.componentRef.setInput('summaryBindings', {} as GridPlayerSummaryBindings);
  fixture.componentRef.setInput(
    'deferSummaryCollisionDuringPointerDrag',
    options.deferSummaryCollisionDuringPointerDrag ?? false,
  );
  fixture.componentRef.setInput(
    'hasActiveBattlefieldPointerDrag',
    options.activePointerDrag ?? false,
  );
  fixture.detectChanges();

  const root = fixture.nativeElement as HTMLElement;
  const summary = root.querySelector<HTMLElement>('.player-cell-summary');
  const card = root.querySelector<HTMLElement>('[data-testid="game-card"]');
  if (!summary || !card) {
    throw new Error('Expected the summary and battlefield card test elements.');
  }

  const summaryRect = vi.fn(() => rect(0, 0, 120, 72));
  const cardRect = vi.fn(() => rect(20, 20, 80, 112));
  summary.getBoundingClientRect = summaryRect;
  card.getBoundingClientRect = cardRect;

  return { fixture, summaryRect, cardRect };
}

function installAnimationFrameQueue(): {
  cancel: ReturnType<typeof vi.spyOn>;
  flushAll(): void;
} {
  let nextFrameId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    (callback: FrameRequestCallback): number => {
      const frameId = ++nextFrameId;
      callbacks.set(frameId, callback);
      return frameId;
    },
  );
  const cancel = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((frameId: number): void => {
      callbacks.delete(frameId);
    });

  return {
    cancel,
    flushAll(): void {
      while (callbacks.size > 0) {
        const [frameId, callback] = callbacks.entries().next().value as [
          number,
          FrameRequestCallback,
        ];
        callbacks.delete(frameId);
        callback(0);
      }
    },
  };
}

function seat(): GridSeat {
  return {
    seat: 'current',
    player: {
      id: 'local',
      state: {
        user: { id: 'local', displayName: 'Local', email: 'local@example.test', roles: [] },
        status: 'active',
        life: 40,
        commanderDamage: {},
        counters: {},
        zones: {
          library: [],
          hand: [],
          battlefield: [
            {
              instanceId: 'battlefield-card',
              position: { x: 0.2, y: 0.2, unit: 'ratio' },
            } as GameCardInstance,
          ],
          command: [],
          exile: [],
          graveyard: [],
        },
      },
    } as PlayerView,
  };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}
