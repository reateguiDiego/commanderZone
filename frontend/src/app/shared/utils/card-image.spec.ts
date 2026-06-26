import { Card, CardFace } from '../../core/models/card.model';
import { bestCardArtImage, bestCardFaceImage, bestCardImage } from './card-image';

describe('card-image utilities', () => {
  it('uses the first face image when the card has no root image', () => {
    const imageUrl = bestCardImage({
      id: 'bala-ged',
      scryfallId: 'bala-ged-scryfall-id',
      name: 'Bala Ged Recovery // Bala Ged Sanctuary',
      manaCost: null,
      typeLine: 'Sorcery // Land',
      oracleText: null,
      colors: [],
      colorIdentity: [],
      legalities: {},
      imageUris: {},
      cardFaces: [
        {
          name: 'Bala Ged Recovery',
          manaCost: '{2}{G}',
          typeLine: 'Sorcery',
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          colors: ['G'],
          imageUris: { normal: 'https://cards.scryfall.io/bala-ged-front.jpg' },
        },
      ],
      layout: 'modal_dfc',
      commanderLegal: true,
      set: 'znr',
      collectorNumber: '180',
    } satisfies Card);

    expect(imageUrl).toBe('https://cards.scryfall.io/bala-ged-front.jpg');
  });

  it('reads face image URLs from localized snake_case payloads', () => {
    const imageUrl = bestCardFaceImage({
      name: 'Ajani, Nacatl Avenger',
      manaCost: null,
      typeLine: null,
      oracleText: null,
      power: null,
      toughness: null,
      loyalty: null,
      colors: [],
      imageUris: {},
      image_uris: {
        normal: 'https://cards.scryfall.io/normal/back/ajani.jpg',
      },
    } as CardFace & { image_uris: { normal: string } });

    expect(imageUrl).toBe('https://cards.scryfall.io/normal/back/ajani.jpg');
  });

  it('falls back to the first face image when the root image URI is blank', () => {
    const imageUrl = bestCardImage({
      id: 'invasion-of-zendikar',
      scryfallId: 'battle-scryfall-id',
      name: 'Invasion of Zendikar',
      manaCost: '{3}{G}',
      typeLine: 'Battle - Siege',
      oracleText: null,
      colors: ['G'],
      colorIdentity: ['G'],
      legalities: {},
      imageUris: {
        normal: '   ',
      },
      cardFaces: [
        {
          name: 'Invasion of Zendikar',
          manaCost: '{3}{G}',
          typeLine: 'Battle - Siege',
          oracleText: null,
          power: null,
          toughness: null,
          loyalty: null,
          defense: '3',
          colors: ['G'],
          imageUris: {
            normal: 'https://cards.scryfall.io/invasion-of-zendikar-front.jpg',
          },
        },
      ],
      layout: 'battle',
      commanderLegal: true,
      set: 'mom',
      collectorNumber: '194',
    } satisfies Card);

    expect(imageUrl).toBe('https://cards.scryfall.io/invasion-of-zendikar-front.jpg');
  });

  it('prefers art crop for background artwork', () => {
    const imageUrl = bestCardArtImage({
      id: 'commander',
      scryfallId: 'commander-scryfall-id',
      name: 'Test Commander',
      manaCost: null,
      typeLine: 'Legendary Creature',
      oracleText: null,
      colors: [],
      colorIdentity: [],
      legalities: {},
      imageUris: {
        normal: 'https://cards.scryfall.io/normal.jpg',
        art_crop: 'https://cards.scryfall.io/art-crop.jpg',
      },
      layout: 'normal',
      commanderLegal: true,
      set: 'tst',
      collectorNumber: '1',
    } satisfies Card);

    expect(imageUrl).toBe('https://cards.scryfall.io/art-crop.jpg');
  });

});
