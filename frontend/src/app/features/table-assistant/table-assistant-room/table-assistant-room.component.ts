import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { FullscreenService } from '../../../core/fullscreen/fullscreen.service';
import {
  COMMANDER_DAMAGE_LETHAL_AMOUNT,
  TABLE_ASSISTANT_TRACKERS,
  applyTableAssistantAction,
  canEditPlayer,
  isPlayerEliminated,
  phaseLabel,
} from '../domain/table-assistant-state';
import { TableAssistantTimerService } from '../domain/table-assistant-timer.service';
import { TableAssistantApi, TableAssistantRoomResource } from '../data-access/table-assistant.api';
import { TableAssistantSyncService } from '../data-access/table-assistant-sync.service';
import { tableAssistantColorOption } from '../domain/table-assistant-colors';
import { TableAssistantReplayModalComponent } from '../table-assistant-replay-modal/table-assistant-replay-modal.component';
import { TableAssistantRollModalComponent } from '../table-assistant-roll-modal/table-assistant-roll-modal.component';
import { TableAssistantTableMenuComponent } from '../table-assistant-table-menu/table-assistant-table-menu.component';
import { TableAssistantTurnControlsComponent } from '../table-assistant-turn-controls/table-assistant-turn-controls.component';
import {
  TableAssistantGlobalTrackerId,
  TableAssistantAction,
  TableAssistantPlayer,
  TableAssistantPlayerArrangement,
  TableAssistantPlayerTrackerId,
  TableAssistantRoomState,
  TableAssistantTrackerId,
} from '../models/table-assistant.models';

@Component({
  selector: 'app-table-assistant-room',
  imports: [
    TableAssistantReplayModalComponent,
    TableAssistantRollModalComponent,
    TableAssistantTableMenuComponent,
    TableAssistantTurnControlsComponent,
  ],
  templateUrl: './table-assistant-room.component.html',
  styleUrl: './table-assistant-room.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TableAssistantSyncService, TableAssistantTimerService],
})
export class TableAssistantRoomComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tableAssistantApi = inject(TableAssistantApi);
  private readonly auth = inject(AuthStore);
  private readonly fullscreen = inject(FullscreenService);
  readonly sync = inject(TableAssistantSyncService);
  readonly timer = inject(TableAssistantTimerService);
  private previousTurn: TableAssistantRoomState['turn'] | null = null;

  readonly room = signal<TableAssistantRoomResource | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly copied = signal(false);
  readonly commanderDamagePlayerId = signal<string | null>(null);
  readonly replayModalOpen = signal(false);
  readonly replayModalMode = signal<'initial' | 'replay'>('replay');
  readonly rollModalOpen = signal(false);
  private joiningParticipant = false;
  private initialArrangementPrompted = false;

  readonly state = computed(() => this.room()?.state ?? null);
  readonly players = computed(() => this.state()?.players ?? []);
  readonly activePlayerId = computed(() => this.state()?.turn.activePlayerId ?? null);
  readonly seatedPlayers = computed(() =>
    [...this.players()].sort((left, right) => left.seatIndex - right.seatIndex),
  );
  readonly turnOrderedPlayers = computed(() =>
    [...this.players()].sort((left, right) => left.turnOrder - right.turnOrder),
  );
  readonly seatColumnCount = computed(() =>
    this.state()?.mode === 'single-device'
      ? Math.max(1, Math.ceil(this.seatedPlayers().length / 2))
      : 2,
  );
  readonly activePlayer = computed(
    () => this.players().find((player) => player.id === this.activePlayerId()) ?? null,
  );
  readonly isSingleDeviceMode = computed(() => this.state()?.mode === 'single-device');
  readonly connectedParticipantsCount = computed(
    () => this.state()?.participants.filter((participant) => participant.connected).length ?? 0,
  );
  readonly shouldShowRoomSharing = computed(() => {
    const state = this.state();
    if (!state || state.mode !== 'per-player-device') {
      return false;
    }

    return state.turn.number === 1 && state.actionLog.length === 0;
  });
  readonly currentPhaseLabel = computed(() => {
    const phaseId = this.state()?.turn.phaseId;
    return phaseId ? phaseLabel(phaseId) : null;
  });
  readonly playerTrackerIds = computed(
    () => this.activeTrackerIdsByScope('player') as TableAssistantPlayerTrackerId[],
  );
  readonly globalTrackerIds = computed(
    () => this.activeTrackerIdsByScope('global') as TableAssistantGlobalTrackerId[],
  );
  readonly currentParticipantId = computed(() => {
    const userId = this.auth.user()?.id;
    return (
      this.state()?.participants.find((participant) => participant.user?.id === userId)?.id ?? null
    );
  });

  constructor() {
    effect(() => {
      const timer = this.state()?.timer;
      if (timer) {
        this.timer.sync(timer);
      }
    });
    void this.load();
  }

  canEdit(player: TableAssistantPlayer): boolean {
    const state = this.state();
    const participantId = this.currentParticipantId();
    return (
      state !== null && participantId !== null && canEditPlayer(state, participantId, player.id)
    );
  }

  async changeLife(player: TableAssistantPlayer, delta: number): Promise<void> {
    if (!this.canEdit(player)) {
      return;
    }

    await this.sendProjectedAction({ type: 'life.changed', playerId: player.id, delta });
  }

  async passTurn(): Promise<void> {
    const state = this.state();
    if (!state) {
      return;
    }

    this.previousTurn = state.turn;
    await this.sendProjectedAction({ type: 'turn.passed' });
  }

  async passPhase(): Promise<void> {
    await this.sendAction('phase.passed', {});
  }

  async revertTurn(): Promise<void> {
    if (!this.previousTurn) {
      return;
    }

    await this.sendAction('turn.reverted', {
      activePlayerId: this.previousTurn.activePlayerId,
      number: this.previousTurn.number,
    });
    this.previousTurn = null;
  }

  isPlayerOut(player: TableAssistantPlayer): boolean {
    return isPlayerEliminated(player);
  }

  canUsePlayerOptions(player: TableAssistantPlayer): boolean {
    return this.canEdit(player) && !this.isPlayerOut(player);
  }

  async startTimer(): Promise<void> {
    const durationSeconds = this.state()?.timer.durationSeconds ?? 300;
    await this.sendAction('timer.started', { durationSeconds });
  }

  async pauseTimer(): Promise<void> {
    await this.sendAction('timer.paused', { remainingSeconds: this.timer.remainingSeconds() ?? 0 });
  }

  async resumeTimer(): Promise<void> {
    await this.sendAction('timer.resumed', {
      remainingSeconds: this.timer.remainingSeconds() ?? 0,
    });
  }

  async changeCommanderDamage(
    targetPlayer: TableAssistantPlayer,
    sourcePlayerId: string,
    delta: number,
  ): Promise<void> {
    if (!this.canUsePlayerOptions(targetPlayer)) {
      return;
    }

    await this.sendAction('commander-damage.changed', {
      targetPlayerId: targetPlayer.id,
      sourcePlayerId,
      delta,
    });
  }

  async changePlayerTracker(
    player: TableAssistantPlayer,
    trackerId: TableAssistantPlayerTrackerId,
    delta: number,
  ): Promise<void> {
    if (!this.canUsePlayerOptions(player)) {
      return;
    }

    await this.sendAction('tracker.changed', {
      trackerId,
      playerId: player.id,
      value: Math.max(0, (player.trackers[trackerId] ?? 0) + delta),
    });
  }

  async changeGlobalTracker(
    trackerId: TableAssistantGlobalTrackerId,
    delta: number,
  ): Promise<void> {
    const state = this.state();
    if (!state) {
      return;
    }

    await this.sendAction('tracker.changed', {
      trackerId,
      value: Math.max(0, (state.globalTrackers[trackerId] ?? 0) + delta),
    });
  }

  commanderDamageSources(targetPlayer: TableAssistantPlayer): TableAssistantPlayer[] {
    return this.players().filter((player) => player.id !== targetPlayer.id);
  }

  commanderDamage(targetPlayerId: string, sourcePlayerId: string): number {
    return this.state()?.commanderDamage[targetPlayerId]?.[sourcePlayerId] ?? 0;
  }

  isCommanderDamageLethal(targetPlayerId: string, sourcePlayerId: string): boolean {
    return this.commanderDamage(targetPlayerId, sourcePlayerId) >= COMMANDER_DAMAGE_LETHAL_AMOUNT;
  }

  openCommanderDamage(player: TableAssistantPlayer): void {
    this.commanderDamagePlayerId.set(player.id);
  }

  closeCommanderDamage(): void {
    this.commanderDamagePlayerId.set(null);
  }

  isCommanderDamageOpen(player: TableAssistantPlayer): boolean {
    return this.commanderDamagePlayerId() === player.id;
  }

  async goToDashboard(): Promise<void> {
    await this.router.navigate(['/dashboard']);
  }

  openReplayModal(): void {
    this.replayModalMode.set('replay');
    this.replayModalOpen.set(true);
  }

  closeReplayModal(): void {
    this.replayModalOpen.set(false);
  }

  async cancelReplayModal(): Promise<void> {
    this.replayModalOpen.set(false);
    await this.router.navigate(['/table-assistant']);
  }

  async startNewTable(
    arrangement: TableAssistantPlayerArrangement = this.currentArrangement(),
  ): Promise<void> {
    const applied = await this.sendProjectedAction({
      type: 'game.reset',
      seatOrder: [...arrangement.seatOrder],
      turnOrder: [...arrangement.turnOrder],
    });
    if (!applied) {
      return;
    }
    this.closeReplayModal();
  }

  openRollModal(): void {
    this.rollModalOpen.set(true);
  }

  closeRollModal(): void {
    this.rollModalOpen.set(false);
  }

  async toggleFullscreen(): Promise<void> {
    await this.fullscreen.toggleFullscreen();
  }

  trackerLabel(trackerId: TableAssistantTrackerId): string {
    return TABLE_ASSISTANT_TRACKERS.find((tracker) => tracker.id === trackerId)?.label ?? trackerId;
  }

  displayPlayerName(player: TableAssistantPlayer): string {
    return player.name.slice(0, 15);
  }

  shouldHidePlayerName(player: TableAssistantPlayer): boolean {
    return this.players().length >= 5 && this.isActivePlayer(player);
  }

  isActivePlayer(player: TableAssistantPlayer): boolean {
    return player.id === this.activePlayerId();
  }

  isSingleDeviceSeat(index: number): boolean {
    return this.state()?.mode === 'single-device' && index >= 0;
  }

  isSingleDeviceTopSeat(index: number): boolean {
    return (
      this.isSingleDeviceSeat(index) && !this.isSingleDeviceOddLastSeat(index) && index % 2 === 0
    );
  }

  isSingleDeviceBottomSeat(index: number): boolean {
    return (
      this.isSingleDeviceSeat(index) && !this.isSingleDeviceOddLastSeat(index) && index % 2 === 1
    );
  }

  isSingleDeviceOddLastSeat(index: number): boolean {
    const playerCount = this.players().length;
    return this.isSingleDeviceSeat(index) && playerCount % 2 === 1 && index === playerCount - 1;
  }

  seatColumn(index: number): number {
    return Math.floor(index / 2) + 1;
  }

  playerGradient(player: TableAssistantPlayer): string {
    return tableAssistantColorOption(player.color).gradient;
  }

  playerBackground(player: TableAssistantPlayer): string {
    return `linear-gradient(145deg, rgba(2, 6, 23, 0.22), rgba(2, 6, 23, 0.04)), ${this.playerGradient(player)}`;
  }

  playerAccent(player: TableAssistantPlayer): string {
    return tableAssistantColorOption(player.color).accent;
  }

  playerManaSymbols(player: TableAssistantPlayer): readonly string[] {
    return tableAssistantColorOption(player.color).manaSymbols;
  }

  manaClass(symbol: string): string {
    return `ms ms-${symbol}`;
  }

  private currentArrangement(): TableAssistantPlayerArrangement {
    return {
      seatOrder: this.seatedPlayers().map((player) => player.id),
      turnOrder: this.turnOrderedPlayers().map((player) => player.id),
    };
  }

  async copyInviteLink(): Promise<void> {
    const room = this.room();
    if (!room) {
      return;
    }

    const link = `${window.location.origin}/table-assistant/${room.id}`;
    await navigator.clipboard?.writeText(link);
    this.copied.set(true);
  }

  private async load(): Promise<void> {
    const roomId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!roomId) {
      this.error.set('Falta el identificador de sala.');
      this.loading.set(false);
      return;
    }

    try {
      const response = await firstValueFrom(this.tableAssistantApi.get(roomId));
      this.applyRoom(response.tableAssistantRoom);
      await this.joinAsParticipantIfNeeded(roomId);
      this.sync.connect(roomId, (room) => this.applyRoom(room));
    } catch {
      this.error.set('No se pudo cargar la sala.');
    } finally {
      this.loading.set(false);
    }
  }

  private async sendAction(
    type: Parameters<TableAssistantApi['action']>[1]['type'],
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const room = this.room();
    if (!room) {
      return false;
    }

    try {
      const response = await firstValueFrom(
        this.tableAssistantApi.action(room.id, {
          type,
          payload,
          clientActionId: this.clientActionId(),
        }),
      );
      this.applyRoom(response.tableAssistantRoom);
      return response.applied;
    } catch {
      this.error.set('No se pudo aplicar la accion.');
      return false;
    }
  }

  private async sendProjectedAction(action: TableAssistantAction): Promise<boolean> {
    const baseRoom = this.room();
    if (!baseRoom) {
      return false;
    }

    const clientActionId = action.clientActionId ?? this.clientActionId();
    const actionWithId = { ...action, clientActionId } as TableAssistantAction;

    try {
      const response = await firstValueFrom(
        this.tableAssistantApi.action(baseRoom.id, {
          type: actionWithId.type,
          payload: this.actionPayload(actionWithId),
          clientActionId,
        }),
      );

      if (!response.applied) {
        return false;
      }

      this.applyProjectedRoom(baseRoom, actionWithId, response.tableAssistantRoom);
      return true;
    } catch {
      this.error.set('No se pudo aplicar la accion.');
      return false;
    }
  }

  private applyProjectedRoom(
    baseRoom: TableAssistantRoomResource,
    action: TableAssistantAction,
    serverRoom: TableAssistantRoomResource,
  ): void {
    const nextState = applyTableAssistantAction(baseRoom.state, action);
    const version = Math.max(serverRoom.version, baseRoom.version + 1, nextState.version);
    const updatedAt = serverRoom.updatedAt || nextState.updatedAt;

    this.room.set({
      ...serverRoom,
      state: {
        ...nextState,
        version,
        updatedAt,
      },
      version,
      updatedAt,
    });
  }

  private applyRoom(room: TableAssistantRoomResource): void {
    const currentRoom = this.room();
    if (currentRoom && room.version <= currentRoom.version) {
      return;
    }

    this.room.set(room);
    if (this.shouldOpenInitialArrangement(room.state)) {
      this.initialArrangementPrompted = true;
      this.replayModalMode.set('initial');
      this.replayModalOpen.set(true);
    }
  }

  private shouldOpenInitialArrangement(state: TableAssistantRoomState): boolean {
    if (
      this.initialArrangementPrompted ||
      state.actionLog.length > 0 ||
      this.route.snapshot.queryParamMap.get('arrange') !== '1'
    ) {
      return false;
    }

    const userId = this.auth.user()?.id;
    return state.participants.some(
      (participant) => participant.role === 'host' && participant.user?.id === userId,
    );
  }

  private async joinAsParticipantIfNeeded(roomId: string): Promise<void> {
    const state = this.state();
    const userId = this.auth.user()?.id;
    if (this.joiningParticipant || !state || state.mode !== 'per-player-device' || !userId) {
      return;
    }
    if (state.participants.some((participant) => participant.user?.id === userId)) {
      return;
    }

    this.joiningParticipant = true;
    try {
      const response = await firstValueFrom(this.tableAssistantApi.join(roomId));
      this.applyRoom(response.tableAssistantRoom);
    } finally {
      this.joiningParticipant = false;
    }
  }

  private clientActionId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `action-${Date.now()}`;
  }

  private actionPayload(action: TableAssistantAction): Record<string, unknown> {
    const {
      type: _type,
      clientActionId: _clientActionId,
      actorParticipantId: _actor,
      ...payload
    } = action as TableAssistantAction & Record<string, unknown>;

    return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
  }

  private activeTrackerIdsByScope(scope: 'player' | 'global'): TableAssistantTrackerId[] {
    const active = new Set(this.state()?.settings.activeTrackerIds ?? []);
    return TABLE_ASSISTANT_TRACKERS.filter(
      (tracker) => tracker.scope === scope && active.has(tracker.id),
    ).map((tracker) => tracker.id);
  }
}
