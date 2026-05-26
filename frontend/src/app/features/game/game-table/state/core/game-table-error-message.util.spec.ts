import { gameTableErrorMessage } from './game-table-error-message.util';

describe('gameTableErrorMessage', () => {
  it('maps base version mismatch errors to a resync-focused user message', () => {
    expect(gameTableErrorMessage({
      error: {
        code: 'BASE_VERSION_MISMATCH',
        error: 'Need resync',
      },
    })).toBe('Sincronizando mesa... reintenta.');
  });

  it('maps queue/circuit pressure errors to a saturation message', () => {
    expect(gameTableErrorMessage(new Error('Action temporarily blocked after repeated command rejections.')))
      .toBe('Accion temporalmente limitada para evitar saturacion.');
    expect(gameTableErrorMessage({
      error: {
        code: 'QUEUE_FULL',
        error: 'queue full',
      },
    })).toBe('Accion temporalmente limitada para evitar saturacion.');
  });

  it('maps command rejected messages to an actionable validation message', () => {
    expect(gameTableErrorMessage({
      error: {
        code: 'COMMAND_REJECTED',
        error: 'Denied',
      },
    })).toBe('La accion ya no es valida en el estado actual.');
  });

  it('falls back to server detail or generic error text', () => {
    expect(gameTableErrorMessage({
      error: {
        detail: 'Specific detail',
      },
    })).toBe('Specific detail');
    expect(gameTableErrorMessage({})).toBe('Action failed.');
  });
});
