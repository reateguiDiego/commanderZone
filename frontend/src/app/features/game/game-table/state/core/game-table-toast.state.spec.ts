import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { GameTableCoreState } from './game-table-core.state';
import { GameTableToastState } from './game-table-toast.state';

describe('GameTableToastState', () => {
  let state: GameTableToastState;
  let core: GameTableCoreState;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        GameTableToastState,
        GameTableCoreState,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['id', 'game-1']]) } },
        },
      ],
    });

    state = TestBed.inject(GameTableToastState);
    core = TestBed.inject(GameTableCoreState);
  });

  afterEach(() => {
    state.destroy();
    vi.useRealTimers();
  });

  it('dismisses error toast only when dismiss is allowed', () => {
    core.error.set('Failure');

    state.scheduleErrorDismiss('Failure', true);
    vi.advanceTimersByTime(3000);

    expect(core.error()).toBeNull();
  });

  it('keeps target toast until the timer expires or it is cleared', () => {
    state.showArrowTargetProgressToast(2);

    expect(core.targetToast()).toBe('Faltan 2 objetivos.');

    vi.advanceTimersByTime(3000);

    expect(core.targetToast()).toBeNull();

    state.showTargetToast('Target selection cancelled.');
    state.clearTargetToast();

    expect(core.targetToast()).toBeNull();
  });
});
