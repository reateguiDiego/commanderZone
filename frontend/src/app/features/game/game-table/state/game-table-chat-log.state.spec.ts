import { GameSnapshot } from '../../../../core/models/game.model';
import { GameTableChatLogState } from './game-table-chat-log.state';

describe('GameTableChatLogState', () => {
  it('exposes aggregate moved card names for the game log tooltip', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView(snapshot(), ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.cardListLabel).toBe('3 cards');
    expect(entry?.cardListPrefix).toBe('Moved ');
    expect(entry?.cardListSuffix).toBe(' from battlefield to graveyard.');
    expect(entry?.cardList).toEqual(['Bear', 'Elf', 'Sol Ring']);
  });

  it('compacts consecutive loyalty increases for the same card', () => {
    const state = new GameTableChatLogState();
    const entries = state.eventLog({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'Jace loyalty increased from 3 to 4 (+1).'),
        logEntry('event-2', 'Jace loyalty increased from 4 to 5 (+1).'),
        logEntry('event-3', 'Jace loyalty increased from 5 to 7 (+2).'),
      ],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('Jace loyalty increased from 3 to 7 (+4).');
  });

  it('compacts consecutive loyalty decreases for the same card', () => {
    const state = new GameTableChatLogState();
    const entries = state.eventLog({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'Jace loyalty decreased from 7 to 6 (-1).'),
        logEntry('event-2', 'Jace loyalty decreased from 6 to 3 (-3).'),
      ],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('Jace loyalty decreased from 7 to 3 (-4).');
  });

  it('marks player death entries for red log styling', () => {
    const state = new GameTableChatLogState();
    const [entry] = state.eventLogView({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'player.defeated', 'Player ha muerto.'),
      ],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.appearance).toBe('death');
    expect(entry?.messagePrefix).toBe('Player ha muerto.');
  });

  it('hides later game log entries from a player after their death entry', () => {
    const state = new GameTableChatLogState();
    const entries = state.eventLog({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'life.changed', 'Set Player life to 0.'),
        logEntry('event-2', 'player.defeated', 'Player ha muerto.'),
        logEntry('event-3', 'library.draw', 'Drew 1 card.'),
      ],
    });

    expect(entries.map((entry) => entry.message)).toEqual([
      'Set Player life to 0.',
      'Player ha muerto.',
    ]);
  });
});

function snapshot(): GameSnapshot {
  return {
    version: 1,
    players: {},
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [
      {
        id: 'event-1',
        type: 'cards.moved',
        message: 'Moved 3 cards from battlefield to graveyard.',
        actorId: 'player-1',
        displayName: 'Player',
        createdAt: '2026-05-14T00:00:00Z',
        cardNames: ['Bear', 'Elf', 'Sol Ring'],
      },
    ],
    createdAt: '2026-05-14T00:00:00Z',
  };
}

function logEntry(id: string, typeOrMessage: string, message?: string): GameSnapshot['eventLog'][number] {
  return {
    id,
    type: message === undefined ? 'card.power_toughness.changed' : typeOrMessage,
    message: message ?? typeOrMessage,
    actorId: 'player-1',
    displayName: 'Player',
    createdAt: '2026-05-14T00:00:00Z',
  };
}
