import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameSnapshot } from '../../../../core/models/game.model';
import { PlayerView } from '../state/game-table-snapshot-selectors';
import { TurnPhasePanelComponent } from './turn-phase-panel.component';

describe('TurnPhasePanelComponent', () => {
  it('shows the next phase on the advance button for the active player', async () => {
    const fixture = await renderTurnPhasePanel({
      turn: { activePlayerId: 'player-1', phase: 'upkeep', number: 3 },
      currentPlayerId: 'player-1',
    });

    expect(fixture.nativeElement.querySelector('[data-testid="advance-phase"]')?.textContent).toContain('Draw');
    expect(fixture.nativeElement.querySelector('[data-testid="pass-turn"]')).not.toBeNull();
  });

  it('hides turn action buttons for non-active players', async () => {
    const fixture = await renderTurnPhasePanel({
      turn: { activePlayerId: 'player-2', phase: 'main-1', number: 3 },
      currentPlayerId: 'player-1',
    });

    expect(fixture.nativeElement.querySelector('[data-testid="advance-phase"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="pass-turn"]')).toBeNull();
  });
});

async function renderTurnPhasePanel(options: {
  turn: GameSnapshot['turn'];
  currentPlayerId: string | null;
}): Promise<ComponentFixture<TurnPhasePanelComponent>> {
  await TestBed.configureTestingModule({
    imports: [TurnPhasePanelComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(TurnPhasePanelComponent);
  fixture.componentRef.setInput('turn', options.turn);
  fixture.componentRef.setInput('players', [player('player-1'), player('player-2')]);
  fixture.componentRef.setInput('phases', ['untap', 'upkeep', 'draw', 'main-1', 'combat', 'main-2', 'end']);
  fixture.componentRef.setInput('currentPlayerId', options.currentPlayerId);
  fixture.componentRef.setInput('isPhasePast', () => false);
  fixture.componentRef.setInput('pending', false);
  fixture.componentRef.setInput('canAdvance', options.turn.activePlayerId === options.currentPlayerId);
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

function player(id: string): PlayerView {
  return {
    id,
    state: {
      user: { id, displayName: id },
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
    },
  } as unknown as PlayerView;
}
