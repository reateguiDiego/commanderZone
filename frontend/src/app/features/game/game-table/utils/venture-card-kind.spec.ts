import { ventureCardKind } from './venture-card-kind';

describe('ventureCardKind', () => {
  it('detects venture text on the main card text', () => {
    expect(ventureCardKind({ oracleText: 'When this enters, venture into the dungeon.', cardFaces: [] })).toBe('venture');
  });

  it('detects initiative text with precedence over generic venture text', () => {
    expect(ventureCardKind({
      oracleText: 'When this enters, you take the initiative. Whenever you venture into the dungeon, draw a card.',
      cardFaces: [],
    })).toBe('initiative');
  });

  it('detects venture text from either face', () => {
    expect(ventureCardKind({
      oracleText: null,
      cardFaces: [
        cardFace('Front', 'Draw a card.'),
        cardFace('Back', 'When this enters, venture into the dungeon.'),
      ],
    })).toBe('venture');
  });

  it('ignores unrelated dungeon text', () => {
    expect(ventureCardKind({ oracleText: 'Search your library for a Dungeon Master.', cardFaces: [] })).toBeNull();
  });
});

function cardFace(name: string, oracleText: string) {
  return {
    name,
    manaCost: null,
    typeLine: null,
    oracleText,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    imageUris: {},
  };
}
