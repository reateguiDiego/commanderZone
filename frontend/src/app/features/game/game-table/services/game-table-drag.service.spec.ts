import { GameTableDragService } from './game-table-drag.service';

describe('GameTableDragService', () => {
  let service: GameTableDragService;

  beforeEach(() => {
    service = new GameTableDragService();
  });

  it('snaps a battlefield drop to the mana row when the card overlaps the lane', () => {
    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['zone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    battlefield.getBoundingClientRect = () => ({
      ...rect(10, 500),
      y: 10,
      top: 10,
      bottom: 330,
      height: 320,
    });
    const manaLane = document.createElement('div');
    manaLane.dataset['gameDropZone'] = 'mana';
    manaLane.dataset['zone'] = 'mana';
    manaLane.dataset['playerId'] = 'player-1';
    manaLane.dataset['manaLane'] = '';
    manaLane.getBoundingClientRect = () => ({
      ...rect(10, 500),
      y: 150,
      top: 150,
      bottom: 330,
      height: 180,
    });
    battlefield.appendChild(manaLane);

    const position = service.dropPosition({
      currentTarget: battlefield,
      target: battlefield,
      clientX: 150,
      clientY: 100,
    } as unknown as DragEvent, 'battlefield');

    expect(position).toEqual({ x: 82, y: 148 });
  });
});

function rect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    width,
    height: 140,
    top: 0,
    right: left + width,
    bottom: 140,
    left,
    toJSON: () => ({}),
  } as DOMRect;
}
