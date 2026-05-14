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

function logEntry(id: string, message: string): GameSnapshot['eventLog'][number] {
  return {
    id,
    type: 'card.power_toughness.changed',
    message,
    actorId: 'player-1',
    displayName: 'Player',
    createdAt: '2026-05-14T00:00:00Z',
  };
}
