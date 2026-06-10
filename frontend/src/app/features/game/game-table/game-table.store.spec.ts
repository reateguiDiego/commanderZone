import { describe, expect, it, vi } from 'vitest';
import { GameTableStore } from './game-table.store';

describe('GameTableStore.load', () => {
  it('loads the session with the session context', async () => {
    const storeLike = {
      session: {
        load: vi.fn(async () => undefined),
      },
      contexts: {
        session: vi.fn(() => ({ gameId: () => 'game-1', refreshViewerControlAccess: vi.fn() })),
      },
    };

    await GameTableStore.prototype.load.call(storeLike as never);

    expect(storeLike.contexts.session).toHaveBeenCalledTimes(1);
    expect(storeLike.session.load).toHaveBeenCalledWith(storeLike.contexts.session.mock.results[0]?.value);
  });
});
