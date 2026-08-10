import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlayerView } from '../../../game-table.store';
import { PlayersOrderComponent } from './players-order.component';

describe('PlayersOrderComponent', () => {
  it('orders players from the active turn and marks active/current cards', async () => {
    const fixture = await renderPlayersOrder({
      activePlayerId: 'player-2',
      currentPlayerId: 'player-1',
    });

    const cards = orderCards(fixture);
    expect(cards[0]?.dataset['playerId']).toBe('player-2');
    expect(cards[1]?.dataset['playerId']).toBe('player-3');
    expect(cards[2]?.dataset['playerId']).toBe('player-1');
    expect(cards[0]?.textContent).toContain('Turn 7');
    expect(cards[1]?.textContent).toContain('In 1');
    expect(cards[2]?.textContent).toContain('In 2');
    expect(cards[0]?.classList).toContain('active');
    expect(cards[2]?.classList).toContain('current-player');
  });

  it('keeps six players in turn order and hides only conceded players', async () => {
    const fixture = await renderPlayersOrder({
      activePlayerId: 'player-4',
      currentPlayerId: 'player-2',
      players: [
        player('player-1', 'Player One'),
        player('player-2', 'Player Two'),
        player('player-3', 'Player Three'),
        player('player-4', 'Player Four'),
        player('player-5', 'Player Five'),
        player('player-6', 'Player Six'),
      ],
    });

    const cards = orderCards(fixture);
    expect(cards).toHaveLength(6);
    expect(cards.map((card) => card.dataset['playerId'])).toEqual([
      'player-4',
      'player-5',
      'player-6',
      'player-1',
      'player-2',
      'player-3',
    ]);

    fixture.componentRef.setInput('activePlayerId', 'player-1');
    fixture.componentRef.setInput('currentPlayerId', 'player-1');
    fixture.componentRef.setInput('players', [
      player('player-1', 'Alive'),
      player('player-2', 'Zero life but active', { life: 0 }),
      player('player-3', 'Conceded', { status: 'conceded' }),
    ]);
    fixture.detectChanges();

    const visibleCards = orderCards(fixture);
    expect(visibleCards.map((card) => card.dataset['playerId'])).toEqual(['player-1', 'player-2']);
  });
});

async function renderPlayersOrder(options: {
  activePlayerId: string | null;
  currentPlayerId: string | null;
  players?: PlayerView[];
}): Promise<ComponentFixture<PlayersOrderComponent>> {
  await TestBed.configureTestingModule({
    imports: [PlayersOrderComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(PlayersOrderComponent);
  fixture.componentRef.setInput('players', options.players ?? [
    player('player-1', 'Finetti'),
    player('player-2', 'Zurgito'),
    player('player-3', 'Kaalia'),
  ]);
  fixture.componentRef.setInput('activePlayerId', options.activePlayerId);
  fixture.componentRef.setInput('currentPlayerId', options.currentPlayerId);
  fixture.componentRef.setInput('turnNumber', 7);
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

function orderCards(fixture: ComponentFixture<PlayersOrderComponent>): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('[data-testid="player-order-card"]'));
}

function player(id: string, displayName: string, overrides: Partial<PlayerView['state']> = {}): PlayerView {
  return {
    id,
    state: {
      user: { id, displayName },
      life: 40,
      commanderDamage: {},
      counters: {},
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
      ...overrides,
    },
  } as unknown as PlayerView;
}
