import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RoomsApi } from '../../../core/api/rooms.api';
import { FriendsApi } from '../../../core/api/friends.api';
import { FriendUser } from '../../../core/models/friendship.model';
import { TABLE_ASSISTANT_TRACKERS, availableTimerModes, createDefaultSettings } from '../domain/table-assistant-state';
import { TABLE_ASSISTANT_COLOR_OPTIONS } from '../domain/table-assistant-colors';
import { TableAssistantApi } from '../data-access/table-assistant.api';
import { TableAssistantTimerMode, TableAssistantTrackerId, TableAssistantUseMode } from '../models/table-assistant.models';

interface ModeOption {
  id: TableAssistantUseMode;
  title: string;
  description: string;
  idealFor: string;
}

@Component({
  selector: 'app-table-assistant-setup',
  imports: [FormsModule],
  templateUrl: './table-assistant-setup.component.html',
  styleUrl: './table-assistant-setup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantSetupComponent {
  private readonly tableAssistantApi = inject(TableAssistantApi);
  private readonly roomsApi = inject(RoomsApi);
  private readonly friendsApi = inject(FriendsApi);
  private readonly router = inject(Router);

  readonly cancelled = output<void>();

  readonly modeOptions: ModeOption[] = [
    {
      id: 'single-device',
      title: 'Un dispositivo en la mesa',
      description: 'Usa un movil o tablet compartido para controlar toda la partida desde el centro de la mesa.',
      idealFor: 'Partidas rapidas, casuales o mesas que no quieren conectarse.',
    },
    {
      id: 'per-player-device',
      title: 'Un movil por jugador',
      description: 'Cada jugador se conecta a la sala y controla su propio panel mientras todo se mantiene sincronizado.',
      idealFor: 'Partidas largas, grupos organizados o mesas que quieren menos errores.',
    },
  ];
  readonly trackers = TABLE_ASSISTANT_TRACKERS;
  readonly colorOptions = TABLE_ASSISTANT_COLOR_OPTIONS;
  readonly mode = signal<TableAssistantUseMode>('single-device');
  readonly playerCount = signal(4);
  readonly initialLife = signal(40);
  readonly playerNames = signal(['Jugador 1', 'Jugador 2', 'Jugador 3', 'Jugador 4']);
  readonly playerColors = signal(['white', 'blue', 'black', 'red']);
  readonly phasesEnabled = signal(false);
  readonly timerMode = signal<TableAssistantTimerMode>('none');
  readonly timerDurationSeconds = signal(300);
  readonly skipEliminatedPlayers = signal(false);
  readonly activeTrackerIds = signal<TableAssistantTrackerId[]>(['commander-damage']);
  readonly friends = signal<FriendUser[]>([]);
  readonly selectedFriendIds = signal<string[]>([]);
  readonly creating = signal(false);
  readonly loadingFriends = signal(false);
  readonly error = signal<string | null>(null);

  readonly availableTimerModes = computed(() => availableTimerModes(this.phasesEnabled()));
  readonly canInviteFriends = computed(() => this.mode() === 'per-player-device');
  readonly defaultsSummary = computed(() => createDefaultSettings(this.mode(), {
    initialLife: this.initialLife(),
    phasesEnabled: this.phasesEnabled(),
    timerMode: this.timerMode(),
    skipEliminatedPlayers: this.skipEliminatedPlayers(),
    activeTrackerIds: this.activeTrackerIds(),
  }));

  constructor() {
    void this.loadFriends();
  }

  selectMode(mode: TableAssistantUseMode): void {
    this.mode.set(mode);
    if (mode === 'single-device') {
      this.selectedFriendIds.set([]);
    }
  }

  setPlayerCount(value: string | number): void {
    const count = Math.min(6, Math.max(1, Number.parseInt(String(value), 10) || 4));
    this.playerCount.set(count);
    const names = [...this.playerNames()];
    while (names.length < count) {
      names.push(`Jugador ${names.length + 1}`);
    }
    this.playerNames.set(names.slice(0, count));
    const colors = [...this.playerColors()];
    while (colors.length < count) {
      colors.push(this.colorOptions[colors.length % this.colorOptions.length].id);
    }
    this.playerColors.set(colors.slice(0, count));
  }

  setInitialLife(value: string | number): void {
    this.initialLife.set(Math.max(1, Number.parseInt(String(value), 10) || 40));
  }

  updatePlayerName(index: number, value: string): void {
    const names = [...this.playerNames()];
    names[index] = value;
    this.playerNames.set(names);
  }

  updatePlayerColor(index: number, color: string): void {
    if (!this.colorOptions.some((option) => option.id === color)) {
      return;
    }

    const colors = [...this.playerColors()];
    colors[index] = color;
    this.playerColors.set(colors);
  }

  togglePhases(enabled: boolean): void {
    this.phasesEnabled.set(enabled);
    if (!availableTimerModes(enabled).includes(this.timerMode())) {
      this.timerMode.set('none');
    }
  }

  setTimerMode(mode: string): void {
    const timerMode = mode as TableAssistantTimerMode;
    if (this.availableTimerModes().includes(timerMode)) {
      this.timerMode.set(timerMode);
    }
  }

  setTimerDuration(value: string | number): void {
    this.timerDurationSeconds.set(Math.max(30, Number.parseInt(String(value), 10) || 300));
  }

  toggleTracker(trackerId: TableAssistantTrackerId): void {
    const current = this.activeTrackerIds();
    this.activeTrackerIds.set(
      current.includes(trackerId)
        ? current.filter((id) => id !== trackerId)
        : [...current, trackerId],
    );
  }

  toggleFriend(friendId: string): void {
    const selected = this.selectedFriendIds();
    this.selectedFriendIds.set(
      selected.includes(friendId)
        ? selected.filter((id) => id !== friendId)
        : [...selected, friendId],
    );
  }

  isTrackerActive(trackerId: TableAssistantTrackerId): boolean {
    return this.activeTrackerIds().includes(trackerId);
  }

  isFriendSelected(friendId: string): boolean {
    return this.selectedFriendIds().includes(friendId);
  }

  async createRoom(): Promise<void> {
    this.creating.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(this.tableAssistantApi.create({
        mode: this.mode(),
        playerCount: this.playerCount(),
        initialLife: this.initialLife(),
        players: this.playerNames().map((name, index) => ({ name, color: this.playerColors()[index] ?? this.colorOptions[0].id })),
        phasesEnabled: this.phasesEnabled(),
        timerMode: this.timerMode(),
        timerDurationSeconds: this.timerDurationSeconds(),
        skipEliminatedPlayers: this.skipEliminatedPlayers(),
        activeTrackerIds: this.activeTrackerIds(),
      }));
      await this.inviteSelectedFriends(response.tableAssistantRoom.id);
      await this.router.navigate(['/table-assistant', response.tableAssistantRoom.id]);
    } catch {
      this.error.set('No se pudo crear la sala de Asistente de Mesa.');
    } finally {
      this.creating.set(false);
    }
  }

  private async loadFriends(): Promise<void> {
    this.loadingFriends.set(true);
    try {
      const response = await firstValueFrom(this.friendsApi.list());
      this.friends.set(response.data.map((friendship) => friendship.friend).filter((friend): friend is FriendUser => friend !== undefined));
    } catch {
      this.friends.set([]);
    } finally {
      this.loadingFriends.set(false);
    }
  }

  private async inviteSelectedFriends(roomId: string): Promise<void> {
    if (!this.canInviteFriends()) {
      return;
    }

    const friendIds = this.selectedFriendIds();
    if (friendIds.length === 0) {
      return;
    }

    await Promise.allSettled(friendIds.map((friendId) => firstValueFrom(this.roomsApi.invite(roomId, friendId))));
  }
}
