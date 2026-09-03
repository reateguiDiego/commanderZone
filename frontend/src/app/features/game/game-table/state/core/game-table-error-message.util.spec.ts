import { gameTableErrorMessage } from './game-table-error-message.util';

describe('gameTableErrorMessage', () => {
  it('maps base version mismatch errors to a resync-focused user message', () => {
    expect(gameTableErrorMessage({
      error: {
        code: 'BASE_VERSION_MISMATCH',
        error: 'Need resync',
      },
    })).toBe('game.gameTable.reloadRequiredMessage');
  });

  it('maps queue/circuit pressure errors to a saturation message', () => {
    expect(gameTableErrorMessage(new Error('Action temporarily blocked after repeated command rejections.')))
      .toBe('errors.runtime.no-se-pudo-aplicar-la-accion');
    expect(gameTableErrorMessage({
      error: {
        code: 'QUEUE_FULL',
        error: 'queue full',
      },
    })).toBe('errors.runtime.no-se-pudo-aplicar-la-accion');
  });

  it('maps command rejected messages to an actionable validation message', () => {
    expect(gameTableErrorMessage({
      error: {
        code: 'COMMAND_REJECTED',
        error: 'Denied',
      },
    })).toBe('errors.runtime.no-se-pudo-aplicar-la-accion');
  });

  it('does not expose a stale disconnect-vote payload error to players', () => {
    expect(gameTableErrorMessage(new Error('invalid payload field: disconnectVote')))
      .toBe('game.gameDisconnectVoteModal.targetPlayerBackOnline');
  });

  it('falls back to server detail or generic error text', () => {
    expect(gameTableErrorMessage({
      error: {
        detail: 'Specific detail',
      },
    })).toBe('Specific detail');
    expect(gameTableErrorMessage({})).toBe('errors.runtime.no-se-pudo-aplicar-la-accion');
  });
});
