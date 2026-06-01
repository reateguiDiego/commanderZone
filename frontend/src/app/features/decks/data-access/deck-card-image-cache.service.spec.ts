import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { Card } from '../../../core/models/card.model';
import { DeckCardImageCache } from './deck-card-image-cache.service';

describe('DeckCardImageCache', () => {
  it('deduplicates image requests by card id', async () => {
    const image = vi.fn().mockReturnValue(of({ uri: 'https://img.test/sol-ring.jpg' }));
    TestBed.configureTestingModule({
      providers: [
        DeckCardImageCache,
        { provide: CardsApi, useValue: { image } },
      ],
    });

    const cache = TestBed.inject(DeckCardImageCache);
    const [first, second] = await Promise.all([cache.resolve(cardWithoutImage()), cache.resolve(cardWithoutImage())]);

    expect(first).toBe('https://img.test/sol-ring.jpg');
    expect(second).toBe('https://img.test/sol-ring.jpg');
    expect(image).toHaveBeenCalledOnce();
  });

  it('uses the localized card payload image without calling the image endpoint', async () => {
    const image = vi.fn().mockReturnValue(of({ uri: 'https://img.test/original.jpg' }));
    TestBed.configureTestingModule({
      providers: [
        DeckCardImageCache,
        { provide: CardsApi, useValue: { image } },
      ],
    });

    const cache = TestBed.inject(DeckCardImageCache);

    expect(await cache.resolve(card())).toBe('https://img.test/fallback.jpg');
    expect(image).not.toHaveBeenCalled();
  });

  it('returns null when no local image exists and the endpoint fails', async () => {
    TestBed.configureTestingModule({
      providers: [
        DeckCardImageCache,
        { provide: CardsApi, useValue: { image: vi.fn().mockReturnValue(throwError(() => new Error('offline'))) } },
      ],
    });

    const cache = TestBed.inject(DeckCardImageCache);

    expect(await cache.resolve(cardWithoutImage())).toBeNull();
  });

  it('clears cached urls', async () => {
    TestBed.configureTestingModule({
      providers: [
        DeckCardImageCache,
        { provide: CardsApi, useValue: { image: vi.fn().mockReturnValue(of({ uri: 'https://img.test/sol-ring.jpg' })) } },
      ],
    });

    const cache = TestBed.inject(DeckCardImageCache);
    await cache.resolve(cardWithoutImage());
    cache.clear();

    expect(cache.imageUrl(card())).toBe('https://img.test/fallback.jpg');
  });
});

function card(): Card {
  return {
    id: 'card-1',
    scryfallId: 'scryfall-1',
    name: 'Sol Ring',
    manaCost: '{1}',
    typeLine: 'Artifact',
    oracleText: null,
    colors: [],
    colorIdentity: [],
    legalities: {},
    imageUris: { normal: 'https://img.test/fallback.jpg' },
    layout: 'normal',
    commanderLegal: true,
    set: null,
    collectorNumber: null,
  };
}

function cardWithoutImage(): Card {
  return {
    ...card(),
    imageUris: {},
  };
}
