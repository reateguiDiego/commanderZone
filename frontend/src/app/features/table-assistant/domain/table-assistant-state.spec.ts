import {
  COMMANDER_STARTING_LIFE,
  TABLE_ASSISTANT_PHASES,
  activeTrackerDefinitions,
  applyTableAssistantAction,
  assignParticipantToPlayer,
  availableTimerModes,
  canEditPlayer,
  createInitialTableAssistantRoom,
  isCommanderDamageLethal,
} from './table-assistant-state';
import { TableAssistantParticipant } from '../models/table-assistant.models';

describe('table assistant domain state', () => {
  it('creates a Commander room with 40 life defaults', () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device', createdAt: '2026-04-29T00:00:00.000Z' });

    expect(state.players).toHaveLength(4);
    expect(state.players.every((player) => player.life === COMMANDER_STARTING_LIFE)).toBe(true);
    expect(state.settings.commanderDamageEnabled).toBe(true);
    expect(state.turn.activePlayerId).toBe('player-1');
    expect(state.version).toBe(1);
  });

  it('creates single-device mode with everyone editing', () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device' });

    expect(state.mode).toBe('single-device');
    expect(state.settings.permissionPolicy.mode).toBe('everyone');
    expect(canEditPlayer(state, state.hostParticipantId, 'player-3')).toBe(true);
  });

  it('creates per-player-device mode with host assigned to the first player', () => {
    const state = createInitialTableAssistantRoom({
      mode: 'per-player-device',
      hostUser: { id: 'user-1', email: 'host@example.test', displayName: 'Host' },
    });

    expect(state.mode).toBe('per-player-device');
    expect(state.settings.permissionPolicy.mode).toBe('host-and-owner');
    expect(state.participants[0].assignedPlayerId).toBe('player-1');
    expect(state.players[0].assignedUserId).toBe('user-1');
  });

  it('keeps configured player names and colors', () => {
    const state = createInitialTableAssistantRoom({
      mode: 'single-device',
      players: [
        { name: 'Jugador Grixis', color: 'grixis' },
        { name: 'Jugador Verde', color: 'green' },
      ],
    });

    expect(state.players[0].name).toBe('Jugador Grixis');
    expect(state.players[0].color).toBe('grixis');
    expect(state.players[1].color).toBe('green');
  });

  it('changes life', () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device' });
    const next = applyTableAssistantAction(state, { type: 'life.changed', playerId: 'player-1', delta: -5, clientActionId: 'a1' });

    expect(next.players[0].life).toBe(35);
    expect(next.version).toBe(2);
    expect(next.actionLog[0].id).toBe('a1');
  });

  it('marks players eliminated from life total and restores them above zero', () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device' });
    const eliminated = applyTableAssistantAction(state, { type: 'life.changed', playerId: 'player-1', delta: -40 });
    const restored = applyTableAssistantAction(eliminated, { type: 'life.changed', playerId: 'player-1', delta: 1 });

    expect(eliminated.players[0].eliminated).toBe(true);
    expect(restored.players[0].eliminated).toBe(false);
  });

  it('registers commander damage and detects lethal damage at 21', () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device' });
    const next = applyTableAssistantAction(state, {
      type: 'commander-damage.changed',
      targetPlayerId: 'player-2',
      sourcePlayerId: 'player-1',
      delta: 21,
    });

    expect(next.commanderDamage['player-2']['player-1']).toBe(21);
    expect(isCommanderDamageLethal(next, 'player-2', 'player-1')).toBe(true);
  });

  it('passes turn respecting turn order', () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device' });
    const next = applyTableAssistantAction(state, { type: 'turn.passed' });

    expect(next.turn.activePlayerId).toBe('player-2');
    expect(next.turn.number).toBe(2);
  });

  it('skips eliminated players when setting is enabled', () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device', skipEliminatedPlayers: true });
    const eliminated = applyTableAssistantAction(state, {
      type: 'player.elimination.changed',
      playerId: 'player-2',
      eliminated: true,
    });
    const next = applyTableAssistantAction(eliminated, { type: 'turn.passed' });

    expect(next.turn.activePlayerId).toBe('player-3');
  });

  it('passes phases and rolls last phase into the next turn', () => {
    let state = createInitialTableAssistantRoom({ mode: 'single-device', phasesEnabled: true });
    expect(state.turn.phaseId).toBe(TABLE_ASSISTANT_PHASES[0]);

    state = applyTableAssistantAction(state, { type: 'phase.passed' });
    expect(state.turn.phaseId).toBe('upkeep');

    for (let index = 1; index < TABLE_ASSISTANT_PHASES.length; index++) {
      state = applyTableAssistantAction(state, { type: 'phase.passed' });
    }

    expect(state.turn.activePlayerId).toBe('player-2');
    expect(state.turn.phaseId).toBe('untap');
  });

  it('resets timer on turn and phase boundaries', () => {
    let state = createInitialTableAssistantRoom({
      mode: 'single-device',
      phasesEnabled: true,
      timerMode: 'phase',
      timerDurationSeconds: 90,
    });

    state = applyTableAssistantAction(state, { type: 'timer.started', durationSeconds: 90 });
    expect(state.timer.status).toBe('running');

    state = applyTableAssistantAction(state, { type: 'phase.passed' });
    expect(state.turn.phaseId).toBe('upkeep');
    expect(state.timer.status).toBe('idle');
    expect(state.timer.remainingSeconds).toBe(90);
  });

  it('supports timer pause, resume and reset', () => {
    let state = createInitialTableAssistantRoom({ mode: 'single-device', timerMode: 'turn', timerDurationSeconds: 120 });

    state = applyTableAssistantAction(state, { type: 'timer.started', durationSeconds: 120 });
    state = applyTableAssistantAction(state, { type: 'timer.paused', remainingSeconds: 80 });
    expect(state.timer.status).toBe('paused');
    expect(state.timer.remainingSeconds).toBe(80);

    state = applyTableAssistantAction(state, { type: 'timer.resumed', remainingSeconds: 80 });
    expect(state.timer.status).toBe('running');

    state = applyTableAssistantAction(state, { type: 'timer.reset' });
    expect(state.timer.status).toBe('idle');
    expect(state.timer.remainingSeconds).toBe(120);
  });

  it('does not pass phase when phases are disabled', () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device' });
    const next = applyTableAssistantAction(state, { type: 'phase.passed' });

    expect(next).toBe(state);
  });

  it('only exposes phase timer when phases are enabled', () => {
    expect(availableTimerModes(false)).toEqual(['none', 'turn']);
    expect(availableTimerModes(true)).toEqual(['none', 'turn', 'phase']);

    const state = createInitialTableAssistantRoom({ mode: 'single-device', timerMode: 'phase' });
    expect(state.settings.timerMode).toBe('none');
  });

  it('shows active trackers and ignores inactive tracker changes', () => {
    const state = createInitialTableAssistantRoom({ mode: 'single-device', activeTrackerIds: ['commander-damage', 'poison'] });

    expect(activeTrackerDefinitions(state.settings.activeTrackerIds).map((tracker) => tracker.id)).toEqual(['commander-damage', 'poison']);
    expect(state.players[0].trackers.poison).toBe(0);

    const ignored = applyTableAssistantAction(state, {
      type: 'tracker.changed',
      trackerId: 'energy',
      playerId: 'player-1',
      value: 4,
    });
    expect(ignored).toBe(state);

    const next = applyTableAssistantAction(state, {
      type: 'tracker.changed',
      trackerId: 'poison',
      playerId: 'player-1',
      value: 3,
    });
    expect(next.players[0].trackers.poison).toBe(3);
  });

  it('assigns a participant to a player', () => {
    const state = createInitialTableAssistantRoom({ mode: 'per-player-device' });
    const participant: TableAssistantParticipant = {
      id: 'participant-2',
      role: 'player',
      user: { id: 'user-2', displayName: 'Guest', presence: 'online' },
      deviceId: 'device-2',
      assignedPlayerId: null,
      connected: true,
      joinedAt: '2026-04-29T00:00:00.000Z',
    };
    const withParticipant = { ...state, participants: [...state.participants, participant] };
    const next = assignParticipantToPlayer(withParticipant, 'participant-2', 'player-2');

    expect(next.participants.find((entry) => entry.id === 'participant-2')?.assignedPlayerId).toBe('player-2');
    expect(next.players.find((player) => player.id === 'player-2')?.assignedParticipantId).toBe('participant-2');
    expect(next.players.find((player) => player.id === 'player-2')?.assignedUserId).toBe('user-2');
  });
});
