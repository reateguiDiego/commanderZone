import { Component, importProvidersFrom, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChevronDown, LucideAngularModule, Skull } from 'lucide-angular';
import type { GameCardInstance } from '../../../../core/models/game.model';
import type { PlayerView } from '../game-table.store';
import { GameTableGridLayoutComponent } from './game-table-grid-layout.component';
import { GridPlayerBattlefieldComponent } from './grid-player-battlefield.component';
import { buildGridSeats, type GridPlayerSummaryBindings } from './game-table-grid-seat.model';
import { GameTableLayoutState } from './game-table-layout-state';
import { GameTableSessionPreferencesStore } from '../state/core/game-table-session-preferences.store';

@Component({
  imports: [GameTableGridLayoutComponent],
  template: `
    <ng-template #region let-player>{{ player.id }}</ng-template>
    <app-game-table-grid-layout
      [seats]="seats()"
      [activePlayerId]="'local'"
      [regions]="{ battlefield: region, hand: region, zones: region }"
      [summaryBindings]="summaryBindings()"
      [renderMemoEnabled]="renderMemoEnabled()"
      [playmatImage]="playmatImage"
      [canConcede]="canConcede"
    />
  `,
})
class GridHost {
  readonly seats = signal(buildGridSeats([player('local')], player('local')));
  readonly concedePlayerId = signal<string | null>(null);
  readonly renderMemoEnabled = signal(false);
  readonly canConcede = (playerId: string): boolean => this.concedePlayerId() === playerId;
  readonly summaryBindings = signal<GridPlayerSummaryBindings>({
    players: [],
    colorAccent: () => '',
    deckLabel: () => '',
    manaSymbols: () => [],
    playerCounterValue: () => 0,
    canEditCounters: () => false,
    autoApplyCommanderDamageToLife: false,
    specialEntities: () => [],
    showHelperPreview: () => undefined,
    hideHelperPreview: () => undefined,
    openHelperContext: () => undefined,
    changeLife: () => undefined,
    changeCommanderDamage: () => undefined,
    changePlayerCounter: () => undefined,
  });
  readonly playmatImage = (player: PlayerView): string =>
    `/assets/images/playmat/${player.id}.webp`;
}

describe('GameTable grid layout', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [importProvidersFrom(LucideAngularModule.pick({ ChevronDown, Skull }))],
    });
  });

  it('assigns stable areas for one to four players and rejects incompatible tables', async () => {
    await TestBed.configureTestingModule({ imports: [GridHost] }).compileComponents();
    const fixture = TestBed.createComponent(GridHost);
    for (const count of [1, 2, 3, 4]) {
      const players = [
        player('local'),
        ...Array.from({ length: count - 1 }, (_, i) => player(`opponent-${i + 1}`)),
      ];
      const seats = buildGridSeats(players, players[0]);
      fixture.componentInstance.seats.set(seats);
      fixture.detectChanges();
      const cells = [...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-seat]')];
      expect(cells.map((cell) => cell.getAttribute('data-seat'))).toEqual([
        ...players.slice(1).map((p) => p.id),
        'current',
      ]);
      expect(
        cells
          .filter((cell) => cell.classList.contains('is-top-row'))
          .map((cell) => cell.getAttribute('data-seat')),
      ).toEqual(count === 1 ? [] : count === 2 ? ['opponent-1'] : ['opponent-1', 'opponent-2']);
      expect(
        cells
          .filter((cell) => cell.classList.contains('is-right-column'))
          .map((cell) => cell.getAttribute('data-seat')),
      ).toEqual(count === 3 ? ['opponent-2'] : count === 4 ? ['opponent-2', 'current'] : []);
      expect(cells.at(-1)?.getAttribute('data-player-id')).toBe('local');
      expect(fixture.nativeElement.querySelector(`.grid--${count}-players`)).not.toBeNull();
      players[0].state.status = 'conceded';
      expect(buildGridSeats(players, players[0]).map((seat) => seat.player.id)).toEqual(
        seats.map((seat) => seat.player.id),
      );
    }
    const five = ['local', 'a', 'b', 'c', 'd'].map(player);
    expect(buildGridSeats(five, five[0])).toEqual([]);
    expect(buildGridSeats(five.slice(0, 2), null)).toEqual([]);
    expect(buildGridSeats(five.slice(0, 2), player('missing'))).toEqual([]);
    fixture.componentInstance.seats.set(buildGridSeats(five, five[0]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="game-table-grid"]')).toBeNull();
  });

  it('temporarily falls back to Square and restores the selected Grid layout when it becomes available again', () => {
    TestBed.configureTestingModule({ providers: [GameTableLayoutState] });
    const layout = TestBed.inject(GameTableLayoutState);
    const players = signal(['local', 'opponent'].map(player));
    layout.connect({ gameId: () => 'game-1', players, currentPlayer: () => players()[0] });
    TestBed.tick();
    layout.select('grid');
    const rect = { width: 400, height: 200, left: 0, right: 400, top: 0, bottom: 200 };
    layout.recordSize({ playerId: 'opponent', rect });
    expect(layout.rectangle('opponent')).toEqual(rect);
    players.set(['local', 'a', 'b', 'c', 'd'].map(player));
    expect(layout.mode()).toBe('square');
    TestBed.tick();
    players.set(['local', 'opponent'].map(player));
    expect(layout.mode()).toBe('grid');
    expect(layout.rectangle('opponent')).toBeNull();
  });

  it('initializes each new game from settings and preserves a layout selected for the current game', () => {
    TestBed.configureTestingModule({
      providers: [
        GameTableLayoutState,
        {
          provide: GameTableSessionPreferencesStore,
          useValue: { preferences: { defaultBattlefieldLayout: 'grid' } },
        },
      ],
    });
    const layout = TestBed.inject(GameTableLayoutState);
    const players = signal(['local', 'opponent'].map(player));
    const gameId = signal('game-1');

    layout.connect({ gameId, players, currentPlayer: () => players()[0] });
    TestBed.tick();
    expect(layout.mode()).toBe('grid');
    layout.select('square');
    expect(localStorage.getItem('commanderzone.game-table.layout:game-1')).toBe('square');

    gameId.set('game-2');
    TestBed.tick();
    expect(layout.mode()).toBe('grid');
    expect(localStorage.getItem('commanderzone.game-table.layout:game-2')).toBe('grid');

    gameId.set('game-1');
    TestBed.tick();
    expect(layout.mode()).toBe('square');

    players.set(['local', 'a', 'b', 'c', 'd'].map(player));
    expect(layout.mode()).toBe('square');
  });

  it('assigns each Grid battlefield its owner playmat', async () => {
    await TestBed.configureTestingModule({ imports: [GridHost] }).compileComponents();
    const fixture = TestBed.createComponent(GridHost);
    const players = [player('local'), player('opponent')];
    fixture.componentInstance.seats.set(buildGridSeats(players, players[0]));
    fixture.detectChanges();

    const panels = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '[data-testid="grid-player-panel"]',
      ),
    ];
    expect(panels.map((panel) => panel.style.getPropertyValue('--grid-player-playmat'))).toEqual([
      'url("/assets/images/playmat/opponent.webp")',
      'url("/assets/images/playmat/local.webp")',
    ]);
  });

  it('places the shared concede button below the target player summary', async () => {
    await TestBed.configureTestingModule({ imports: [GridHost] }).compileComponents();
    const fixture = TestBed.createComponent(GridHost);
    const players = [player('local'), player('opponent')];
    fixture.componentInstance.seats.set(buildGridSeats(players, players[0]));
    fixture.componentInstance.concedePlayerId.set('local');
    fixture.detectChanges();

    const localPanel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="grid-player-panel"][data-player-id="local"]',
    );
    expect(localPanel?.querySelector('[data-testid="battlefield-concede"]')).not.toBeNull();
  });

  it('forwards fresh summary bindings unchanged while the render memo experiment is off', async () => {
    await TestBed.configureTestingModule({ imports: [GridHost] }).compileComponents();
    const fixture = TestBed.createComponent(GridHost);
    fixture.detectChanges();
    const grid = fixture.debugElement.query(By.directive(GameTableGridLayoutComponent))
      .componentInstance as GameTableGridLayoutComponent;
    const initialBindings = fixture.componentInstance.summaryBindings();

    expect(grid.renderedSummaryBindings()).toBe(initialBindings);

    const nextBindings: GridPlayerSummaryBindings = {
      ...initialBindings,
      autoApplyCommanderDamageToLife: false,
    };
    fixture.componentInstance.summaryBindings.set(nextBindings);
    fixture.detectChanges();

    expect(grid.renderedSummaryBindings()).toBe(nextBindings);
  });

  it('keeps the prior summary PlayerView only for position-only updates when the experiment is enabled', async () => {
    await TestBed.configureTestingModule({ imports: [GridHost] }).compileComponents();

    for (const renderMemoEnabled of [false, true]) {
      const fixture = TestBed.createComponent(GridHost);
      const local = player('local', 0.2);
      const opponent = player('opponent', 0.4);
      fixture.componentInstance.renderMemoEnabled.set(renderMemoEnabled);
      fixture.componentInstance.seats.set(buildGridSeats([local, opponent], local));
      fixture.componentInstance.summaryBindings.update((bindings) => ({
        ...bindings,
        players: [local, opponent],
      }));
      fixture.detectChanges();

      const localBattlefield = gridBattlefieldFor(fixture, 'local');
      const movedLocal = withBattlefieldPosition(local, 0.6);
      fixture.componentInstance.seats.set(buildGridSeats([movedLocal, opponent], movedLocal));
      fixture.componentInstance.summaryBindings.update((bindings) => ({
        ...bindings,
        players: [movedLocal, opponent],
      }));
      fixture.detectChanges();

      expect(localBattlefield.playerSeat().player).toBe(movedLocal);
      expect(localBattlefield.summaryPlayer()).toBe(renderMemoEnabled ? local : movedLocal);
      fixture.destroy();
    }
  });

  it('shows the defeated overlay while keeping the player summary mounted', async () => {
    await TestBed.configureTestingModule({ imports: [GridHost] }).compileComponents();
    const fixture = TestBed.createComponent(GridHost);
    const players = [player('local'), player('opponent')];
    players[1].state.status = 'conceded';
    fixture.componentInstance.seats.set(buildGridSeats(players, players[0]));
    fixture.detectChanges();

    const defeatedPanel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="grid-player-panel"][data-player-id="opponent"]',
    );

    expect(defeatedPanel?.classList.contains('is-defeated')).toBe(true);
    expect(
      defeatedPanel?.querySelector('[data-testid="grid-player-battlefield-skull"]'),
    ).not.toBeNull();
    expect(defeatedPanel?.querySelector('[data-testid="player-summary-panel"]')).not.toBeNull();

    const defeatedBattlefield = fixture.debugElement
      .queryAll(By.directive(GridPlayerBattlefieldComponent))
      .map((debugElement) => debugElement.componentInstance as GridPlayerBattlefieldComponent)
      .find((component) => component.playerSeat().player.id === 'opponent');
    defeatedBattlefield?.summaryCompact.set(true);
    fixture.detectChanges();

    expect(defeatedPanel?.querySelector('.player-summary-panel-grid')).toBeNull();
  });
});

function gridBattlefieldFor(
  fixture: ComponentFixture<GridHost>,
  playerId: string,
): GridPlayerBattlefieldComponent {
  const component = fixture.debugElement
    .queryAll(By.directive(GridPlayerBattlefieldComponent))
    .map((debugElement) => debugElement.componentInstance as GridPlayerBattlefieldComponent)
    .find((candidate) => candidate.playerSeat().player.id === playerId);
  if (!component) {
    throw new Error(`Expected Grid battlefield for ${playerId}.`);
  }

  return component;
}

function player(id: string, positionX?: number): PlayerView {
  return {
    id,
    state: {
      user: { id, displayName: id, email: `${id}@example.test`, roles: [] },
      status: 'active',
      life: 40,
      commanderDamage: {},
      counters: {},
      zones: {
        library: [],
        hand: [],
        battlefield: positionX === undefined ? [] : [battlefieldCard(positionX)],
        command: [],
        exile: [],
        graveyard: [],
      },
    },
  };
}

function withBattlefieldPosition(source: PlayerView, x: number): PlayerView {
  return {
    ...source,
    state: {
      ...source.state,
      zones: {
        ...source.state.zones,
        battlefield: [{ ...source.state.zones.battlefield[0]!, position: { x, y: 0.3, unit: 'ratio' } }],
      },
    },
  };
}

function battlefieldCard(x: number): GameCardInstance {
  return {
    instanceId: 'battlefield-card',
    name: 'Battlefield card',
    tapped: false,
    zone: 'battlefield',
    position: { x, y: 0.3, unit: 'ratio' },
  };
}
