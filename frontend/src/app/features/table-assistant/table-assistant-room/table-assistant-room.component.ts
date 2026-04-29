import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  COMMANDER_DAMAGE_LETHAL_AMOUNT,
  TABLE_ASSISTANT_TRACKERS,
  canEditPlayer,
  isPlayerEliminated,
  phaseLabel,
} from '../domain/table-assistant-state';
import { TableAssistantTimerService } from '../domain/table-assistant-timer.service';
import { TableAssistantApi, TableAssistantRoomResource } from '../data-access/table-assistant.api';
import { TableAssistantSyncService } from '../data-access/table-assistant-sync.service';
import { tableAssistantColorOption } from '../domain/table-assistant-colors';
import {
  TableAssistantGlobalTrackerId,
  TableAssistantPlayer,
  TableAssistantPlayerTrackerId,
  TableAssistantRoomState,
  TableAssistantTrackerId,
} from '../models/table-assistant.models';

@Component({
  selector: 'app-table-assistant-room',
  templateUrl: './table-assistant-room.component.html',
  styleUrl: './table-assistant-room.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TableAssistantSyncService, TableAssistantTimerService],
})
export class TableAssistantRoomComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly tableAssistantApi = inject(TableAssistantApi);
  private readonly auth = inject(AuthStore);
  readonly sync = inject(TableAssistantSyncService);
  readonly timer = inject(TableAssistantTimerService);
  private previousTurn: TableAssistantRoomState['turn'] | null = null;

  readonly room = signal<TableAssistantRoomResource | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly copied = signal(false);

  readonly state = computed(() => this.room()?.state ?? null);
  readonly players = computed(() => this.state()?.players ?? []);
  readonly activePlayer = computed(() => this.players().find((player) => player.id === this.state()?.turn.activePlayerId) ?? null);
  readonly isSingleDeviceMode = computed(() => this.state()?.mode === 'single-device');
  readonly connectedParticipantsCount = computed(() => this.state()?.participants.filter((participant) => participant.connected).length ?? 0);
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
  readonly playerTrackerIds = computed(() => this.activeTrackerIdsByScope('player') as TableAssistantPlayerTrackerId[]);
  readonly globalTrackerIds = computed(() => this.activeTrackerIdsByScope('global') as TableAssistantGlobalTrackerId[]);
  readonly currentParticipantId = computed(() => {
    const userId = this.auth.user()?.id;
    return this.state()?.participants.find((participant) => participant.user?.id === userId)?.id ?? null;
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
    return state !== null && participantId !== null && canEditPlayer(state, participantId, player.id);
  }

  async changeLife(player: TableAssistantPlayer, delta: number): Promise<void> {
    if (!this.canEdit(player)) {
      return;
    }

    await this.sendAction('life.changed', { playerId: player.id, delta });
  }

  async passTurn(): Promise<void> {
    const state = this.state();
    if (!state) {
      return;
    }

    this.previousTurn = state.turn;
    await this.sendAction('turn.passed', {});
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
    await this.sendAction('timer.resumed', { remainingSeconds: this.timer.remainingSeconds() ?? 0 });
  }

  async resetTimer(): Promise<void> {
    await this.sendAction('timer.reset', {});
  }

  async changeCommanderDamage(targetPlayer: TableAssistantPlayer, sourcePlayerId: string, delta: number): Promise<void> {
    if (!this.canUsePlayerOptions(targetPlayer)) {
      return;
    }

    await this.sendAction('commander-damage.changed', {
      targetPlayerId: targetPlayer.id,
      sourcePlayerId,
      delta,
    });
  }

  async changePlayerTracker(player: TableAssistantPlayer, trackerId: TableAssistantPlayerTrackerId, delta: number): Promise<void> {
    if (!this.canUsePlayerOptions(player)) {
      return;
    }

    await this.sendAction('tracker.changed', {
      trackerId,
      playerId: player.id,
      value: Math.max(0, (player.trackers[trackerId] ?? 0) + delta),
    });
  }

  async changeGlobalTracker(trackerId: TableAssistantGlobalTrackerId, delta: number): Promise<void> {
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

  trackerLabel(trackerId: TableAssistantTrackerId): string {
    return TABLE_ASSISTANT_TRACKERS.find((tracker) => tracker.id === trackerId)?.label ?? trackerId;
  }

  displayPlayerName(player: TableAssistantPlayer): string {
    return player.name.slice(0, 15);
  }

  playerGradient(player: TableAssistantPlayer): string {
    return tableAssistantColorOption(player.color).gradient;
  }

  playerAccent(player: TableAssistantPlayer): string {
    return tableAssistantColorOption(player.color).accent;
  }

  formatTimer(seconds: number | null): string {
    if (seconds === null) {
      return '--:--';
    }

    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');

    return `${minutes}:${remainder}`;
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
      this.sync.connect(roomId, (room) => this.applyRoom(room));
    } catch {
      this.error.set('No se pudo cargar la sala.');
    } finally {
      this.loading.set(false);
    }
  }

  private async sendAction(type: Parameters<TableAssistantApi['action']>[1]['type'], payload: Record<string, unknown>): Promise<void> {
    const room = this.room();
    if (!room) {
      return;
    }

    try {
      const response = await firstValueFrom(this.tableAssistantApi.action(room.id, {
        type,
        payload,
        clientActionId: this.clientActionId(),
      }));
      this.applyRoom(response.tableAssistantRoom);
    } catch {
      this.error.set('No se pudo aplicar la accion.');
    }
  }

  private applyRoom(room: TableAssistantRoomResource): void {
    this.room.set(room);
  }

  private clientActionId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `action-${Date.now()}`;
  }

  private activeTrackerIdsByScope(scope: 'player' | 'global'): TableAssistantTrackerId[] {
    const active = new Set(this.state()?.settings.activeTrackerIds ?? []);
    return TABLE_ASSISTANT_TRACKERS
      .filter((tracker) => tracker.scope === scope && active.has(tracker.id))
      .map((tracker) => tracker.id);
  }
}
