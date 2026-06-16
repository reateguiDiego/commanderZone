import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { GameSnapshot } from '../../../../../core/models/game.model';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableSpecialEntitiesState } from './game-table-special-entities.state';

describe('GameTableSpecialEntitiesState', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GameTableCoreState,
        GameTableSpecialEntitiesState,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'game-1' } } },
        },
      ],
    });
  });

  it('uses the stored monarch card artwork while keeping monarch gameplay identity', () => {
    const core = TestBed.inject(GameTableCoreState);
    const state = TestBed.inject(GameTableSpecialEntitiesState);

    core.snapshot.set(snapshotWithMonarchCard());

    const monarchCard = state.monarchCardForPlayer('user-1');

    expect(monarchCard).toEqual(expect.objectContaining({
      instanceId: 'monarch:monarch-1',
      scryfallId: 'monarch-card',
      name: 'The Monarch',
      imageUris: { normal: 'https://cards.test/monarch.jpg' },
      typeLine: 'Card',
      layout: 'monarch',
      oracleText: 'You are the monarch.',
    }));
  });

  it('uses the stored initiative card artwork while keeping initiative gameplay identity', () => {
    const core = TestBed.inject(GameTableCoreState);
    const state = TestBed.inject(GameTableSpecialEntitiesState);

    core.snapshot.set({
      ...snapshotWithMonarchCard(),
      players: {
        'user-1': {
          ...snapshotWithMonarchCard().players['user-1'],
          zones: {
            ...snapshotWithMonarchCard().players['user-1']!.zones,
            battlefield: [{
              instanceId: 'lost-mine-1',
              ownerId: 'user-1',
              controllerId: 'user-1',
              name: 'Lost Mine of Phandelver',
              typeLine: 'Dungeon',
              layout: 'dungeon',
              tapped: false,
              counters: {},
            }],
          },
        },
      },
      specialEntities: [{
        id: 'initiative-1',
        template: 'initiative',
        scope: 'global',
        ownerPlayerId: 'user-1',
        card: {
          scryfallId: 'initiative-card',
          name: 'Undercity // The Initiative',
          imageUris: { normal: 'https://cards.test/undercity.jpg' },
          cardFaces: [
            {
              name: 'Undercity',
              manaCost: null,
              typeLine: 'Dungeon - Undercity',
              oracleText: 'Venture into Undercity only.',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
              imageUris: { normal: 'https://cards.test/undercity.jpg' },
            },
            {
              name: 'The Initiative',
              manaCost: null,
              typeLine: 'Card',
              oracleText: 'You have the initiative.',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
              imageUris: { normal: 'https://cards.test/initiative.jpg' },
            },
          ],
          typeLine: 'Dungeon - Undercity // Card',
          oracleText: 'Undercity // The Initiative',
          layout: 'double_faced_token',
        },
        state: {},
        createdAt: '2026-06-16T00:00:00+00:00',
      }],
    });

    const initiativeCard = state.initiativeCardForPlayer('user-1');

    expect(initiativeCard).toEqual(expect.objectContaining({
      instanceId: 'initiative:initiative-1',
      scryfallId: 'initiative-card',
      name: 'The Initiative',
      imageUris: { normal: 'https://cards.test/undercity.jpg' },
      typeLine: 'Card',
      layout: 'initiative',
      oracleText: 'You have the initiative.',
      activeFaceIndex: 1,
    }));
  });

  it('does not render the initiative helper card while the active dungeon is Undercity', () => {
    const core = TestBed.inject(GameTableCoreState);
    const state = TestBed.inject(GameTableSpecialEntitiesState);

    core.snapshot.set({
      ...snapshotWithMonarchCard(),
      players: {
        'user-1': {
          ...snapshotWithMonarchCard().players['user-1'],
          zones: {
            ...snapshotWithMonarchCard().players['user-1']!.zones,
            battlefield: [{
              instanceId: 'undercity-1',
              ownerId: 'user-1',
              controllerId: 'user-1',
              name: 'Undercity',
              typeLine: 'Dungeon',
              layout: 'dungeon',
              tapped: false,
              counters: {},
            }],
          },
        },
      },
      specialEntities: [{
        id: 'initiative-1',
        template: 'initiative',
        scope: 'global',
        ownerPlayerId: 'user-1',
        card: {
          scryfallId: 'initiative-card',
          name: 'Undercity // The Initiative',
          imageUris: { normal: 'https://cards.test/undercity.jpg' },
          cardFaces: [],
          typeLine: 'Dungeon - Undercity // Card',
          oracleText: 'Undercity // The Initiative',
          layout: 'double_faced_token',
        },
        state: {},
        createdAt: '2026-06-16T00:00:00+00:00',
      }],
    });

    expect(state.initiativeCardForPlayer('user-1')).toBeNull();
  });

  it('renders the initiative helper card when the player has no active dungeon', () => {
    const core = TestBed.inject(GameTableCoreState);
    const state = TestBed.inject(GameTableSpecialEntitiesState);

    core.snapshot.set({
      ...snapshotWithMonarchCard(),
      specialEntities: [{
        id: 'initiative-1',
        template: 'initiative',
        scope: 'global',
        ownerPlayerId: 'user-1',
        card: {
          scryfallId: 'initiative-card',
          name: 'Undercity // The Initiative',
          imageUris: { normal: 'https://cards.test/undercity.jpg' },
          cardFaces: [
            {
              name: 'Undercity',
              manaCost: null,
              typeLine: 'Dungeon - Undercity',
              oracleText: 'Venture into Undercity only.',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
              imageUris: { normal: 'https://cards.test/undercity.jpg' },
            },
            {
              name: 'The Initiative',
              manaCost: null,
              typeLine: 'Card',
              oracleText: 'You have the initiative.',
              power: null,
              toughness: null,
              loyalty: null,
              colors: [],
              imageUris: { normal: 'https://cards.test/initiative.jpg' },
            },
          ],
          typeLine: 'Dungeon - Undercity // Card',
          oracleText: 'Undercity // The Initiative',
          layout: 'double_faced_token',
        },
        state: {},
        createdAt: '2026-06-16T00:00:00+00:00',
      }],
    });

    expect(state.initiativeCardForPlayer('user-1')).toEqual(expect.objectContaining({
      instanceId: 'initiative:initiative-1',
      scryfallId: 'initiative-card',
      name: 'The Initiative',
      typeLine: 'Card',
      layout: 'initiative',
      activeFaceIndex: 1,
    }));
  });

  it('uses the canonical initiative artwork when the snapshot entity has no card payload', () => {
    const core = TestBed.inject(GameTableCoreState);
    const state = TestBed.inject(GameTableSpecialEntitiesState);

    core.snapshot.set({
      ...snapshotWithMonarchCard(),
      players: {
        'user-1': {
          ...snapshotWithMonarchCard().players['user-1'],
          zones: {
            ...snapshotWithMonarchCard().players['user-1']!.zones,
            battlefield: [{
              instanceId: 'lost-mine-1',
              ownerId: 'user-1',
              controllerId: 'user-1',
              name: 'Lost Mine of Phandelver',
              typeLine: 'Dungeon',
              layout: 'dungeon',
              tapped: false,
              counters: {},
            }],
          },
        },
      },
      specialEntities: [{
        id: 'initiative-1',
        template: 'initiative',
        scope: 'global',
        ownerPlayerId: 'user-1',
        card: null,
        state: {},
        createdAt: '2026-06-16T00:00:00+00:00',
      }],
    });

    expect(state.initiativeCardForPlayer('user-1')).toEqual(expect.objectContaining({
      instanceId: 'initiative:initiative-1',
      scryfallId: '2c65185b-6cf0-451d-985e-56aa45d9a57d',
      name: 'The Initiative',
      activeFaceIndex: 1,
      imageUris: expect.objectContaining({
        normal: 'https://cards.scryfall.io/normal/front/2/c/2c65185b-6cf0-451d-985e-56aa45d9a57d.jpg?1707897435',
      }),
      cardFaces: expect.arrayContaining([
        expect.objectContaining({ name: 'Undercity' }),
        expect.objectContaining({
          name: 'The Initiative',
          imageUris: expect.objectContaining({
            normal: 'https://cards.scryfall.io/normal/back/2/c/2c65185b-6cf0-451d-985e-56aa45d9a57d.jpg?1707897435',
          }),
        }),
      ]),
    }));
  });

  it('keeps the initiative preview available while Undercity is the active dungeon', () => {
    const core = TestBed.inject(GameTableCoreState);
    const state = TestBed.inject(GameTableSpecialEntitiesState);
    const initiative = {
      id: 'initiative-1',
      template: 'initiative',
      scope: 'global',
      ownerPlayerId: 'user-1',
      card: null,
      state: {},
      createdAt: '2026-06-16T00:00:00+00:00',
    } as const;

    core.snapshot.set({
      ...snapshotWithMonarchCard(),
      players: {
        'user-1': {
          ...snapshotWithMonarchCard().players['user-1'],
          zones: {
            ...snapshotWithMonarchCard().players['user-1']!.zones,
            battlefield: [{
              instanceId: 'undercity-1',
              ownerId: 'user-1',
              controllerId: 'user-1',
              name: 'Undercity',
              typeLine: 'Dungeon',
              layout: 'dungeon',
              tapped: false,
              counters: {},
            }],
          },
        },
      },
      specialEntities: [initiative],
    });

    expect(state.initiativeCardForPlayer('user-1')).toBeNull();
    expect(state.helperPreviewCard(initiative)).toEqual(expect.objectContaining({
      instanceId: 'initiative:initiative-1',
      scryfallId: '2c65185b-6cf0-451d-985e-56aa45d9a57d',
      name: 'The Initiative',
      activeFaceIndex: 1,
      zone: 'command',
      cardFaces: expect.arrayContaining([
        expect.objectContaining({ name: 'The Initiative' }),
      ]),
    }));
  });
});

function snapshotWithMonarchCard(): GameSnapshot {
  return {
    version: 1,
    ownerId: 'user-1',
    players: {
      'user-1': {
        user: { id: 'user-1', email: 'user@test', displayName: 'User', roles: [] },
        life: 40,
        zones: {
          library: [],
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          command: [],
        },
        zoneCounts: {
          library: 0,
          hand: 0,
          battlefield: 0,
          graveyard: 0,
          exile: 0,
          command: 0,
        },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'user-1', phase: 'main', number: 1 },
    stack: [],
    arrows: [],
    attachments: [],
    specialEntities: [{
      id: 'monarch-1',
      template: 'monarch',
      scope: 'global',
      ownerPlayerId: 'user-1',
      card: {
        scryfallId: 'monarch-card',
        name: 'The Monarch',
        imageUris: { normal: 'https://cards.test/monarch.jpg' },
        cardFaces: [],
        typeLine: 'Card',
        oracleText: 'You are the monarch.',
        layout: 'token',
      },
      state: {},
      createdAt: '2026-06-16T00:00:00+00:00',
    }],
    chat: [],
    eventLog: [],
    createdAt: '2026-06-16T00:00:00+00:00',
  };
}
