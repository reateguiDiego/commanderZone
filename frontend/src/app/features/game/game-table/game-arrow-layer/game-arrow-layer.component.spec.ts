import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { PlayerView } from '../game-table.store';
import { GameArrowLayerComponent } from './game-arrow-layer.component';

describe('GameArrowLayerComponent', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cancelRafSpy: ReturnType<typeof vi.spyOn>;
  let animationFrameId = 0;

  beforeEach(() => {
    animationFrameId = 0;
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback): number => {
      const id = ++animationFrameId;
      window.setTimeout(() => callback(0), 0);
      return id;
    });
    cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
  });

  it('renders focused owner to target mini-battlefield', async () => {
    const snapshot = gameSnapshot('owner', 'target');
    const { fixture, root } = await renderArrowLayer(snapshot, 'owner');
    addMeasuredCard(root, 'owner', 'from-card', 'battlefield', rect(20, 30, 100, 140));
    addMeasuredCard(root, 'target', 'to-card', 'mini-battlefield', rect(320, 80, 40, 56));

    await measure(fixture);

    const arrow = arrowGroup(fixture);
    const line = arrow.querySelector('.game-arrow-visible-line') as SVGLineElement;
    expect(arrow.getAttribute('data-owner-render-mode')).toBe('focused-battlefield');
    expect(arrow.getAttribute('data-target-render-mode')).toBe('mini-battlefield');
    expect(line.getAttribute('x1')).toBe('70');
    expect(line.getAttribute('y1')).toBe('100');
    expect(line.getAttribute('x2')).toBe('340');
    expect(line.getAttribute('y2')).toBe('108');
    expect(arrow.querySelector('.game-arrow-companion-line')).toBeNull();
  });

  it('renders owner mini-battlefield to focused target', async () => {
    const snapshot = gameSnapshot('owner', 'target');
    const { fixture, root } = await renderArrowLayer(snapshot, 'target');
    addMeasuredCard(root, 'owner', 'from-card', 'mini-battlefield', rect(60, 70, 40, 56));
    addMeasuredCard(root, 'target', 'to-card', 'battlefield', rect(300, 160, 100, 140));

    await measure(fixture);

    const arrow = arrowGroup(fixture);
    const line = arrow.querySelector('.game-arrow-visible-line') as SVGLineElement;
    expect(arrow.getAttribute('data-owner-render-mode')).toBe('mini-battlefield');
    expect(arrow.getAttribute('data-target-render-mode')).toBe('focused-battlefield');
    expect(line.getAttribute('x1')).toBe('80');
    expect(line.getAttribute('y1')).toBe('98');
    expect(line.getAttribute('x2')).toBe('350');
    expect(line.getAttribute('y2')).toBe('230');
  });

  it('renders mini to mini when neither endpoint belongs to the focused player', async () => {
    const snapshot = gameSnapshot('owner', 'target', 'spectator');
    const { fixture, root } = await renderArrowLayer(snapshot, 'spectator');
    addMeasuredCard(root, 'owner', 'from-card', 'mini-battlefield', rect(60, 70, 40, 56));
    addMeasuredCard(root, 'target', 'to-card', 'mini-battlefield', rect(300, 160, 40, 56));

    await measure(fixture);

    const arrow = arrowGroup(fixture);
    expect(arrow.getAttribute('data-owner-render-mode')).toBe('mini-battlefield');
    expect(arrow.getAttribute('data-target-render-mode')).toBe('mini-battlefield');
  });

  it('does not render arrows with missing battlefield endpoints', async () => {
    const snapshot = gameSnapshot('owner', 'target');
    snapshot.players['target'].zones.battlefield = [];
    const { fixture, root } = await renderArrowLayer(snapshot, 'owner');
    addMeasuredCard(root, 'owner', 'from-card', 'battlefield', rect(20, 30, 100, 140));

    await measure(fixture);

    expect(fixture.nativeElement.querySelector('.game-arrow')).toBeNull();
  });

  it('uses the requested surface when real and mini copies share an instance id', async () => {
    const snapshot = gameSnapshot('owner', 'target');
    const { fixture, root } = await renderArrowLayer(snapshot, 'owner');
    addMeasuredCard(root, 'owner', 'from-card', 'mini-battlefield', rect(500, 500, 40, 56));
    addMeasuredCard(root, 'owner', 'from-card', 'battlefield', rect(20, 30, 100, 140));
    addMeasuredCard(root, 'target', 'to-card', 'mini-battlefield', rect(320, 80, 40, 56));

    await measure(fixture);

    const line = arrowGroup(fixture).querySelector('.game-arrow-visible-line') as SVGLineElement;
    expect(line.getAttribute('x1')).toBe('70');
    expect(line.getAttribute('y1')).toBe('100');
  });

  it('emits the arrow menu event from the transparent hit line', async () => {
    const snapshot = gameSnapshot('owner', 'target');
    const { fixture, root } = await renderArrowLayer(snapshot, 'owner');
    const opened = vi.fn();
    fixture.componentInstance.arrowMenuOpened.subscribe(opened);
    addMeasuredCard(root, 'owner', 'from-card', 'battlefield', rect(20, 30, 100, 140));
    addMeasuredCard(root, 'target', 'to-card', 'mini-battlefield', rect(320, 80, 40, 56));

    await measure(fixture);

    const hitLine = fixture.nativeElement.querySelector('.game-arrow-hit-line') as SVGLineElement;
    hitLine.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(opened).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'owner',
      arrowId: 'arrow-1',
    }));
  });
});

async function renderArrowLayer(
  snapshot: GameSnapshot,
  focusedPlayerId: string,
): Promise<{ fixture: ComponentFixture<GameArrowLayerComponent>; root: HTMLElement }> {
  await TestBed.configureTestingModule({
    imports: [GameArrowLayerComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(GameArrowLayerComponent);
  const root = document.createElement('section');
  document.body.appendChild(root);
  root.appendChild(fixture.nativeElement);
  defineRect(root, rect(0, 0, 800, 600));
  fixture.componentRef.setInput('snapshot', snapshot);
  fixture.componentRef.setInput('focusedPlayerId', focusedPlayerId);
  fixture.componentRef.setInput('players', playerViews(snapshot));
  fixture.componentRef.setInput('rootElement', root);
  fixture.detectChanges();

  fixture.componentRef.onDestroy(() => root.remove());

  return { fixture, root };
}

async function measure(fixture: ComponentFixture<GameArrowLayerComponent>): Promise<void> {
  fixture.componentInstance.handleWindowResize();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  fixture.detectChanges();
}

function addMeasuredCard(
  root: HTMLElement,
  playerId: string,
  instanceId: string,
  surface: 'battlefield' | 'mini-battlefield',
  bounds: DOMRect,
): HTMLElement {
  const element = document.createElement('button');
  element.dataset['arrowCardPlayerId'] = playerId;
  element.dataset['arrowCardInstanceId'] = instanceId;
  element.dataset['arrowCardSurface'] = surface;
  defineRect(element, bounds);
  root.appendChild(element);

  return element;
}

function defineRect(element: Element, bounds: DOMRect): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => bounds,
  });
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function arrowGroup(fixture: ComponentFixture<GameArrowLayerComponent>): SVGGElement {
  return fixture.nativeElement.querySelector('.game-arrow') as SVGGElement;
}

function gameSnapshot(ownerId: string, targetId: string, spectatorId?: string): GameSnapshot {
  const players: GameSnapshot['players'] = {
    [ownerId]: playerState(ownerId, 'Owner', [card('from-card', 'From')]),
    [targetId]: playerState(targetId, 'Target', [card('to-card', 'To')]),
  };
  if (spectatorId) {
    players[spectatorId] = playerState(spectatorId, 'Spectator', []);
  }

  return {
    version: 1,
    ownerId,
    players,
    turn: { activePlayerId: ownerId, phase: 'main', number: 1 },
    stack: [],
    arrows: [{ id: 'arrow-1', fromInstanceId: 'from-card', toInstanceId: 'to-card', color: 'yellow', createdAt: '' }],
    chat: [],
    eventLog: [],
    createdAt: '',
  };
}

function playerState(playerId: string, displayName: string, battlefield: GameCardInstance[]): GameSnapshot['players'][string] {
  return {
    user: { id: playerId, email: `${playerId}@test`, displayName, roles: [] },
    status: 'active',
    life: 40,
    zones: {
      library: [],
      hand: [],
      battlefield,
      graveyard: [],
      exile: [],
      command: [],
    },
    commanderDamage: {},
    counters: {},
  };
}

function card(instanceId: string, name: string): GameCardInstance {
  return { instanceId, name, tapped: false, position: { x: 0, y: 0 } };
}

function playerViews(snapshot: GameSnapshot): PlayerView[] {
  return Object.entries(snapshot.players).map(([id, state]) => ({ id, state }));
}
