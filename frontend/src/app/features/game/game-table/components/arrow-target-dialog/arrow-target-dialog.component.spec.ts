import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlayerView } from '../../game-table.store';
import { ArrowTargetDialogComponent } from './arrow-target-dialog.component';

describe('ArrowTargetDialogComponent', () => {
  it('renders all players and starts with multiple targets unchecked', async () => {
    const fixture = await renderDialog();

    const options = Array.from(fixture.nativeElement.querySelectorAll('option')) as HTMLOptionElement[];
    const checkbox = fixture.nativeElement.querySelector('[data-testid="arrow-target-multiple-checkbox"]') as HTMLInputElement;

    expect(options.map((option) => option.textContent?.trim())).toEqual(['Alice', 'Bob']);
    expect(checkbox.checked).toBe(false);
  });

  it('emits the selected player with single-target mode on confirm', async () => {
    const fixture = await renderDialog('player-2');
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);

    (fixture.nativeElement.querySelector('[data-testid="arrow-target-confirm"]') as HTMLButtonElement).click();

    expect(confirmed).toHaveBeenCalledWith({ playerId: 'player-2', multipleTargets: false, targetCount: 1 });
  });

  it('emits value changes while selecting a player', async () => {
    const fixture = await renderDialog();
    const changed = vi.fn();
    fixture.componentInstance.valueChanged.subscribe(changed);

    const select = fixture.nativeElement.querySelector('[data-testid="arrow-target-player-select"]') as HTMLSelectElement;
    select.value = 'player-2';
    select.dispatchEvent(new Event('input'));

    expect(changed).toHaveBeenCalledWith({ playerId: 'player-2', multipleTargets: false, targetCount: 1 });
  });

  it('enables multiple targets and emits the selected target count', async () => {
    const fixture = await renderDialog();
    const changed = vi.fn();
    const confirmed = vi.fn();
    fixture.componentInstance.valueChanged.subscribe(changed);
    fixture.componentInstance.confirmed.subscribe(confirmed);

    const checkbox = fixture.nativeElement.querySelector('[data-testid="arrow-target-multiple-checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    expect(changed).toHaveBeenCalledWith({ playerId: 'player-1', multipleTargets: true, targetCount: 2 });

    fixture.componentRef.setInput('multipleTargets', true);
    fixture.componentRef.setInput('targetCount', 2);
    fixture.detectChanges();

    const countInput = fixture.nativeElement.querySelector('[data-testid="arrow-target-count-input"]') as HTMLInputElement;
    countInput.value = '4';
    countInput.dispatchEvent(new Event('input'));

    expect(changed).toHaveBeenLastCalledWith({ playerId: 'player-1', multipleTargets: true, targetCount: 4 });

    fixture.componentRef.setInput('targetCount', 4);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="arrow-target-confirm"]') as HTMLButtonElement).click();

    expect(confirmed).toHaveBeenCalledWith({ playerId: 'player-1', multipleTargets: true, targetCount: 4 });
  });

  it('emits cancellation', async () => {
    const fixture = await renderDialog();
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);

    (fixture.nativeElement.querySelector('[data-testid="arrow-target-cancel"]') as HTMLButtonElement).click();

    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('filters defeated players and falls back to the first alive player', async () => {
    const fixture = await renderDialog('player-2', [
      { id: 'player-1', state: playerState('player-1', 'Alice') },
      { id: 'player-2', state: { ...playerState('player-2', 'Bob'), life: 0 } },
      { id: 'player-3', state: playerState('player-3', 'Cara') },
    ]);
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);

    const options = Array.from(fixture.nativeElement.querySelectorAll('option')) as HTMLOptionElement[];
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Alice', 'Cara']);

    (fixture.nativeElement.querySelector('[data-testid="arrow-target-confirm"]') as HTMLButtonElement).click();

    expect(confirmed).toHaveBeenCalledWith({ playerId: 'player-1', multipleTargets: false, targetCount: 1 });
  });
});

async function renderDialog(
  selectedPlayerId = 'player-1',
  dialogPlayers: PlayerView[] = players(),
): Promise<ComponentFixture<ArrowTargetDialogComponent>> {
  await TestBed.configureTestingModule({
    imports: [ArrowTargetDialogComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(ArrowTargetDialogComponent);
  fixture.componentRef.setInput('players', dialogPlayers);
  fixture.componentRef.setInput('selectedPlayerId', selectedPlayerId);
  fixture.componentRef.setInput('multipleTargets', false);
  fixture.componentRef.setInput('targetCount', 1);
  fixture.componentRef.setInput('playerLabel', (player: PlayerView) => player.state.user.displayName);
  fixture.detectChanges();

  return fixture;
}

function players(): PlayerView[] {
  return [
    { id: 'player-1', state: playerState('player-1', 'Alice') },
    { id: 'player-2', state: playerState('player-2', 'Bob') },
  ];
}

function playerState(id: string, displayName: string): PlayerView['state'] {
  return {
    user: { id, email: `${id}@test`, displayName, roles: [] },
    status: 'active',
    life: 40,
    zones: {
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
    },
    commanderDamage: {},
    counters: {},
  };
}
