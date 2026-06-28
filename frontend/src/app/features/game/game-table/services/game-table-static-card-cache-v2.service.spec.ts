import { describe, expect, it } from 'vitest';
import type { BootstrapV2 } from '../../../../core/models/game-v2.model';
import { GameTableStaticCardCacheV2Service } from './game-table-static-card-cache-v2.service';

describe('GameTableStaticCardCacheV2Service', () => {
  it('does not hydrate a bootstrap instance from a cache entry with a different language', () => {
    const cache = new GameTableStaticCardCacheV2Service();
    cache.mergeBootstrap(bootstrapWithStaticCard('es', {
      'card:forest': {
        cardRef: 'card:forest',
        cardKey: 'card:forest',
        printId: 's-forest',
        cardVersion: 'forest-v1',
        language: 'es',
        viewerVisibility: 'public',
        scryfallId: 's-forest',
        name: 'Bosque',
        imageUris: null,
        cardFaces: [],
      },
    }));

    const merged = cache.mergeBootstrap(bootstrapWithStaticCard('en', {}));

    expect(merged.staticCards['card:forest']).toBeUndefined();
  });

  it('does not hydrate a public bootstrap instance from a private visibility cache entry', () => {
    const cache = new GameTableStaticCardCacheV2Service();
    cache.mergeBootstrap(bootstrapWithStaticCard('en', {
      'card:forest': {
        cardRef: 'card:forest',
        cardKey: 'card:forest',
        printId: 's-forest',
        cardVersion: 'forest-v1',
        language: 'en',
        viewerVisibility: 'private',
        scryfallId: 's-forest',
        name: 'Forest',
        imageUris: null,
        cardFaces: [],
      },
    }, 'private'));

    const merged = cache.mergeBootstrap(bootstrapWithStaticCard('en', {}, 'public'));

    expect(merged.staticCards['card:forest']).toBeUndefined();
  });

  it('keeps localized static bundles separate from default English bundles', () => {
    const cache = new GameTableStaticCardCacheV2Service();
    cache.mergeBootstrap(bootstrapWithStaticCard('es', {
      'card:forest': {
        cardRef: 'card:forest',
        cardKey: 'card:forest',
        printId: 's-forest',
        cardVersion: 'forest-v1',
        language: 'es',
        viewerVisibility: 'public',
        scryfallId: 's-forest',
        name: 'Bosque',
        imageUris: { normal: 'https://cards.test/forest-es.jpg' },
        cardFaces: [],
      },
    }));
    cache.mergeBootstrap(bootstrapWithStaticCard('en', {
      'card:forest': {
        cardRef: 'card:forest',
        cardKey: 'card:forest',
        printId: 's-forest',
        cardVersion: 'forest-v1',
        language: 'en',
        viewerVisibility: 'public',
        scryfallId: 's-forest',
        name: 'Forest',
        imageUris: { normal: 'https://cards.test/forest-en.jpg' },
        cardFaces: [],
      },
    }));

    const merged = cache.mergeBootstrap(bootstrapWithStaticCard('es', {}));

    expect(cache.knownCatalogKeys()).toContain('card%3Aforest|s-forest|forest-v1|es|public');
    expect(cache.knownCatalogKeys()).toContain('card%3Aforest|s-forest|forest-v1|en|public');
    expect(merged.staticCards['card:forest']?.imageUris?.normal).toBe('https://cards.test/forest-es.jpg');
    expect(merged.staticCards['card:forest']?.imageUris?.normal).not.toBe('https://cards.test/forest-en.jpg');
  });
});

function bootstrapWithStaticCard(
  language: string,
  staticCards: BootstrapV2['staticCards'],
  viewerVisibility = 'public',
): BootstrapV2 {
  return {
    game: {
      id: 'game-1',
      status: 'active',
      version: 1,
      viewerId: 'player-1',
      ownerId: 'player-1',
      gamePhase: 'PLAYING',
    },
    players: {
      'player-1': {
        playerId: 'player-1',
        user: null,
        displayName: 'Player',
        life: 40,
        status: 'active',
        handCount: 0,
        zoneIds: ['player-1:battlefield'],
        zoneCounts: { battlefield: 1 },
        commanderDamage: {},
        counters: {},
        deckName: null,
      },
    },
    zones: {
      'player-1:battlefield': {
        zoneId: 'player-1:battlefield',
        playerId: 'player-1',
        name: 'battlefield',
        instanceIds: ['card-1'],
      },
    },
    instances: {
      'card-1': {
        instanceId: 'card-1',
        cardRef: 'card:forest',
        cardKey: 'card:forest',
        printId: 's-forest',
        cardVersion: 'forest-v1',
        language,
        viewerVisibility,
        zoneId: 'player-1:battlefield',
        ownerId: 'player-1',
        controllerId: 'player-1',
        hidden: false,
      },
    },
    zoneCounts: { 'player-1:battlefield': 1 },
    relations: { stack: [], arrows: [], attachments: [], specialEntities: [] },
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 },
    staticCards,
  };
}
