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
