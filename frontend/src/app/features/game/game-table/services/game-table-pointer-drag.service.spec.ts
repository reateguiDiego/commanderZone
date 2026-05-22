import { GameCardInstance } from '../../../../core/models/game.model';
import { GameTablePointerDragService } from './game-table-pointer-drag.service';

describe('GameTablePointerDragService', () => {
  let service: GameTablePointerDragService;

  beforeEach(() => {
    service = new GameTablePointerDragService();
  });

  it('calculates a hand insertion preview from visible card midpoints', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-player-id="player-1">
        <button data-testid="game-card" data-zone="hand" data-card-instance-id="card-1"></button>
        <button data-testid="game-card" data-zone="hand" data-card-instance-id="card-2"></button>
      </div>
    `;
    const [firstCard, secondCard] = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="game-card"]'));
    firstCard!.getBoundingClientRect = () => rect(0, 100);
    secondCard!.getBoundingClientRect = () => rect(100, 100);

    const preview = service.handDropPreviewAt(root, 'player-1', 120, handCards(), 'card-1');

    expect(preview).toEqual({ targetInstanceId: 'card-2', placement: 'before' });
  });

  it('resolves a pointer drop target with battlefield position', () => {
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
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [battlefield]),
    });

    const target = service.zoneTargetAt(pointerEvent(150, 100), { width: 100, height: 140 });

    expect(target).toEqual({
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      kind: 'zone',
      rawZone: 'battlefield',
      position: { x: 90, y: 20 },
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('uses the dragged card pointer anchor for battlefield positions', () => {
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
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [battlefield]),
    });

    const target = service.zoneTargetAt(pointerEvent(150, 100), {
      width: 100,
      height: 140,
      offsetX: 20,
      offsetY: 30,
    });

    expect(target?.position).toEqual({ x: 120, y: 60 });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('resolves the mana row when the dragged card top edge reaches the lane', () => {
    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
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
      y: 250,
      top: 250,
      bottom: 310,
      height: 60,
    });
    battlefield.appendChild(manaLane);
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [manaLane]),
    });

    const target = service.zoneTargetAt(pointerEvent(150, 320), { width: 100, height: 140 });

    expect(target).toEqual({
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      kind: 'zone',
      rawZone: 'mana',
      position: { x: 90, y: 160 },
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('does not resolve the mana row when only the dragged card overlaps it', () => {
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
      y: 250,
      top: 250,
      bottom: 310,
      height: 60,
    });
    battlefield.appendChild(manaLane);
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [battlefield]),
    });

    const target = service.zoneTargetAt(pointerEvent(150, 232), { width: 100, height: 140 });

    expect(target).toEqual({
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      kind: 'zone',
      rawZone: 'battlefield',
      position: { x: 90, y: 152 },
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('preserves the dragged card pointer anchor on x when the card top edge reaches the mana row', () => {
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
      y: 250,
      top: 250,
      bottom: 310,
      height: 60,
    });
    battlefield.appendChild(manaLane);
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [battlefield]),
    });

    const target = service.zoneTargetAt(pointerEvent(150, 280), {
      width: 100,
      height: 140,
      offsetX: 20,
      offsetY: 30,
    });

    expect(target).toEqual({
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      kind: 'zone',
      rawZone: 'mana',
      position: { x: 120, y: 160 },
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('resolves mana row when the dragged card top is inside the lower mana band', () => {
    const battlefield = document.createElement('div');
    battlefield.className = 'battlefield';
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['zone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    battlefield.getBoundingClientRect = () => ({
      ...rect(10, 500),
      y: 10,
      top: 10,
      bottom: 430,
      height: 420,
    });
    const manaLane = document.createElement('div');
    manaLane.dataset['gameDropZone'] = 'mana';
    manaLane.dataset['zone'] = 'mana';
    manaLane.dataset['playerId'] = 'player-1';
    manaLane.dataset['manaLane'] = '';
    manaLane.getBoundingClientRect = () => ({
      ...rect(10, 500),
      y: 250,
      top: 250,
      bottom: 410,
      height: 160,
    });
    battlefield.appendChild(manaLane);
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [battlefield]),
    });

    const target = service.zoneTargetAt(pointerEvent(150, 360), { width: 100, height: 140 });

    expect(target).toEqual({
      targetPlayerId: 'player-1',
      toZone: 'battlefield',
      kind: 'zone',
      rawZone: 'mana',
      position: { x: 90, y: 260 },
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('prefers player drop targets over nested zone targets', () => {
    const playerTarget = document.createElement('button');
    playerTarget.dataset['playerDropTarget'] = 'opponent-1';
    playerTarget.innerHTML = '<span data-game-drop-zone="battlefield" data-player-id="player-1" data-zone="battlefield"></span>';
    const nestedZone = playerTarget.querySelector('span')!;
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [nestedZone]),
    });

    const target = service.zoneTargetAt(pointerEvent(20, 20), { width: 100, height: 140 });

    expect(target).toEqual({
      targetPlayerId: 'opponent-1',
      toZone: 'battlefield',
      kind: 'player',
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('ignores an overlapping hand drop target when a pile zone is underneath the pointer', () => {
    const hand = document.createElement('div');
    hand.dataset['gameDropZone'] = 'hand';
    hand.dataset['zone'] = 'hand';
    hand.dataset['playerId'] = 'player-1';
    const library = document.createElement('button');
    library.dataset['gameDropZone'] = 'library';
    library.dataset['zone'] = 'library';
    library.dataset['playerId'] = 'player-1';
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [hand, library]),
    });

    const target = service.zoneTargetAt(pointerEvent(20, 20), { width: 100, height: 140 });

    expect(target).toEqual({
      targetPlayerId: 'player-1',
      toZone: 'library',
      kind: 'zone',
      rawZone: 'library',
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('can include hand drop targets for pointer flows that support hand drops', () => {
    const hand = document.createElement('div');
    hand.dataset['gameDropZone'] = 'hand';
    hand.dataset['zone'] = 'hand';
    hand.dataset['playerId'] = 'player-1';
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [hand]),
    });

    const target = service.zoneTargetAt(pointerEvent(20, 20), { width: 100, height: 140 }, { includeHand: true });

    expect(target).toEqual({
      targetPlayerId: 'player-1',
      toZone: 'hand',
      kind: 'zone',
      rawZone: 'hand',
    });

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });
});

function handCards(): GameCardInstance[] {
  return [
    { instanceId: 'card-1', name: 'Arcane Signet', tapped: false },
    { instanceId: 'card-2', name: 'Sol Ring', tapped: false },
  ];
}

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

function pointerEvent(clientX: number, clientY: number): PointerEvent {
  return { clientX, clientY } as PointerEvent;
}
