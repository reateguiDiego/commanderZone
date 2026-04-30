import {
  CreateTableAssistantRoomOptions,
  TableAssistantAction,
  TableAssistantActionLogEntry,
  TableAssistantGlobalTrackerId,
  TableAssistantParticipant,
  TableAssistantPermissionPolicy,
  TableAssistantPhaseId,
  TableAssistantPlayer,
  TableAssistantPlayerTrackerId,
  TableAssistantRoomState,
  TableAssistantSettings,
  TableAssistantTimerMode,
  TableAssistantTrackerDefinition,
  TableAssistantTrackerId,
  TableAssistantUseMode,
} from '../models/table-assistant.models';
import { TABLE_ASSISTANT_COLOR_OPTIONS } from './table-assistant-colors';

export const COMMANDER_STARTING_LIFE = 40;
export const COMMANDER_DAMAGE_LETHAL_AMOUNT = 21;
export const DEFAULT_PLAYER_COUNT = 4;

export const TABLE_ASSISTANT_PHASES: readonly TableAssistantPhaseId[] = [
  'untap',
  'upkeep',
  'draw',
  'main-1',
  'combat',
  'main-2',
  'end',
] as const;

export const TABLE_ASSISTANT_TRACKERS: readonly TableAssistantTrackerDefinition[] = [
  { id: 'commander-damage', label: 'Commander damage', scope: 'special', defaultEnabled: true },
  { id: 'poison', label: 'Poison', scope: 'player', defaultEnabled: false },
  { id: 'commander-tax', label: 'Commander tax', scope: 'player', defaultEnabled: false },
  { id: 'energy', label: 'Energy', scope: 'player', defaultEnabled: false },
  { id: 'experience', label: 'Experience', scope: 'player', defaultEnabled: false },
  { id: 'monarch', label: 'Monarch', scope: 'global', defaultEnabled: false },
  { id: 'initiative', label: 'Initiative', scope: 'global', defaultEnabled: false },
  { id: 'storm', label: 'Storm', scope: 'global', defaultEnabled: false },
] as const;

const PLAYER_COLORS = TABLE_ASSISTANT_COLOR_OPTIONS.map((option) => option.id);
const PLAYER_TRACKER_IDS: readonly TableAssistantPlayerTrackerId[] = ['poison', 'commander-tax', 'energy', 'experience'];
const GLOBAL_TRACKER_IDS: readonly TableAssistantGlobalTrackerId[] = ['monarch', 'initiative', 'storm'];

export function createInitialTableAssistantRoom(options: CreateTableAssistantRoomOptions): TableAssistantRoomState {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const settings = createDefaultSettings(options.mode, options);
  const timerDurationSeconds = normalizeNullablePositiveInteger(options.timerDurationSeconds, null);
  const hostParticipantId = 'participant-host';
  const players = createPlayers(
    options.playerCount ?? DEFAULT_PLAYER_COUNT,
    settings.initialLife,
    settings.activeTrackerIds,
    options.players ?? [],
  );
  const participants: TableAssistantParticipant[] = [
    {
      id: hostParticipantId,
      role: 'host',
      user: options.hostUser ?? null,
      deviceId: options.hostDeviceId ?? null,
      assignedPlayerId: options.mode === 'per-player-device' ? players[0]?.id ?? null : null,
      connected: true,
      joinedAt: createdAt,
    },
  ];

  const assignedPlayers = options.mode === 'per-player-device' && players[0]
    ? [{ ...players[0], assignedParticipantId: hostParticipantId, assignedUserId: options.hostUser?.id ?? null }, ...players.slice(1)]
    : players;

  return {
    id: options.roomId ?? 'local-table-assistant-room',
    status: 'setup',
    mode: options.mode,
    hostParticipantId,
    players: assignedPlayers,
    participants,
    invitations: [],
    settings,
    turn: {
      activePlayerId: assignedPlayers[0]?.id ?? null,
      number: 1,
      phaseId: settings.phasesEnabled ? TABLE_ASSISTANT_PHASES[0] : null,
    },
    timer: {
      mode: settings.timerMode,
      status: 'idle',
      durationSeconds: settings.timerMode === 'none' ? null : timerDurationSeconds,
      remainingSeconds: settings.timerMode === 'none' ? null : timerDurationSeconds,
      startedAt: null,
    },
    sharing: {
      code: options.roomCode ?? 'LOCAL',
      inviteUrl: options.inviteUrl ?? null,
    },
    globalTrackers: createGlobalTrackers(settings.activeTrackerIds),
    commanderDamage: createCommanderDamage(assignedPlayers),
    actionLog: [],
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createDefaultSettings(
  mode: TableAssistantUseMode,
  options: Pick<CreateTableAssistantRoomOptions, 'initialLife' | 'phasesEnabled' | 'timerMode' | 'skipEliminatedPlayers' | 'activeTrackerIds'> = {},
): TableAssistantSettings {
  const phasesEnabled = options.phasesEnabled ?? false;
  const timerMode = normalizeTimerMode(options.timerMode ?? 'none', phasesEnabled);
  const permissionPolicy = defaultPermissionPolicy(mode);

  return {
    initialLife: normalizePositiveInteger(options.initialLife, COMMANDER_STARTING_LIFE),
    commanderDamageEnabled: true,
    turnTrackingEnabled: true,
    phasesEnabled,
    timerMode,
    skipEliminatedPlayers: options.skipEliminatedPlayers ?? false,
    permissionPolicy,
    activeTrackerIds: options.activeTrackerIds ?? defaultActiveTrackerIds(),
  };
}

export function availableTimerModes(phasesEnabled: boolean): TableAssistantTimerMode[] {
  return phasesEnabled ? ['none', 'turn', 'phase'] : ['none', 'turn'];
}

export function normalizeTimerMode(mode: TableAssistantTimerMode, phasesEnabled: boolean): TableAssistantTimerMode {
  return availableTimerModes(phasesEnabled).includes(mode) ? mode : 'none';
}

export function activeTrackerDefinitions(activeTrackerIds: readonly TableAssistantTrackerId[]): TableAssistantTrackerDefinition[] {
  const active = new Set(activeTrackerIds);

  return TABLE_ASSISTANT_TRACKERS.filter((tracker) => active.has(tracker.id));
}

export function phaseLabel(phaseId: TableAssistantPhaseId): string {
  const labels: Record<TableAssistantPhaseId, string> = {
    untap: 'Untap',
    upkeep: 'Upkeep',
    draw: 'Draw',
    'main-1': 'Main 1',
    combat: 'Combat',
    'main-2': 'Main 2',
    end: 'End',
  };

  return labels[phaseId];
}

export function canEditPlayer(state: TableAssistantRoomState, participantId: string, playerId: string): boolean {
  const participant = state.participants.find((candidate) => candidate.id === participantId);
  if (!participant || participant.role === 'viewer') {
    return false;
  }

  if (state.settings.permissionPolicy.mode === 'everyone' || participant.role === 'host') {
    return true;
  }

  return participant.assignedPlayerId === playerId && state.settings.permissionPolicy.playerCanEditOwnPanel;
}

export function applyTableAssistantAction(state: TableAssistantRoomState, action: TableAssistantAction): TableAssistantRoomState {
  switch (action.type) {
    case 'life.changed':
      return updatePlayer(state, action.playerId, (player) => withEliminationFromLife({ ...player, life: player.life + action.delta }), action);
    case 'life.set':
      return updatePlayer(state, action.playerId, (player) => withEliminationFromLife({ ...player, life: action.life }), action);
    case 'commander-damage.changed':
      return applyCommanderDamageChange(state, action);
    case 'turn.passed':
      return passTurn(state, action);
    case 'turn.reverted':
      return revertTurn(state, action);
    case 'phase.passed':
      return passPhase(state, action);
    case 'timer.started':
      return startTimer(state, action);
    case 'timer.paused':
      return pauseTimer(state, action);
    case 'timer.resumed':
      return resumeTimer(state, action);
    case 'timer.reset':
      return resetTimer(state, action);
    case 'game.reset':
      return resetGame(state, action);
    case 'player.elimination.changed':
      return updatePlayer(state, action.playerId, (player) => ({ ...player, eliminated: action.eliminated }), action);
    case 'tracker.changed':
      return applyTrackerChange(state, action);
    case 'participant.assigned':
      return assignParticipantToPlayer(state, action.participantId, action.playerId, action);
  }
}

function revertTurn(
  state: TableAssistantRoomState,
  action: Extract<TableAssistantAction, { type: 'turn.reverted' }>,
): TableAssistantRoomState {
  if (!state.players.some((player) => player.id === action.activePlayerId)) {
    return state;
  }

  return commit(
    {
      ...state,
      turn: {
        activePlayerId: action.activePlayerId,
        number: Math.max(1, action.number),
        phaseId: state.settings.phasesEnabled ? TABLE_ASSISTANT_PHASES[0] : null,
      },
    },
    action,
  );
}

export function isCommanderDamageLethal(state: TableAssistantRoomState, targetPlayerId: string, sourcePlayerId: string): boolean {
  return (state.commanderDamage[targetPlayerId]?.[sourcePlayerId] ?? 0) >= COMMANDER_DAMAGE_LETHAL_AMOUNT;
}

export function isPlayerEliminated(player: Pick<TableAssistantPlayer, 'eliminated' | 'life'>): boolean {
  return player.eliminated || player.life <= 0;
}

export function assignParticipantToPlayer(
  state: TableAssistantRoomState,
  participantId: string,
  playerId: string,
  action?: TableAssistantAction,
): TableAssistantRoomState {
  if (!state.participants.some((participant) => participant.id === participantId) || !state.players.some((player) => player.id === playerId)) {
    return state;
  }

  const participant = state.participants.find((candidate) => candidate.id === participantId);
  const assignedUserId = participant?.user?.id ?? null;

  return commit(
    {
      ...state,
      participants: state.participants.map((candidate) => (
        candidate.id === participantId ? { ...candidate, assignedPlayerId: playerId } : candidate
      )),
      players: state.players.map((player) => (
        player.id === playerId
          ? { ...player, assignedParticipantId: participantId, assignedUserId }
          : player.assignedParticipantId === participantId
            ? { ...player, assignedParticipantId: null, assignedUserId: null }
            : player
      )),
    },
    action,
  );
}

function createPlayers(
  count: number,
  startingLife: number,
  activeTrackerIds: readonly TableAssistantTrackerId[],
  configuredPlayers: ReadonlyArray<{ name?: string; color?: string }>,
): TableAssistantPlayer[] {
  const playerCount = Math.max(1, Math.floor(count));

  return Array.from({ length: playerCount }, (_, index) => ({
    id: `player-${index + 1}`,
    name: normalizedPlayerName(configuredPlayers[index]?.name, index),
    color: normalizedPlayerColor(configuredPlayers[index]?.color, index),
    seatIndex: index,
    turnOrder: index,
    life: startingLife,
    startingLife,
    eliminated: false,
    assignedParticipantId: null,
    assignedUserId: null,
    trackers: createPlayerTrackers(activeTrackerIds),
  }));
}

function normalizedPlayerName(name: string | undefined, index: number): string {
  const trimmedName = name?.trim();
  return trimmedName ? trimmedName.slice(0, 40) : `Jugador ${index + 1}`;
}

function normalizedPlayerColor(color: string | undefined, index: number): string {
  return color && PLAYER_COLORS.includes(color) ? color : PLAYER_COLORS[index % PLAYER_COLORS.length];
}

function defaultPermissionPolicy(mode: TableAssistantUseMode): TableAssistantPermissionPolicy {
  if (mode === 'single-device') {
    return {
      mode: 'everyone',
      hostCanEditAll: true,
      playerCanEditOwnPanel: true,
      viewerCanEdit: false,
    };
  }

  return {
    mode: 'host-and-owner',
    hostCanEditAll: true,
    playerCanEditOwnPanel: true,
    viewerCanEdit: false,
  };
}

function defaultActiveTrackerIds(): TableAssistantTrackerId[] {
  return TABLE_ASSISTANT_TRACKERS.filter((tracker) => tracker.defaultEnabled).map((tracker) => tracker.id);
}

function createPlayerTrackers(activeTrackerIds: readonly TableAssistantTrackerId[]): Partial<Record<TableAssistantPlayerTrackerId, number>> {
  const active = new Set(activeTrackerIds);

  return PLAYER_TRACKER_IDS.reduce<Partial<Record<TableAssistantPlayerTrackerId, number>>>((trackers, trackerId) => {
    if (active.has(trackerId)) {
      trackers[trackerId] = 0;
    }

    return trackers;
  }, {});
}

function createGlobalTrackers(activeTrackerIds: readonly TableAssistantTrackerId[]): Partial<Record<TableAssistantGlobalTrackerId, number>> {
  const active = new Set(activeTrackerIds);

  return GLOBAL_TRACKER_IDS.reduce<Partial<Record<TableAssistantGlobalTrackerId, number>>>((trackers, trackerId) => {
    if (active.has(trackerId)) {
      trackers[trackerId] = 0;
    }

    return trackers;
  }, {});
}

function createCommanderDamage(players: readonly TableAssistantPlayer[]): Record<string, Record<string, number>> {
  return players.reduce<Record<string, Record<string, number>>>((damageByTarget, target) => {
    damageByTarget[target.id] = players
      .filter((source) => source.id !== target.id)
      .reduce<Record<string, number>>((damageBySource, source) => {
        damageBySource[source.id] = 0;

        return damageBySource;
      }, {});

    return damageByTarget;
  }, {});
}

function applyCommanderDamageChange(
  state: TableAssistantRoomState,
  action: Extract<TableAssistantAction, { type: 'commander-damage.changed' }>,
): TableAssistantRoomState {
  if (!state.settings.commanderDamageEnabled || !state.commanderDamage[action.targetPlayerId] || action.targetPlayerId === action.sourcePlayerId) {
    return state;
  }

  const current = state.commanderDamage[action.targetPlayerId][action.sourcePlayerId] ?? 0;

  return commit(
    {
      ...state,
      commanderDamage: {
        ...state.commanderDamage,
        [action.targetPlayerId]: {
          ...state.commanderDamage[action.targetPlayerId],
          [action.sourcePlayerId]: Math.max(0, current + action.delta),
        },
      },
    },
    action,
  );
}

function passTurn(state: TableAssistantRoomState, action?: TableAssistantAction): TableAssistantRoomState {
  const nextActive = nextActivePlayer(state);
  if (!nextActive) {
    return state;
  }

  return commit(
    {
      ...state,
      turn: {
        activePlayerId: nextActive.activePlayerId,
        number: nextActive.completesRound ? state.turn.number + 1 : state.turn.number,
        phaseId: state.settings.phasesEnabled ? TABLE_ASSISTANT_PHASES[0] : null,
      },
      timer: resetTimerForBoundary(state),
    },
    action,
  );
}

function passPhase(state: TableAssistantRoomState, action: TableAssistantAction): TableAssistantRoomState {
  if (!state.settings.phasesEnabled || !state.turn.phaseId) {
    return state;
  }

  const currentIndex = TABLE_ASSISTANT_PHASES.indexOf(state.turn.phaseId);
  if (currentIndex === -1) {
    return state;
  }

  const nextPhase = TABLE_ASSISTANT_PHASES[currentIndex + 1];
  if (!nextPhase) {
    return passTurn(state, action);
  }

  return commit(
    {
      ...state,
      turn: {
        ...state.turn,
        phaseId: nextPhase,
      },
      timer: resetTimerForBoundary(state),
    },
    action,
  );
}

function startTimer(
  state: TableAssistantRoomState,
  action: Extract<TableAssistantAction, { type: 'timer.started' }>,
): TableAssistantRoomState {
  if (state.timer.mode === 'none') {
    return state;
  }

  const durationSeconds = Math.max(1, Math.floor(action.durationSeconds));

  return commit({
    ...state,
    timer: {
      ...state.timer,
      status: 'running',
      durationSeconds,
      remainingSeconds: durationSeconds,
      startedAt: new Date().toISOString(),
    },
  }, action);
}

function pauseTimer(
  state: TableAssistantRoomState,
  action: Extract<TableAssistantAction, { type: 'timer.paused' }>,
): TableAssistantRoomState {
  if (state.timer.mode === 'none') {
    return state;
  }

  return commit({
    ...state,
    timer: {
      ...state.timer,
      status: 'paused',
      remainingSeconds: Math.max(0, Math.floor(action.remainingSeconds)),
      startedAt: null,
    },
  }, action);
}

function resumeTimer(
  state: TableAssistantRoomState,
  action: Extract<TableAssistantAction, { type: 'timer.resumed' }>,
): TableAssistantRoomState {
  if (state.timer.mode === 'none') {
    return state;
  }

  return commit({
    ...state,
    timer: {
      ...state.timer,
      status: 'running',
      remainingSeconds: Math.max(0, Math.floor(action.remainingSeconds)),
      startedAt: new Date().toISOString(),
    },
  }, action);
}

function resetTimer(
  state: TableAssistantRoomState,
  action: Extract<TableAssistantAction, { type: 'timer.reset' }>,
): TableAssistantRoomState {
  if (state.timer.mode === 'none') {
    return state;
  }

  return commit({
    ...state,
    timer: resetTimerForBoundary(state),
  }, action);
}

function resetGame(
  state: TableAssistantRoomState,
  action: Extract<TableAssistantAction, { type: 'game.reset' }>,
): TableAssistantRoomState {
  const playersByTurn = [...state.players].sort((left, right) => left.turnOrder - right.turnOrder);

  return commit({
    ...state,
    players: state.players.map((player) => ({
      ...player,
      life: player.startingLife,
      eliminated: false,
      trackers: resetValues(player.trackers),
    })),
    turn: {
      activePlayerId: playersByTurn[0]?.id ?? null,
      number: 1,
      phaseId: state.settings.phasesEnabled ? TABLE_ASSISTANT_PHASES[0] : null,
    },
    timer: resetTimerForBoundary(state),
    globalTrackers: resetValues(state.globalTrackers),
    commanderDamage: buildCommanderDamage(state.players),
    actionLog: [],
  }, action);
}

function resetTimerForBoundary(state: TableAssistantRoomState): TableAssistantRoomState['timer'] {
  if (state.timer.mode === 'none') {
    return state.timer;
  }

  return {
    ...state.timer,
    status: 'idle',
    remainingSeconds: state.timer.durationSeconds,
    startedAt: null,
  };
}

function resetValues<T extends string>(values: Partial<Record<T, number>>): Partial<Record<T, number>> {
  return Object.fromEntries(Object.keys(values).map((key) => [key, 0])) as Partial<Record<T, number>>;
}

function buildCommanderDamage(players: TableAssistantPlayer[]): Record<string, Record<string, number>> {
  return players.reduce<Record<string, Record<string, number>>>((damage, target) => {
    damage[target.id] = players
      .filter((source) => source.id !== target.id)
      .reduce<Record<string, number>>((sources, source) => {
        sources[source.id] = 0;
        return sources;
      }, {});
    return damage;
  }, {});
}

type NextActivePlayer = {
  activePlayerId: string;
  completesRound: boolean;
};

function nextActivePlayer(state: TableAssistantRoomState): NextActivePlayer | null {
  if (state.players.length === 0) {
    return null;
  }

  const orderedPlayers = [...state.players].sort((left, right) => left.turnOrder - right.turnOrder);
  const foundCurrentIndex = orderedPlayers.findIndex((player) => player.id === state.turn.activePlayerId);
  const currentIndex = foundCurrentIndex === -1 ? 0 : foundCurrentIndex;

  for (let offset = 1; offset <= orderedPlayers.length; offset++) {
    const candidateIndex = (currentIndex + offset) % orderedPlayers.length;
    const candidate = orderedPlayers[candidateIndex];
    if (!isPlayerEliminated(candidate)) {
      return {
        activePlayerId: candidate.id,
        completesRound: candidateIndex <= currentIndex,
      };
    }
  }

  return state.turn.activePlayerId
    ? {
        activePlayerId: state.turn.activePlayerId,
        completesRound: false,
      }
    : null;
}

function applyTrackerChange(
  state: TableAssistantRoomState,
  action: Extract<TableAssistantAction, { type: 'tracker.changed' }>,
): TableAssistantRoomState {
  if (!state.settings.activeTrackerIds.includes(action.trackerId)) {
    return state;
  }

  if (isPlayerTracker(action.trackerId)) {
    if (!action.playerId) {
      return state;
    }

    return updatePlayer(
      state,
      action.playerId,
      (player) => ({
        ...player,
        trackers: {
          ...player.trackers,
          [action.trackerId]: action.value,
        },
      }),
      action,
    );
  }

  if (!isGlobalTracker(action.trackerId)) {
    return state;
  }

  return commit(
    {
      ...state,
      globalTrackers: {
        ...state.globalTrackers,
        [action.trackerId]: action.value,
      },
    },
    action,
  );
}

function updatePlayer(
  state: TableAssistantRoomState,
  playerId: string,
  updater: (player: TableAssistantPlayer) => TableAssistantPlayer,
  action?: TableAssistantAction,
): TableAssistantRoomState {
  if (!state.players.some((player) => player.id === playerId)) {
    return state;
  }

  const updatedState: TableAssistantRoomState = {
    ...state,
    players: state.players.map((player) => (player.id === playerId ? updater(player) : player)),
  };

  return commit(moveTurnAwayFromEliminatedActive(updatedState), action);
}

function withEliminationFromLife(player: TableAssistantPlayer): TableAssistantPlayer {
  return {
    ...player,
    eliminated: player.life <= 0,
  };
}

function moveTurnAwayFromEliminatedActive(state: TableAssistantRoomState): TableAssistantRoomState {
  const activePlayer = state.players.find((player) => player.id === state.turn.activePlayerId);
  if (!activePlayer || !isPlayerEliminated(activePlayer)) {
    return state;
  }

  const nextActive = nextActivePlayer(state);
  if (!nextActive || nextActive.activePlayerId === state.turn.activePlayerId) {
    return state;
  }

  return {
    ...state,
    turn: {
      activePlayerId: nextActive.activePlayerId,
      number: nextActive.completesRound ? state.turn.number + 1 : state.turn.number,
      phaseId: state.settings.phasesEnabled ? TABLE_ASSISTANT_PHASES[0] : null,
    },
    timer: resetTimerForBoundary(state),
  };
}

function commit(state: TableAssistantRoomState, action?: TableAssistantAction): TableAssistantRoomState {
  return {
    ...state,
    version: state.version + 1,
    updatedAt: new Date().toISOString(),
    actionLog: action ? [...state.actionLog, toActionLogEntry(action)] : state.actionLog,
  };
}

function toActionLogEntry(action: TableAssistantAction): TableAssistantActionLogEntry {
  return {
    id: action.clientActionId ?? `action-${Date.now()}`,
    type: action.type,
    actorParticipantId: action.actorParticipantId ?? null,
    createdAt: new Date().toISOString(),
  };
}

function isPlayerTracker(trackerId: TableAssistantPlayerTrackerId | TableAssistantGlobalTrackerId): trackerId is TableAssistantPlayerTrackerId {
  return PLAYER_TRACKER_IDS.includes(trackerId as TableAssistantPlayerTrackerId);
}

function isGlobalTracker(trackerId: TableAssistantPlayerTrackerId | TableAssistantGlobalTrackerId): trackerId is TableAssistantGlobalTrackerId {
  return GLOBAL_TRACKER_IDS.includes(trackerId as TableAssistantGlobalTrackerId);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeNullablePositiveInteger(value: number | null | undefined, fallback: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}
