import { GameTableDragService } from './game-table-drag.service';

describe('GameTableDragService', () => {
  let service: GameTableDragService;

  beforeEach(() => {
    service = new GameTableDragService();
  });

  it('snaps a battlefield drop to the mana row when the card top edge reaches the lane', () => {
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
      clientY: 232,
    } as unknown as DragEvent, 'battlefield');

    expect(position).toEqual({ x: 82, y: 148 });
  });

  it('does not snap a battlefield drop to the mana row when only the card overlaps the lane', () => {
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

    expect(position).toEqual({ x: 82, y: 8 });
  });

  it('uses the real drag image anchor for native battlefield drops', () => {
    const source = document.createElement('button');
    source.className = 'game-card';
    source.getBoundingClientRect = () => ({
      ...rect(0, 100),
      height: 140,
      bottom: 140,
      right: 100,
    });
    const dataTransfer = {
      effectAllowed: '',
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };
    service.dragStart({
      target: source,
      dataTransfer,
      clientX: 10,
      clientY: 20,
    } as unknown as DragEvent, 'player-1', 'hand', {
      instanceId: 'card-1',
      name: 'Arcane Signet',
      tapped: false,
    });

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

    const position = service.dropPosition({
      currentTarget: battlefield,
      target: battlefield,
      clientX: 150,
      clientY: 100,
    } as unknown as DragEvent, 'battlefield');

    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(source, 10, 20);
    expect(position).toEqual({ x: 130, y: 70 });
  });

  it.each([
    { label: 'top-left', startClientX: 31, startClientY: 41, endClientX: 150, endClientY: 100, expected: { x: 139, y: 89 } },
    { label: 'center', startClientX: 80, startClientY: 110, endClientX: 150, endClientY: 100, expected: { x: 90, y: 20 } },
    { label: 'bottom-right', startClientX: 129, startClientY: 179, endClientX: 300, endClientY: 250, expected: { x: 191, y: 101 } },
  ])('keeps the grabbed $label point under the pointer during battlefield drag', ({ startClientX, startClientY, endClientX, endClientY, expected }) => {
    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
    battlefield.getBoundingClientRect = () => ({
      ...rect(10, 500),
      y: 10,
      top: 10,
      bottom: 330,
      height: 320,
    });
    const cardElement = document.createElement('button');
    cardElement.getBoundingClientRect = () => ({
      ...rect(30, 100),
      y: 40,
      top: 40,
      right: 130,
      bottom: 180,
      height: 140,
    });
    battlefield.appendChild(cardElement);
    const positions: Array<{ x: number; y: number }> = [];

    service.startBattlefieldPointerDrag({
      button: 0,
      currentTarget: cardElement,
      clientX: startClientX,
      clientY: startClientY,
    } as unknown as PointerEvent, 'player-1', {
      instanceId: 'card-1',
      name: 'Arcane Signet',
      tapped: false,
      position: { x: 20, y: 30 },
    });
    service.moveCardPointerDrag({
      clientX: endClientX,
      clientY: endClientY,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent, (_playerId, _instanceId, position) => positions.push(position));
    const result = service.endCardPointerDrag(undefined, () => 'battlefield', () => undefined);

    expect(positions.at(-1)).toEqual(expected);
    expect(result?.position).toEqual(expected);
  });

  it('keeps the floating pointer preview under the grabbed point outside the battlefield', () => {
    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
    battlefield.getBoundingClientRect = () => ({
      ...rect(10, 500),
      y: 10,
      top: 10,
      bottom: 330,
      height: 320,
    });
    const cardElement = document.createElement('button');
    cardElement.getBoundingClientRect = () => ({
      ...rect(30, 100),
      y: 40,
      top: 40,
      right: 130,
      bottom: 180,
      height: 140,
    });
    battlefield.appendChild(cardElement);
    const positions: Array<{ x: number; y: number }> = [];

    service.startBattlefieldPointerDrag({
      button: 0,
      currentTarget: cardElement,
      clientX: 37,
      clientY: 49,
    } as unknown as PointerEvent, 'player-1', {
      instanceId: 'card-1',
      name: 'Arcane Signet',
      tapped: false,
      position: { x: 20, y: 30 },
    });

    const firstMove = service.moveCardPointerDrag({
      clientX: 900,
      clientY: 700,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent, (_playerId, _instanceId, position) => positions.push(position));
    const secondMove = service.moveCardPointerDrag({
      clientX: 940,
      clientY: 730,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent, (_playerId, _instanceId, position) => positions.push(position));

    expect(firstMove).toBe('card-1');
    expect(secondMove).toBe('card-1');
    expect(positions.at(-1)).toEqual({ x: 400, y: 180 });
    expect(service.pointerDragPreview()).toEqual({ x: 933, y: 721, width: 100, height: 140 });
  });

  it('preserves x from the grabbed preview when snapping a pointer drag to mana row', () => {
    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
    battlefield.getBoundingClientRect = () => ({
      ...rect(10, 500),
      y: 10,
      top: 10,
      bottom: 330,
      height: 320,
    });
    const manaLane = document.createElement('div');
    manaLane.dataset['manaLane'] = '';
    manaLane.getBoundingClientRect = () => ({
      ...rect(10, 500),
      y: 150,
      top: 150,
      bottom: 330,
      height: 180,
    });
    battlefield.appendChild(manaLane);
    const cardElement = document.createElement('button');
    cardElement.getBoundingClientRect = () => ({
      ...rect(30, 100),
      y: 40,
      top: 40,
      right: 130,
      bottom: 180,
      height: 140,
    });
    battlefield.appendChild(cardElement);
    const positions: Array<{ x: number; y: number }> = [];

    service.startBattlefieldPointerDrag({
      button: 0,
      currentTarget: cardElement,
      clientX: 37,
      clientY: 49,
    } as unknown as PointerEvent, 'player-1', {
      instanceId: 'card-1',
      name: 'Arcane Signet',
      tapped: false,
      position: { x: 20, y: 30 },
    });
    service.moveCardPointerDrag({
      clientX: 180,
      clientY: 170,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent, (_playerId, _instanceId, position) => positions.push(position));

    expect(positions.at(-1)).toEqual({ x: 163, y: 148 });
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
