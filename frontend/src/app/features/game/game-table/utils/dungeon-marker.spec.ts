import { dungeonMarkerForCard, DEFAULT_DUNGEON_MARKER } from './dungeon-marker';

describe('dungeon-marker', () => {
  it('uses a top-left default marker for dungeons without stored progress', () => {
    expect(dungeonMarkerForCard({
      name: 'Lost Mine of Phandelver',
      typeLine: 'Dungeon',
      layout: 'dungeon',
      dungeonMarker: undefined,
    })).toEqual(DEFAULT_DUNGEON_MARKER);
  });

  it('returns null for non-dungeon cards', () => {
    expect(dungeonMarkerForCard({
      name: 'Lightning Bolt',
      typeLine: 'Instant',
      layout: 'normal',
      dungeonMarker: undefined,
    })).toBeNull();
  });
});
