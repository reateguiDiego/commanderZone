import { GameSnapshot } from '../../../../../core/models/game.model';
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

  it('does not expose aggregate card links when cards move to library', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      eventLog: [{
        id: 'event-library',
        type: 'cards.moved',
        message: 'Moved 3 cards from graveyard to library.',
        actorId: 'player-1',
        displayName: 'Player',
        createdAt: '2026-05-14T00:00:00Z',
        cardNames: ['Bear', 'Elf', 'Sol Ring'],
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.cardList).toEqual([]);
    expect(entry?.cardListLabel).toBe('');
    expect(entry?.messagePrefix).toBe('Moved 3 cards from graveyard to library.');
  });

  it('sanitizes older single-card library destination logs', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      eventLog: [{
        id: 'event-library-single',
        type: 'card.moved',
        message: 'Moved Top Secret to bottom of library.',
        actorId: 'player-1',
        displayName: 'Player',
        createdAt: '2026-05-14T00:00:00Z',
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.card).toBeNull();
    expect(entry?.messagePrefix).toBe('Moved a card to bottom of library.');
    expect(entry?.messagePrefix).not.toContain('Top Secret');
  });

  it('uses explicit card instance metadata before matching log text by name', () => {
    const state = new GameTableChatLogState();
    const base = snapshot();
    base.players = {
      'player-1': {
        user: { id: 'player-1', email: 'player@test', displayName: 'Player', roles: [] },
        life: 40,
        zones: {
          library: [
            card('wrong-card', 'Forest', 'library'),
            card('selected-card', 'Forest', 'library'),
          ],
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          command: [],
        },
        commanderDamage: {},
        counters: {},
      },
    };
    base.eventLog = [{
      ...logEntry('event-random', 'zone.random_card.selected', 'Player ha seleccionado al azar Forest de library.'),
      cardInstanceId: 'selected-card',
      cardPlayerId: 'player-1',
      cardZone: 'library',
    }];

    const [entry] = state.eventLogView(base, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.card?.instanceId).toBe('selected-card');
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

  it('does not compact tap logs into a no-op state change', () => {
    const state = new GameTableChatLogState();
    const entries = state.eventLog({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'card.tapped', 'Tapped Watery Grave.'),
        logEntry('event-2', 'card.tapped', 'Untapped Watery Grave.'),
      ],
    });

    expect(entries.map((entry) => entry.message)).toEqual([
      'Tapped Watery Grave.',
      'Untapped Watery Grave.',
    ]);
  });

  it('compacts consecutive commander damage changes for the same source and target', () => {
    const state = new GameTableChatLogState();
    const entries = state.eventLog({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'commander.damage.changed', 'Commander damage from Opponent to Player increased from 0 to 1.'),
        logEntry('event-2', 'commander.damage.changed', 'Commander damage from Opponent to Player increased from 1 to 2.'),
        logEntry('event-3', 'commander.damage.changed', 'Commander damage from Opponent to Player increased from 2 to 3.'),
      ],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('Commander damage from Opponent to Player increased from 0 to 3 (+3).');
  });

  it('compacts consecutive player counter changes for the same player and counter', () => {
    const state = new GameTableChatLogState();
    const entries = state.eventLog({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'counter.changed', 'Player poison counter increased from 0 to 1.'),
        logEntry('event-2', 'counter.changed', 'Player poison counter increased from 1 to 2.'),
        logEntry('event-3', 'counter.changed', 'Player poison counter increased from 2 to 3.'),
      ],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('Player poison counter increased from 0 to 3 (+3).');
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

  it('marks concede entries for red log styling', () => {
    const state = new GameTableChatLogState();
    const [entry] = state.eventLogView({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'game.concede', 'Player conceded.'),
      ],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.appearance).toBe('death');
    expect(entry?.messagePrefix).toBe('Player conceded.');
  });

  it('hides later game log entries from a player after their death entry', () => {
    const state = new GameTableChatLogState();
    const entries = state.eventLog({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'life.changed', 'Lost 40 life (40 -> 0).'),
        logEntry('event-2', 'player.defeated', 'Player ha muerto.'),
        logEntry('event-3', 'library.draw', 'Drew 1 card.'),
      ],
    });

    expect(entries.map((entry) => entry.message)).toEqual([
      'Lost 40 life (40 -> 0).',
      'Player ha muerto.',
    ]);
  });

  it('hides later game log entries from a player after their concede entry', () => {
    const state = new GameTableChatLogState();
    const entries = state.eventLog({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'game.concede', 'Player conceded.'),
        logEntry('event-2', 'library.draw', 'Drew 1 card.'),
      ],
    });

    expect(entries.map((entry) => entry.message)).toEqual([
      'Player conceded.',
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

function card(instanceId: string, name: string, zone: 'library'): GameSnapshot['players'][string]['zones']['library'][number] {
  return {
    instanceId,
    ownerId: 'player-1',
    controllerId: 'player-1',
    name,
    zone,
    tapped: false,
  };
}
