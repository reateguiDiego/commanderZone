import { TestBed } from '@angular/core/testing';
import {
  TableAssistantPlayer,
  TableAssistantPlayerArrangement,
} from '../models/table-assistant.models';
import { TableAssistantReplayModalComponent } from './table-assistant-replay-modal.component';

describe('TableAssistantReplayModalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TableAssistantReplayModalComponent],
    }).compileComponents();
  });

  it('confirms the selected table seats and turn order', () => {
    const fixture = createFixture();
    const emittedArrangements: TableAssistantPlayerArrangement[] = [];

    fixture.componentInstance.replayConfirmed.subscribe((arrangement) =>
      emittedArrangements.push(arrangement),
    );
    fixture.componentInstance.setSeatPlayer(0, 'player-3');
    fixture.componentInstance.setSeatPlayer(2, 'player-1');
    fixture.componentInstance.setTurnIndex('player-2', 0);
    fixture.componentInstance.setTurnIndex('player-1', 1);
    fixture.componentInstance.setTurnIndex('player-3', 2);
    fixture.componentInstance.confirmReplay();

    expect(emittedArrangements).toEqual([
      {
        seatOrder: ['player-3', 'player-2', 'player-1'],
        turnOrder: ['player-2', 'player-1', 'player-3'],
      },
    ]);
  });

  it('only changes table seats through player selects', () => {
    const fixture = createFixture();
    const firstSeat = fixture.nativeElement.querySelector('.seat-layout article') as HTMLElement;

    expect(firstSeat.getAttribute('draggable')).toBeNull();
    expect(firstSeat.getAttribute('tabindex')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Despues va');

    fixture.componentInstance.setSeatPlayer(0, 'player-3');
    fixture.detectChanges();
    expect(fixture.componentInstance.seatControls.getRawValue()).toEqual([
      'player-3',
      'player-2',
      null,
    ]);
    expect(fixture.nativeElement.textContent).toContain('Table setup');
  });

  it('shows blank turn as dash and disables turn numbers selected by other players', () => {
    const fixture = createFixture();

    fixture.componentInstance.setTurnIndex('player-1', 0);
    fixture.componentInstance.setTurnIndex('player-2', 1);
    fixture.componentInstance.setTurnIndex('player-3', 2);
    fixture.detectChanges();

    const playerTwoTurnOptionInPlayerOneSelect = fixture.componentInstance.turnIndexOptions('player-1').find(
      (option) => option.id === '1',
    );

    expect(playerTwoTurnOptionInPlayerOneSelect?.disabled).toBe(true);
    fixture.componentInstance.setTurnIndex('player-2', '');
    fixture.detectChanges();

    const playerTwoTurnOptions = fixture.componentInstance.turnIndexOptions('player-2');
    const blankOption = playerTwoTurnOptions.find((option) => option.id === '');
    const firstTurnOption = playerTwoTurnOptions.find((option) => option.name === '1');
    const releasedTurnOption = fixture.componentInstance.turnIndexOptions('player-1').find(
      (option) => option.id === '1',
    );

    expect(blankOption?.name).toBe('-');
    expect(firstTurnOption?.disabled).toBe(true);
    expect(releasedTurnOption?.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('app-format-select.turn-order-select')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Turn -');
    expect(fixture.nativeElement.textContent).not.toContain('Turn 2');
    expect(fixture.nativeElement.querySelectorAll('.turn-pill-slot')).toHaveLength(3);
    expect(fixture.nativeElement.querySelectorAll('.order-actions button')).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('.seat-field app-format-select')).toHaveLength(6);
  });

  it('does not confirm when the arrangement is incomplete', () => {
    const fixture = createFixture('initial');
    const emittedArrangements: TableAssistantPlayerArrangement[] = [];

    fixture.componentInstance.replayConfirmed.subscribe((arrangement) =>
      emittedArrangements.push(arrangement),
    );
    fixture.componentInstance.confirmReplay();

    expect(fixture.componentInstance.isArrangementComplete()).toBe(false);
    expect(emittedArrangements).toEqual([]);
  });

  it('does not close from backdrop clicks in initial mode', () => {
    const fixture = createFixture('initial');
    const cancelled = vi.fn();
    const closed = vi.fn();

    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.componentInstance.closed.subscribe(closed);
    fixture.nativeElement.querySelector('.modal-backdrop')?.click();

    expect(fixture.nativeElement.textContent).toContain('Table setup');
    expect(cancelled).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });

  it('closes initial mode only from the close button', () => {
    const fixture = createFixture('initial');
    const cancelled = vi.fn();

    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.nativeElement.querySelector('.icon-button')?.click();

    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('randomizes turn order only after every player is seated', () => {
    const fixture = createFixture('initial');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(
      fixture.nativeElement
        .querySelector('.secondary-action')
        ?.textContent.trim(),
    ).toBe('Random turn');
    expect(fixture.nativeElement.querySelector('.secondary-action')?.disabled).toBe(true);

    fixture.componentInstance.setSeatPlayer(0, 'player-1');
    fixture.componentInstance.setSeatPlayer(1, 'player-2');
    fixture.componentInstance.setSeatPlayer(2, 'player-3');
    fixture.detectChanges();

    expect(fixture.componentInstance.canRandomizeTurnOrder()).toBe(true);
    fixture.componentInstance.randomizeTurnOrder();
    fixture.detectChanges();

    expect(fixture.componentInstance.turnControls.getRawValue()).toEqual([2, 0, 1]);
    expect(fixture.componentInstance.isArrangementComplete()).toBe(true);
    randomSpy.mockRestore();
  });

  it.each([2, 3, 4, 5, 6])(
    'randomizes and writes every turn select for %i seated players',
    (playerCount) => {
      const fixture = createFixture('initial', playerCount);
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.42);
      const playerIds = players(playerCount).map((player) => player.id);

      playerIds.forEach((playerId, seatIndex) => {
        fixture.componentInstance.setSeatPlayer(seatIndex, playerId);
      });
      fixture.detectChanges();

      fixture.componentInstance.randomizeTurnOrder();
      fixture.detectChanges();

      const selectedTurnIndexes = fixture.componentInstance.turnControls.getRawValue();
      const expectedTurnIndexes = Array.from({ length: playerCount }, (_, index) => index);

      expect([...selectedTurnIndexes].sort((left, right) => Number(left) - Number(right))).toEqual(
        expectedTurnIndexes,
      );
      expect(playerIds.map((playerId) => fixture.componentInstance.turnIndexValue(playerId))).toEqual(
        selectedTurnIndexes.map((turnIndex) => String(turnIndex)),
      );
      expect(fixture.componentInstance.isArrangementComplete()).toBe(true);

      randomSpy.mockRestore();
    },
  );

  it.each([2, 3, 4, 5, 6])(
    'randomizes every existing turn select on first click for %i players',
    (playerCount) => {
      const fixture = createFixture('replay', playerCount);
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      const playerIds = players(playerCount).map((player) => player.id);

      playerIds.forEach((playerId, turnIndex) => {
        fixture.componentInstance.setTurnIndex(playerId, turnIndex);
      });
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.secondary-action')?.click();
      fixture.detectChanges();

      const selectedTurnIndexes = fixture.componentInstance.turnControls.getRawValue();
      const expectedTurnIndexes = Array.from({ length: playerCount }, (_, index) => index);

      expect([...selectedTurnIndexes].sort((left, right) => Number(left) - Number(right))).toEqual(
        expectedTurnIndexes,
      );
      expect(playerIds.map((playerId) => fixture.componentInstance.turnIndexValue(playerId))).toEqual(
        selectedTurnIndexes.map((turnIndex) => String(turnIndex)),
      );
      expect(fixture.componentInstance.isArrangementComplete()).toBe(true);

      randomSpy.mockRestore();
    },
  );

  it('keeps seats but clears turn order when starting a new table', () => {
    const fixture = createFixture('replay');

    expect(fixture.componentInstance.seatControls.getRawValue()).toEqual([
      'player-1',
      'player-2',
      'player-3',
    ]);
    expect(fixture.componentInstance.turnControls.getRawValue()).toEqual([null, null, null]);
    expect(fixture.nativeElement.textContent).not.toContain('Turn 1');
    expect(fixture.nativeElement.textContent).not.toContain('Turn 2');
    expect(fixture.nativeElement.textContent).not.toContain('Turn 3');
    expect(fixture.nativeElement.querySelector('.primary-action')?.disabled).toBe(true);
  });

  it('starts blank in initial mode and confirms only after every seat and turn is selected', () => {
    const fixture = createFixture('initial');
    const emittedArrangements: TableAssistantPlayerArrangement[] = [];

    fixture.componentInstance.replayConfirmed.subscribe((arrangement) =>
      emittedArrangements.push(arrangement),
    );

    expect(fixture.componentInstance.seatControls.getRawValue()).toEqual([null, null, null]);
    expect(fixture.componentInstance.turnControls.getRawValue()).toEqual([null, null, null]);
    expect(fixture.nativeElement.querySelector('.primary-action')?.disabled).toBe(true);

    fixture.componentInstance.setSeatPlayer(0, 'player-2');
    fixture.componentInstance.setSeatPlayer(1, 'player-1');
    fixture.componentInstance.setSeatPlayer(2, 'player-3');
    fixture.componentInstance.setTurnIndex('player-2', 0);
    fixture.componentInstance.setTurnIndex('player-3', 1);
    fixture.componentInstance.setTurnIndex('player-1', 2);
    fixture.detectChanges();

    expect(fixture.componentInstance.isArrangementComplete()).toBe(true);
    fixture.componentInstance.confirmReplay();
    expect(emittedArrangements).toEqual([
      {
        seatOrder: ['player-2', 'player-1', 'player-3'],
        turnOrder: ['player-2', 'player-3', 'player-1'],
      },
    ]);
  });
});

function createFixture(mode: 'initial' | 'replay' = 'replay', playerCount = 3) {
  const fixture = TestBed.createComponent(TableAssistantReplayModalComponent);
  fixture.componentRef.setInput('players', players(playerCount));
  fixture.componentRef.setInput('mode', mode);
  fixture.detectChanges();
  return fixture;
}

function players(count = 3): TableAssistantPlayer[] {
  return Array.from({ length: count }, (_, index) =>
    player(`player-${index + 1}`, `Jugador ${index + 1}`, index, index),
  );
}

function player(
  id: string,
  name: string,
  seatIndex: number,
  turnOrder: number,
): TableAssistantPlayer {
  return {
    id,
    name,
    color: 'blue',
    seatIndex,
    turnOrder,
    life: 40,
    startingLife: 40,
    eliminated: false,
    assignedParticipantId: null,
    assignedUserId: null,
    trackers: {},
  };
}
