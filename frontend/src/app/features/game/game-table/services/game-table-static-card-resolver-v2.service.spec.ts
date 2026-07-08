import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CardsApi } from '../../../../core/api/cards.api';
import type { Card } from '../../../../core/models/card.model';
import type { BootstrapStaticCardV2, PatchEnvelopeV2 } from '../../../../core/models/game-v2.model';
import type { GameTableNormalizedV2State } from '../state/realtime/game-table-normalized-v2.store';
import { GameTableStaticCardResolverV2Service } from './game-table-static-card-resolver-v2.service';

describe('GameTableStaticCardResolverV2Service', () => {
  let service: GameTableStaticCardResolverV2Service;
  const cardsApi = {
    getSilently: vi.fn(),
  };

  beforeEach(() => {
    cardsApi.getSilently.mockReset();
    TestBed.configureTestingModule({
      providers: [
        GameTableStaticCardResolverV2Service,
        { provide: CardsApi, useValue: cardsApi },
      ],
    });
    service = TestBed.inject(GameTableStaticCardResolverV2Service);
  });

  it('resolves a visible private runtime card cache miss from the card catalog', async () => {
    cardsApi.getSilently.mockReturnValue(of({ card: card('print-forest', 'Forest') }));
    const patch = patchV2([{
      op: 'zone.cards.add',
      playerId: 'player-1',
      zone: 'hand',
      cards: [{
        instanceId: 'drawn-1',
        cardKey: 'runtime-card-forest',
        printId: 'print-forest',
        cardVersion: 'forest-v1',
        language: 'en',
        viewerVisibility: 'private',
        ownerId: 'player-1',
        controllerId: 'player-1',
      }],
    }]);

    const hydrated = await service.hydratePatch(patch, stateWithStaticCards({}));
    const add = hydrated.ops[0] as Extract<PatchEnvelopeV2['ops'][number], { op: 'zone.cards.add' }>;

    expect(cardsApi.getSilently).toHaveBeenCalledWith('print-forest');
    expect(add.staticCards?.['runtime-card-forest']).toMatchObject({
      cardRef: 'runtime-card-forest',
      cardKey: 'runtime-card-forest',
      printId: 'print-forest',
      cardVersion: 'forest-v1',
      language: 'en',
      viewerVisibility: 'private',
      scryfallId: 'print-forest',
      name: 'Forest',
    });
  });

  it('normalizes runtime scryfall print ids before catalog lookup', async () => {
    const scryfallId = '0007fa33-ccc3-4e33-8d83-909c5c8d408c';
    const runtimePrintId = `scryfall:${scryfallId}:315a4486f3f6b25f`;
    cardsApi.getSilently.mockReturnValue(of({ card: card(scryfallId, 'Plains') }));
    const patch = patchV2([{
      op: 'zone.cards.add',
      playerId: 'player-1',
      zone: 'hand',
      cards: [{
        instanceId: 'drawn-1',
        cardKey: runtimePrintId,
        printId: runtimePrintId,
        cardVersion: 'runtime-identity-v1',
        language: 'en',
        viewerVisibility: 'private',
        ownerId: 'player-1',
        controllerId: 'player-1',
      }],
    }]);

    const hydrated = await service.hydratePatch(patch, stateWithStaticCards({}));
    const add = hydrated.ops[0] as Extract<PatchEnvelopeV2['ops'][number], { op: 'zone.cards.add' }>;

    expect(cardsApi.getSilently).toHaveBeenCalledWith(scryfallId);
    expect(add.staticCards?.[runtimePrintId]).toMatchObject({
      cardRef: runtimePrintId,
      cardKey: runtimePrintId,
      printId: scryfallId,
      scryfallId,
      name: 'Plains',
    });
  });

  it('does not resolve or expose hidden rival private cards', async () => {
    const patch = patchV2([{
      op: 'zone.cards.add',
      playerId: 'player-2',
      zone: 'hand',
      cards: [{
        instanceId: 'rival-hidden-1',
        ownerId: 'player-2',
        controllerId: 'player-2',
        hidden: true,
      }],
    }]);

    const hydrated = await service.hydratePatch(patch, stateWithStaticCards({}));

    expect(hydrated).toBe(patch);
    expect(cardsApi.getSilently).not.toHaveBeenCalled();
    expect(JSON.stringify(hydrated)).not.toContain('Forest');
    expect(JSON.stringify(hydrated)).not.toContain('print-forest');
  });

  it('does not call the catalog when static identity is already cached', async () => {
    const cached = staticCard('runtime-card-forest', 'print-forest', 'Forest');
    const patch = patchV2([{
      op: 'zone.cards.add',
      playerId: 'player-1',
      zone: 'hand',
      cards: [{
        instanceId: 'drawn-1',
        cardKey: 'runtime-card-forest',
        printId: 'print-forest',
        cardVersion: 'forest-v1',
        language: 'en',
        viewerVisibility: 'private',
      }],
    }]);

    const hydrated = await service.hydratePatch(patch, stateWithStaticCards({
      'runtime-card-forest': cached,
    }));

    expect(hydrated).toBe(patch);
    expect(cardsApi.getSilently).not.toHaveBeenCalled();
  });

  it('replaces a synthetic Card placeholder hint with resolved static content', async () => {
    cardsApi.getSilently.mockReturnValue(of({ card: card('print-forest', 'Forest') }));
    const patch = patchV2([{
      op: 'zone.cards.add',
      playerId: 'player-1',
      zone: 'hand',
      cards: [{
        instanceId: 'drawn-1',
        cardKey: 'runtime-card-forest',
        printId: 'print-forest',
        cardVersion: 'forest-v1',
        language: 'en',
        viewerVisibility: 'private',
      }],
      staticCards: {
        'runtime-card-forest': {
          ...staticCard('runtime-card-forest', 'print-forest', 'Card'),
          imageUris: null,
          cardFaces: [],
        },
      },
    }]);

    const hydrated = await service.hydratePatch(patch, stateWithStaticCards({}));
    const add = hydrated.ops[0] as Extract<PatchEnvelopeV2['ops'][number], { op: 'zone.cards.add' }>;

    expect(add.staticCards?.['runtime-card-forest'].name).toBe('Forest');
    expect(add.staticCards?.['runtime-card-forest'].imageUris?.normal).toBe('https://cards.test/print-forest.jpg');
  });

  it('replaces a synthetic Card placeholder move staticCard with resolved static content', async () => {
    cardsApi.getSilently.mockReturnValue(of({ card: card('print-forest', 'Forest') }));
    const patch = patchV2([{
      op: 'zone.cards.move',
      instanceId: 'drawn-1',
      from: { playerId: 'player-1', zone: 'library' },
      to: { playerId: 'player-1', zone: 'hand', index: 0 },
      card: {
        instanceId: 'drawn-1',
        cardKey: 'runtime-card-forest',
        printId: 'print-forest',
        cardVersion: 'forest-v1',
        language: 'en',
        viewerVisibility: 'private',
      },
      staticCard: {
        ...staticCard('runtime-card-forest', 'print-forest', 'Card'),
        imageUris: null,
        cardFaces: [],
      },
    }]);

    const hydrated = await service.hydratePatch(patch, stateWithStaticCards({}));
    const move = hydrated.ops[0] as Extract<PatchEnvelopeV2['ops'][number], { op: 'zone.cards.move' }>;

    expect(cardsApi.getSilently).toHaveBeenCalledWith('print-forest');
    expect(move.staticCard?.name).toBe('Forest');
    expect(move.staticCard?.imageUris?.normal).toBe('https://cards.test/print-forest.jpg');
  });

  it('does not cache failed catalog lookups as permanent misses', async () => {
    const patch = patchV2([{
      op: 'zone.cards.add',
      playerId: 'player-1',
      zone: 'hand',
      cards: [{
        instanceId: 'drawn-1',
        cardKey: 'runtime-card-forest',
        printId: 'print-forest',
        cardVersion: 'forest-v1',
        language: 'en',
        viewerVisibility: 'private',
      }],
    }]);
    cardsApi.getSilently
      .mockReturnValueOnce(throwError(() => new Error('catalog unavailable')))
      .mockReturnValueOnce(of({ card: card('print-forest', 'Forest') }));

    const failed = await service.hydratePatch(patch, stateWithStaticCards({}));
    const retried = await service.hydratePatch(patch, stateWithStaticCards({}));
    const add = retried.ops[0] as Extract<PatchEnvelopeV2['ops'][number], { op: 'zone.cards.add' }>;

    expect(failed).toBe(patch);
    expect(cardsApi.getSilently).toHaveBeenCalledTimes(2);
    expect(add.staticCards?.['runtime-card-forest'].name).toBe('Forest');
  });

  it('hydrates compact helper add card refs from the card catalog without runtime static payload', async () => {
    cardsApi.getSilently.mockReturnValue(of({ card: card('monarch-print', 'The Monarch') }));
    const patch = patchV2([{
      op: 'helper.add',
      entity: {
        id: 'helper-monarch',
        template: 'monarch',
        scope: 'global',
        ownerPlayerId: 'player-1',
        card: {
          scryfallId: 'monarch-print',
          name: 'The Monarch',
          layout: 'token',
        },
        state: {},
        createdAt: '2026-07-08T00:00:00+00:00',
      },
    }]);

    const hydrated = await service.hydratePatch(patch, stateWithStaticCards({}));
    const add = hydrated.ops[0] as Extract<PatchEnvelopeV2['ops'][number], { op: 'helper.add' }>;

    expect(cardsApi.getSilently).toHaveBeenCalledWith('monarch-print');
    expect(add.entity.card).toEqual(expect.objectContaining({
      scryfallId: 'monarch-print',
      name: 'The Monarch',
      imageUris: { normal: 'https://cards.test/monarch-print.jpg' },
      typeLine: 'Basic Land - Forest',
      layout: 'token',
    }));
    expect(JSON.stringify(patch)).not.toContain('imageUris');
  });

  it('hydrates compact helper updates with double-faced card images from the card catalog', async () => {
    const dayNight = card('day-night-print', 'Day // Night');
    dayNight.layout = 'double_faced_token';
    dayNight.cardFaces = [
      {
        name: 'Day',
        manaCost: null,
        typeLine: 'Card',
        oracleText: 'It is day.',
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: { normal: 'https://cards.test/day-night-front.jpg' },
      },
      {
        name: 'Night',
        manaCost: null,
        typeLine: 'Card',
        oracleText: 'It is night.',
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: { normal: 'https://cards.test/day-night-back.jpg' },
      },
    ];
    cardsApi.getSilently.mockReturnValue(of({ card: dayNight }));
    const patch = patchV2([{
      op: 'helper.update',
      entity: {
        id: 'helper-day-night',
        template: 'day_night',
        scope: 'global',
        ownerPlayerId: null,
        card: {
          scryfallId: 'day-night-print',
          name: 'Day // Night',
          layout: 'double_faced_token',
        },
        state: { mode: 'night' },
        createdAt: '2026-07-08T00:00:00+00:00',
      },
    }]);

    const hydrated = await service.hydratePatch(patch, stateWithStaticCards({}));
    const update = hydrated.ops[0] as Extract<PatchEnvelopeV2['ops'][number], { op: 'helper.update' }>;

    expect(update.entity.card?.imageUris?.normal).toBe('https://cards.test/day-night-print.jpg');
    expect(update.entity.card?.cardFaces?.[1]?.imageUris.normal).toBe('https://cards.test/day-night-back.jpg');
    expect(update.entity.card?.layout).toBe('double_faced_token');
  });

  it('keeps helpers as marker refs when the card catalog cannot resolve the print', async () => {
    cardsApi.getSilently.mockReturnValue(of({ card: null }));
    const patch = patchV2([{
      op: 'helper.add',
      entity: {
        id: 'helper-unsupported',
        template: 'citys_blessing',
        scope: 'player',
        ownerPlayerId: 'player-1',
        card: {
          scryfallId: 'missing-helper-print',
          name: 'Unsupported Helper',
          layout: 'token',
        },
        state: {},
        createdAt: '2026-07-08T00:00:00+00:00',
      },
    }]);

    const hydrated = await service.hydratePatch(patch, stateWithStaticCards({}));

    expect(hydrated).toBe(patch);
    expect(cardsApi.getSilently).toHaveBeenCalledWith('missing-helper-print');
    expect(JSON.stringify(hydrated)).not.toContain('Unknown Card');
  });
});

function patchV2(ops: PatchEnvelopeV2['ops']): PatchEnvelopeV2 & { kind: 'patch.v2' } {
  return {
    kind: 'patch.v2',
    gameId: 'game-1',
    version: 2,
    visibility: 'player:player-1',
    ops,
  };
}

function stateWithStaticCards(staticCards: Record<string, BootstrapStaticCardV2>): GameTableNormalizedV2State {
  return {
    staticCards,
  } as GameTableNormalizedV2State;
}

function staticCard(cardKey: string, printId: string, name: string): BootstrapStaticCardV2 {
  return {
    cardRef: cardKey,
    cardKey,
    printId,
    cardVersion: 'forest-v1',
    language: 'en',
    viewerVisibility: 'private',
    scryfallId: printId,
    name,
    imageUris: { normal: `https://cards.test/${printId}.jpg` },
    cardFaces: [],
  };
}

function card(scryfallId: string, name: string): Card {
  return {
    id: scryfallId,
    scryfallId,
    name,
    manaCost: null,
    typeLine: 'Basic Land - Forest',
    oracleText: null,
    colors: [],
    colorIdentity: ['G'],
    legalities: {},
    imageUris: { normal: `https://cards.test/${scryfallId}.jpg` },
    cardFaces: [],
    hasRulings: false,
    layout: 'normal',
    commanderLegal: true,
    set: 'tst',
    collectorNumber: '1',
    lang: 'en',
  };
}
