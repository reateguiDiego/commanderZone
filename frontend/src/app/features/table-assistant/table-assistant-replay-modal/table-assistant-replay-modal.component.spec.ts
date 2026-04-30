import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChevronDown, LucideAngularModule } from 'lucide-angular';
import {
  TableAssistantPlayer,
  TableAssistantPlayerArrangement,
} from '../models/table-assistant.models';
import { TableAssistantReplayModalComponent } from './table-assistant-replay-modal.component';

describe('TableAssistantReplayModalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TableAssistantReplayModalComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ ChevronDown }))],
    }).compileComponents();
  });

  it('confirms the selected table seats and turn order', () => {
    const fixture = createFixture();
    const emittedArrangements: TableAssistantPlayerArrangement[] = [];

    fixture.componentInstance.replayConfirmed.subscribe((arrangement) =>
      emittedArrangements.push(arrangement),
    );
    fixture.componentInstance.selectSeatCell(0);
    fixture.componentInstance.selectSeatCell(2);
    fixture.componentInstance.setTurnIndex('player-1', 1);
    fixture.componentInstance.confirmReplay();

    expect(emittedArrangements).toEqual([
      {
        seatOrder: ['player-3', 'player-2', 'player-1'],
        turnOrder: ['player-2', 'player-1', 'player-3'],
      },
    ]);
  });

  it('swaps table seats with drag and drop', () => {
    const fixture = createFixture();

    fixture.componentInstance.startSeatDrag(dragEvent('0'), 0);
    fixture.componentInstance.dropOnSeat(dragEvent('0'), 2);
    fixture.detectChanges();

    expect(fixture.componentInstance.seatControls.getRawValue()).toEqual([
      'player-3',
      'player-2',
      'player-1',
    ]);
    expect(fixture.nativeElement.textContent).toContain('Mesa y orden de jugadores');
  });

  it('moves players up and down with arrow controls', () => {
    const fixture = createFixture();

    fixture.componentInstance.moveTurnPlayer('player-2', -1);
    fixture.detectChanges();

    expect(fixture.componentInstance.turnControls.getRawValue()).toEqual([1, 0, 2]);
    expect(fixture.nativeElement.querySelectorAll('.seat-field select')).toHaveLength(6);
    expect(fixture.nativeElement.textContent).toContain('Nueva partida');
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

  it('starts blank in initial mode and confirms only after every seat and turn is selected', () => {
    const fixture = createFixture('initial');
    const emittedArrangements: TableAssistantPlayerArrangement[] = [];

    fixture.componentInstance.replayConfirmed.subscribe((arrangement) =>
      emittedArrangements.push(arrangement),
    );

    expect(fixture.componentInstance.seatControls.getRawValue()).toEqual([null, null, null]);
    expect(fixture.componentInstance.turnControls.getRawValue()).toEqual([null, null, null]);
    expect(fixture.nativeElement.querySelector('.primary-action')?.disabled).toBe(true);

    fixture.componentInstance.seatControl(0).setValue('player-2');
    fixture.componentInstance.seatPlayerChanged(0);
    fixture.componentInstance.seatControl(1).setValue('player-1');
    fixture.componentInstance.seatPlayerChanged(1);
    fixture.componentInstance.seatControl(2).setValue('player-3');
    fixture.componentInstance.seatPlayerChanged(2);
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

function createFixture(mode: 'initial' | 'replay' = 'replay') {
  const fixture = TestBed.createComponent(TableAssistantReplayModalComponent);
  fixture.componentRef.setInput('players', players());
  fixture.componentRef.setInput('mode', mode);
  fixture.detectChanges();
  return fixture;
}

function dragEvent(playerId: string): DragEvent {
  const dataTransfer = {
    dropEffect: 'move',
    effectAllowed: 'move',
    getData: vi.fn().mockReturnValue(playerId),
    setData: vi.fn(),
  } satisfies Partial<DataTransfer>;

  return {
    dataTransfer,
    preventDefault: vi.fn(),
  } as unknown as DragEvent;
}

function players(): TableAssistantPlayer[] {
  return [
    player('player-1', 'Jugador 1', 0, 0),
    player('player-2', 'Jugador 2', 1, 1),
    player('player-3', 'Jugador 3', 2, 2),
  ];
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
