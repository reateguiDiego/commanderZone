import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { GameSnapshot } from '../../../core/models/game.model';
import { MercureService } from '../../../core/realtime/mercure.service';
import { GameTableComponent } from './game-table.component';

describe('GameTableComponent', () => {
  const gamesApi = {
    snapshot: vi.fn(),
    command: vi.fn(),
  };
  const authStore = {
    user: vi.fn(),
  };
  const routeParams: Record<string, string> = {};

  beforeEach(async () => {
    routeParams['id'] = '';
    gamesApi.snapshot.mockReset();
    gamesApi.command.mockReset();
    authStore.user.mockReset().mockReturnValue(null);

    await TestBed.configureTestingModule({
      imports: [GameTableComponent],
      providers: [
        { provide: GamesApi, useValue: gamesApi },
        { provide: AuthStore, useValue: authStore },
        { provide: MercureService, useValue: { gameEvents: vi.fn().mockReturnValue(EMPTY) } },
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: (key: string) => convertToParamMap(routeParams).get(key) } } },
        },
      ],
    }).compileComponents();
  });

  it('shows a missing game id error without a route id', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.store.error()).toBe('Missing game id.');
  });

  it('concedes through a dedicated game command even if another action is pending', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    const activeSnapshot = snapshotWithStatus('active');
    const concededSnapshot = snapshotWithStatus('conceded');
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: activeSnapshot } }));
    gamesApi.command.mockReturnValue(of({ event: { id: 'event-1', type: 'game.concede', payload: {}, createdBy: 'user-1', createdAt: '' }, snapshot: concededSnapshot }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.store.pending.set(true);
    await fixture.componentInstance.store.concedeGame();

    expect(gamesApi.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'game.concede', payload: {} }), 'game-1');
    expect(fixture.componentInstance.store.snapshot()?.players['user-1'].status).toBe('conceded');
  });

  it('keeps a clicked battlefield card as the active shortcut card', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = fixture.componentInstance.store.snapshot()?.players['user-1'].zones.battlefield[0];
    expect(card).toBeTruthy();
    fixture.componentInstance.store.selectedCards.set([{ playerId: 'user-1', zone: 'battlefield', card: card! }]);
    const event = {
      stopPropagation: vi.fn(),
      currentTarget: document.createElement('button'),
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent;
    fixture.componentInstance.store.handleBattlefieldCardClick(event, 'user-1', card!);

    expect(fixture.componentInstance.store.activeKeyboardCard()?.card.instanceId).toBe('card-1');
  });

  it('does not open the library on left click', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const openZone = vi.spyOn(fixture.componentInstance.store, 'openZone');

    const libraryButton = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.zone-stack'))
      .find((element) => element.textContent?.includes('Library'));
    libraryButton?.click();

    expect(openZone).not.toHaveBeenCalledWith('user-1', 'library');
  });

  it('can drag the top card from a visual zone stack', async () => {
    routeParams['id'] = 'game-1';
    authStore.user.mockReturnValue({ id: 'user-1', email: 'user@test', displayName: 'User', roles: [] });
    gamesApi.snapshot.mockReturnValue(of({ game: { id: 'game-1', status: 'active', snapshot: snapshotWithStatus('active') } }));

    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const player = fixture.componentInstance.store.players()[0];
    const setData = vi.fn();
    const event = {
      dataTransfer: { setData, effectAllowed: '' },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    fixture.componentInstance.store.dragTopZoneCard(event, player, 'library');

    expect(setData).toHaveBeenCalledWith('application/json', JSON.stringify({
      playerId: 'user-1',
      zone: 'library',
      instanceId: 'library-card',
    }));
    expect(fixture.componentInstance.store.selectedCards()[0]?.card.instanceId).toBe('library-card');
  });
});

function snapshotWithStatus(status: 'active' | 'conceded'): GameSnapshot {
  return {
    version: status === 'active' ? 1 : 2,
    ownerId: 'user-1',
    players: {
      'user-1': {
        user: { id: 'user-1', email: 'user@test', displayName: 'User', roles: [] },
        status,
        concededAt: status === 'conceded' ? '2026-04-30T20:00:00+00:00' : null,
        colorIdentity: ['W'],
        life: 40,
        zones: {
          library: [{
            instanceId: 'library-card',
            ownerId: 'user-1',
            controllerId: 'user-1',
            name: 'Plains',
            typeLine: 'Basic Land — Plains',
            tapped: false,
            counters: {},
          }],
          hand: [],
          battlefield: [{
            instanceId: 'card-1',
            ownerId: 'user-1',
            controllerId: 'user-1',
            name: 'Sol Ring',
            typeLine: 'Artifact',
            tapped: false,
            counters: {},
          }],
          graveyard: [],
          exile: [],
          command: [],
        },
        zoneCounts: {
          library: 1,
          hand: 0,
          battlefield: 1,
          graveyard: 0,
          exile: 0,
          command: 0,
        },
        commanderDamage: {},
        counters: {},
      },
    },
    turn: { activePlayerId: 'user-1', phase: 'main-1', number: 1 },
    stack: [],
    arrows: [],
    chat: [],
    eventLog: [],
    createdAt: '2026-04-30T20:00:00+00:00',
    updatedAt: '2026-04-30T20:00:00+00:00',
  };
}
