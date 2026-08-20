import { GameSnapshot } from '../../../../../core/models/game.model';
import { GameTableChatLogState } from './game-table-chat-log.state';

describe('GameTableChatLogState', () => {
  it('exposes aggregate moved card names for the game log tooltip', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView(snapshot(), ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.cardListLabel).toBe('3 cartas');
    expect(entry?.cardListPrefix).toBe('Moved ');
    expect(entry?.cardListSuffix).toBe(' from battlefield to graveyard.');
    expect(entry?.cardList).toEqual(['Bear', 'Elf', 'Sol Ring']);
  });

  it('renders semantic game log entries with runtime translation fallback', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      players: { 'player-1': playerState('Alice') },
      eventLog: [{
        id: 'event-semantic-draw',
        type: 'library.draw_many',
        message: 'Alice drew 2 cards.',
        actorId: 'player-1',
        displayName: 'Legacy Alice',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.library.drawMany',
        params: { actorPlayerId: 'player-1', playerId: 'player-1', count: 2 },
        refs: { players: { 'player-1': { id: 'player-1', displayName: 'Ref Alice' } } },
        visibility: 'public',
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Alice' });
    expect(entry?.messagePrefix).toBe('drew 2 cards.');
  });

  it('renders a multiple-card reveal with an external subject and recipient', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      players: {
        'player-1': playerState('Alice'),
        'player-2': playerState('Bruno'),
      },
      eventLog: [{
        id: 'event-reveal-many',
        type: 'card.revealed',
        message: 'Legacy reveal message.',
        actorId: 'player-1',
        displayName: 'Alice',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.card.revealedMany',
        params: {
          actorPlayerId: 'player-1',
          playerId: 'player-1',
          recipientPlayerIds: ['player-2'],
          revealAudience: 'players',
          count: 10,
        },
        refs: {
          players: {
            'player-1': { id: 'player-1', displayName: 'Alice' },
            'player-2': { id: 'player-2', displayName: 'Bruno' },
          },
        },
        visibility: 'public',
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Alice' });
    expect(entry?.messagePrefix).toBe('revealed 10 cards to Bruno.');
  });

  it('renders face-down inspection logs without resolving a card reference', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      players: { 'player-1': playerState('Alice') },
      eventLog: [{
        id: 'event-face-down-inspected',
        type: 'card.face_down.inspected',
        message: 'Alice looked at a face-down card.',
        actorId: 'player-1',
        displayName: 'Alice',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.card.faceDownInspected',
        params: { actorPlayerId: 'player-1' },
        visibility: 'public',
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Alice' });
    expect(entry?.messagePrefix).toBe('looked at a face-down card.');
    expect(entry?.card).toBeNull();
  });

  it('renders play-top-face-down logs without resolving a card reference', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      players: { 'player-1': playerState('Alice') },
      eventLog: [{
        id: 'event-play-top-face-down',
        type: 'library.play_top_face_down',
        message: 'Alice played the top card of their library face down.',
        actorId: 'player-1',
        displayName: 'Alice',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.library.playTopFaceDown',
        params: { actorPlayerId: 'player-1' },
        visibility: 'public',
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Alice' });
    expect(entry?.messagePrefix).toBe('played the top card of their library face down.');
    expect(entry?.card).toBeNull();
  });

  it('renders semantic game log entries with the platform translation service', () => {
    const state = new GameTableChatLogState({
      instant: (key: string, params?: Record<string, unknown>) => {
        if (key === 'gameLog.fragment.life.other') {
          return `cambi\u00f3 la vida de ${params?.['player']} de ${params?.['previousLife']} a ${params?.['life']}.`;
        }

        return key;
      },
    } as never);

    const [entry] = state.eventLogView({
      ...snapshot(),
      players: {
        'player-1': playerState('Alicia'),
        'player-2': playerState('Bruno'),
      },
      eventLog: [{
        id: 'event-semantic-life',
        type: 'life.changed',
        message: 'Alicia changed Bruno\'s life from 40 to 37.',
        actorId: 'player-1',
        displayName: 'Alicia',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.life.changed',
        params: { actorPlayerId: 'player-1', playerId: 'player-2', previousLife: 40, life: 37 },
        refs: {
          players: {
            'player-1': { id: 'player-1', displayName: 'Alicia' },
            'player-2': { id: 'player-2', displayName: 'Bruno' },
          },
        },
        visibility: 'public',
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Alicia' });
    expect(entry?.messagePrefix).toBe('cambi\u00f3 la vida de Bruno de 40 a 37.');
  });

  it('uses the reflexive fragment when the indirect complement is the subject', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      players: { 'player-1': playerState('Alice') },
      eventLog: [{
        id: 'event-life-self',
        type: 'life.changed',
        message: "Alice changed Alice's life from 40 to 37.",
        actorId: 'player-1',
        displayName: 'Alice',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.life.changed',
        params: { actorPlayerId: 'player-1', playerId: 'player-1', previousLife: 40, life: 37 },
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Alice' });
    expect(entry?.messagePrefix).toBe('changed their life from 40 to 37.');
  });

  it('uses the previous player as the external subject for turn changes', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      players: {
        'player-1': playerState('Alice'),
        'player-2': playerState('Bruno'),
      },
      eventLog: [{
        id: 'event-turn',
        type: 'turn.changed',
        message: "Alice finished their turn. Bruno's turn begins.",
        actorId: 'player-1',
        displayName: 'Alice',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.turn.changed',
        params: { actorPlayerId: 'player-1', previousPlayerId: 'player-1', playerId: 'player-2' },
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Alice' });
    expect(entry?.messagePrefix).toBe("finished their turn. Bruno's turn begins.");
  });

  it('uses the affected player as the subject for concede and expulsion logs', () => {
    const state = new GameTableChatLogState();
    const game = {
      ...snapshot(),
      players: {
        'player-1': playerState('Alice'),
        'player-2': playerState('Bruno'),
      },
    };

    const [expelled] = state.eventLogView({
      ...game,
      eventLog: [{
        id: 'event-expelled',
        type: 'disconnect.vote',
        message: 'Bruno was expelled after a disconnect vote.',
        actorId: 'player-1',
        displayName: 'Alice',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.disconnect.expelled',
        params: { actorPlayerId: 'player-1', targetPlayerId: 'player-2' },
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);
    const [conceded] = state.eventLogView({
      ...game,
      eventLog: [{
        id: 'event-concede',
        type: 'game.concede',
        message: 'Bruno conceded.',
        actorId: 'player-2',
        displayName: 'Bruno',
        createdAt: '2026-05-14T00:00:01Z',
        i18nKey: 'gameLog.game.concede',
        params: { actorPlayerId: 'player-2', playerId: 'player-2' },
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(expelled?.subject).toEqual({ kind: 'player', playerId: 'player-2', displayName: 'Bruno' });
    expect(expelled?.messagePrefix).toBe('was expelled after a disconnect vote.');
    expect(conceded?.subject).toEqual({ kind: 'player', playerId: 'player-2', displayName: 'Bruno' });
    expect(conceded?.messagePrefix).toBe('conceded.');
  });

  it('localizes player counter names and keeps the subject out of the action fragment', () => {
    const state = new GameTableChatLogState({
      instant: (key: string, params?: Record<string, unknown>) => {
        if (key === 'game.playerCounters.rad') {
          return 'Radiación';
        }
        if (key === 'gameLog.fragment.counter.changed') {
          return `puso ${params?.['counter']} en ${params?.['value']}.`;
        }

        return key;
      },
    } as never);

    const [entry] = state.eventLogView({
      ...snapshot(),
      players: { 'player-1': playerState('JD') },
      eventLog: [{
        id: 'event-player-counter',
        type: 'counter.changed',
        message: 'JD set rad to 3.',
        actorId: 'player-1',
        displayName: 'JD',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.counter.changed',
        params: { actorPlayerId: 'player-1', playerId: 'player-1', counter: 'rad', value: 3 },
        subject: { kind: 'player', playerId: 'player-1' },
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'JD' });
    expect(entry?.messagePrefix).toBe('puso Radiación en 3.');
  });

  it('translates historical player counter messages without semantic metadata', () => {
    const state = new GameTableChatLogState({
      instant: (key: string, params?: Record<string, unknown>) => {
        if (key === 'game.playerCounters.poison') {
          return 'Veneno';
        }
        if (key === 'gameLog.fragment.counter.changed') {
          return `puso ${params?.['counter']} en ${params?.['value']}.`;
        }

        return key;
      },
    } as never);

    const entries = state.eventLogView({
      ...snapshot(),
      players: { 'player-1': playerState('JD') },
      eventLog: [
        {
          id: 'event-legacy-player-counter-direct',
          type: 'counter.changed',
          message: 'JD set poison to 3.',
          actorId: 'player-1',
          displayName: 'JD',
          createdAt: '2026-05-14T00:00:00Z',
        },
        {
          id: 'event-legacy-player-counter-change',
          type: 'counter.changed',
          message: 'JD poison counter increased from 0 to 3.',
          actorId: 'player-1',
          displayName: 'JD',
          createdAt: '2026-05-14T00:00:01Z',
        },
      ],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'JD' });
      expect(entry.messagePrefix).toBe('puso Veneno en 3.');
    }
  });

  it('keeps the player as the subject for legacy messages without semantic metadata', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      eventLog: [{
        id: 'event-legacy-fallback',
        type: 'library.draw',
        message: 'Legacy draw message.',
        actorId: 'player-1',
        displayName: 'Player',
        createdAt: '2026-05-14T00:00:00Z',
        i18nKey: 'gameLog.unknown',
        params: { actorPlayerId: 'player-1' },
        refs: { players: { 'player-1': { id: 'player-1', displayName: 'Player' } } },
        visibility: 'public',
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.messagePrefix).toBe('Legacy draw message.');
    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Player' });
  });

  it('passes card-stat and face parameters to semantic game log translations', () => {
    const state = new GameTableChatLogState({
      instant: (key: string, params?: Record<string, unknown>) => {
        if (key === 'gameLog.cardStats.sagaChanged') {
          return `${params?.['actor']} cambió ${params?.['cardName']} de ${params?.['previousChapter']} a ${params?.['chapter']} (${params?.['delta']}).`;
        }
        if (key === 'gameLog.card.faceChanged') {
          return `${params?.['actor']} cambió ${params?.['cardName']} a ${params?.['faceName']}.`;
        }

        return key;
      },
    } as never);

    const entries = state.eventLog({
      ...snapshot(),
      players: { 'player-1': playerState('Alicia') },
      eventLog: [
        {
          id: 'event-semantic-saga',
          type: 'card.power_toughness.changed',
          message: 'Legacy saga message.',
          actorId: 'player-1',
          createdAt: '2026-05-14T00:00:00Z',
          i18nKey: 'gameLog.cardStats.sagaChanged',
          params: { actorPlayerId: 'player-1', cardName: 'El viejo dios', previousChapter: 'I', chapter: 'II', delta: '+1' },
        },
        {
          id: 'event-semantic-face',
          type: 'card.face.changed',
          message: 'Legacy face message.',
          actorId: 'player-1',
          createdAt: '2026-05-14T00:00:01Z',
          i18nKey: 'gameLog.card.faceChanged',
          params: { actorPlayerId: 'player-1', cardName: 'Delver', faceName: 'Insectile Aberration' },
        },
      ],
    });

    expect(entries.map((entry) => entry.message)).toEqual([
      'Alicia cambió El viejo dios de I a II (+1).',
      'Alicia cambió Delver a Insectile Aberration.',
    ]);
  });

  it('exposes aggregate card links when public-zone cards move to library', () => {
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

    expect(entry?.cardList).toEqual(['Bear', 'Elf', 'Sol Ring']);
    expect(entry?.cardListLabel).toBe('3 cartas');
    expect(entry?.cardListPrefix).toBe('Moved ');
    expect(entry?.cardListSuffix).toBe(' from graveyard to library.');
  });

  it('does not expose aggregate card links when hand cards move to library', () => {
    const state = new GameTableChatLogState();

    const [entry] = state.eventLogView({
      ...snapshot(),
      eventLog: [{
        id: 'event-library',
        type: 'cards.moved',
        message: 'Moved 3 cards from hand to library.',
        actorId: 'player-1',
        displayName: 'Player',
        createdAt: '2026-05-14T00:00:00Z',
        cardNames: ['Bear', 'Elf', 'Sol Ring'],
      }],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.cardList).toEqual([]);
    expect(entry?.cardListLabel).toBe('');
    expect(entry?.messagePrefix).toBe('Moved 3 cards from hand to library.');
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

  it('does not treat legacy automatic death entries as a concede', () => {
    const state = new GameTableChatLogState();
    const [entry] = state.eventLogView({
      ...snapshot(),
      eventLog: [
        logEntry('event-1', 'player.defeated', 'Player ha muerto.'),
      ],
    }, ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']);

    expect(entry?.appearance).toBe('default');
    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Player' });
    expect(entry?.messagePrefix).toBe('ha muerto.');
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
    expect(entry?.subject).toEqual({ kind: 'player', playerId: 'player-1', displayName: 'Player' });
    expect(entry?.messagePrefix).toBe('conceded.');
  });

  it('does not hide later game log entries after a legacy automatic death entry', () => {
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
      'Drew 1 card.',
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

function playerState(displayName: string): GameSnapshot['players'][string] {
  return {
    user: { id: displayName.toLowerCase(), email: `${displayName.toLowerCase()}@test`, displayName, roles: [] },
    life: 40,
    zones: {
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
    },
    commanderDamage: {},
    counters: {},
  };
}
