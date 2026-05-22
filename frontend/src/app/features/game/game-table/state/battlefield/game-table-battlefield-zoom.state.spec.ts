import { TestBed } from '@angular/core/testing';
import { GameTableBattlefieldZoomState } from './game-table-battlefield-zoom.state';

describe('GameTableBattlefieldZoomState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('loads the default zoom when there is no stored preference', () => {
    const state = createState();

    expect(state.zoomPercent()).toBe(100);
    expect(state.cardWidthRem()).toBe('7.2rem');
    expect(state.gapRem()).toBe('0.75rem');
    expect(state.manaLaneMinHeightRem()).toBe('11.2rem');
  });

  it('loads a stored integer zoom preference within range', () => {
    window.localStorage.setItem('commanderZone.gameTable.battlefieldZoomPercent', '125');

    const state = createState();

    expect(state.zoomPercent()).toBe(125);
    expect(state.cardWidthRem()).toBe('9rem');
    expect(state.gapRem()).toBe('0.938rem');
    expect(state.manaLaneMinHeightRem()).toBe('14rem');
  });

  it.each(['69', '141', '125.5', 'not-a-number'])('ignores invalid stored zoom value %s', (storedValue) => {
    window.localStorage.setItem('commanderZone.gameTable.battlefieldZoomPercent', storedValue);

    const state = createState();

    expect(state.zoomPercent()).toBe(100);
  });

  it('increments and decrements by one percent within the supported zoom range', () => {
    const state = createState();

    state.setZoomPercent(139);
    state.zoomIn();
    expect(state.zoomPercent()).toBe(140);
    expect(state.canZoomIn()).toBe(false);

    state.setZoomPercent(71);
    state.zoomOut();
    expect(state.zoomPercent()).toBe(70);
    expect(state.canZoomOut()).toBe(false);
  });

  it('clamps and rounds direct zoom changes', () => {
    const state = createState();

    state.setZoomPercent(140.4);
    expect(state.zoomPercent()).toBe(140);

    state.setZoomPercent(69);
    expect(state.zoomPercent()).toBe(70);

    state.setZoomPercent(111.6);
    expect(state.zoomPercent()).toBe(112);
  });

  it('persists zoom changes and reset', () => {
    const state = createState();

    state.setZoomPercent(111);
    expect(window.localStorage.getItem('commanderZone.gameTable.battlefieldZoomPercent')).toBe('111');

    state.resetZoom();
    expect(state.zoomPercent()).toBe(100);
    expect(window.localStorage.getItem('commanderZone.gameTable.battlefieldZoomPercent')).toBe('100');
  });
});

function createState(): GameTableBattlefieldZoomState {
  TestBed.configureTestingModule({
    providers: [GameTableBattlefieldZoomState],
  });

  return TestBed.inject(GameTableBattlefieldZoomState);
}
