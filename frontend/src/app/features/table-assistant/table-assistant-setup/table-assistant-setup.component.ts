import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RoomsApi } from '../../../core/api/rooms.api';
import { FriendsApi } from '../../../core/api/friends.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { FriendUser } from '../../../core/models/friendship.model';
import { TABLE_ASSISTANT_COLOR_OPTIONS, tableAssistantColorOption } from '../domain/table-assistant-colors';
import { TableAssistantApi } from '../data-access/table-assistant.api';
import { TableAssistantTimerMode, TableAssistantUseMode } from '../models/table-assistant.models';

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
  private readonly auth = inject(AuthStore);
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
  readonly colorOptions = TABLE_ASSISTANT_COLOR_OPTIONS;
  readonly timerMinuteOptions = Array.from({ length: 31 }, (_, index) => index);
  readonly timerSecondOptions = [0, 15, 30, 45];
  readonly mode = signal<TableAssistantUseMode>('single-device');
  readonly playerCount = signal(4);
  readonly initialLife = signal(40);
  readonly playerNames = signal(['Jugador 1', 'Jugador 2', 'Jugador 3', 'Jugador 4']);
  readonly playerColors = signal(['white', 'blue', 'black', 'red']);
  readonly phasesEnabled = signal(false);
  readonly timerMode = signal<TableAssistantTimerMode>('none');
  readonly timerDurationSeconds = signal(300);
  readonly skipEliminatedPlayers = signal(false);
  readonly playerFriendIds = signal<Array<string | null>>([null, null, null, null]);
  readonly friends = signal<FriendUser[]>([]);
  readonly openColorPickerIndex = signal<number | null>(null);
  readonly creating = signal(false);
  readonly loadingFriends = signal(false);
  readonly error = signal<string | null>(null);

  readonly availableTimerModes = computed<TableAssistantTimerMode[]>(() => ['none', 'turn']);
  readonly canInviteFriends = computed(() => this.mode() === 'per-player-device');
  readonly timerDurationMinutes = computed(() => Math.floor(this.timerDurationSeconds() / 60));
  readonly timerDurationRemainderSeconds = computed(() => this.timerDurationSeconds() % 60);
  readonly timerDurationLabel = computed(() => `${this.timerDurationMinutes()}:${this.timerDurationRemainderSeconds().toString().padStart(2, '0')}`);

  constructor() {
    void this.loadFriends();
  }

  selectMode(mode: TableAssistantUseMode): void {
    this.mode.set(mode);
    if (mode === 'per-player-device') {
      const names = [...this.playerNames()];
      names[0] = this.currentUserDisplayName();
      this.playerNames.set(names.slice(0, this.playerCount()));
      return;
    }

    this.playerFriendIds.set(Array.from({ length: this.playerCount() }, () => null));
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
    const friendIds = [...this.playerFriendIds()];
    while (friendIds.length < count) {
      friendIds.push(null);
    }
    this.playerFriendIds.set(friendIds.slice(0, count));
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

  setTimerMode(mode: string): void {
    const timerMode = mode as TableAssistantTimerMode;
    if (this.availableTimerModes().includes(timerMode)) {
      this.timerMode.set(timerMode);
    }
  }

  setTimerDurationMinutes(value: string | number): void {
    const minutes = this.normalizeWheelNumber(value);
    this.setTimerDurationParts(minutes, this.timerDurationRemainderSeconds());
  }

  setTimerDurationRemainderSeconds(value: string | number): void {
    const seconds = this.normalizeWheelNumber(value);
    this.setTimerDurationParts(this.timerDurationMinutes(), seconds);
  }

  updatePlayerFriend(index: number, friendId: string): void {
    const friendIds = [...this.playerFriendIds()];
    const normalizedFriendId = friendId || null;
    friendIds[index] = normalizedFriendId;
    this.playerFriendIds.set(friendIds);

    if (normalizedFriendId) {
      const friend = this.friends().find((candidate) => candidate.id === normalizedFriendId);
      if (friend) {
        this.updatePlayerName(index, friend.displayName);
      }
    }
  }

  colorLabel(colorId: string | undefined): string {
    return tableAssistantColorOption(colorId ?? this.colorOptions[0].id).label;
  }

  colorManaSymbols(colorId: string | undefined): readonly string[] {
    return tableAssistantColorOption(colorId ?? this.colorOptions[0].id).manaSymbols;
  }

  colorAccent(colorId: string | undefined): string {
    return tableAssistantColorOption(colorId ?? this.colorOptions[0].id).accent;
  }

  colorGradient(colorId: string | undefined): string {
    return tableAssistantColorOption(colorId ?? this.colorOptions[0].id).gradient;
  }

  manaClass(symbol: string): string {
    return `ms ms-${symbol}`;
  }

  toggleColorPicker(index: number): void {
    this.openColorPickerIndex.update((openIndex) => openIndex === index ? null : index);
  }

  selectPlayerColor(index: number, color: string): void {
    this.updatePlayerColor(index, color);
    this.openColorPickerIndex.set(null);
  }

  async createRoom(): Promise<void> {
    this.creating.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(this.tableAssistantApi.create({
        mode: this.mode(),
        playerCount: this.playerCount(),
        initialLife: this.initialLife(),
        players: this.playerNamesForPayload().map((name, index) => ({ name, color: this.playerColors()[index] ?? this.colorOptions[0].id })),
        phasesEnabled: false,
        timerMode: this.timerMode(),
        timerDurationSeconds: this.timerDurationSeconds(),
        skipEliminatedPlayers: false,
        activeTrackerIds: ['commander-damage'],
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

    const friendIds = [...new Set(this.playerFriendIds().filter((friendId): friendId is string => friendId !== null))];
    if (friendIds.length === 0) {
      return;
    }

    await Promise.allSettled(friendIds.map((friendId) => firstValueFrom(this.roomsApi.invite(roomId, friendId))));
  }

  private playerNamesForPayload(): string[] {
    if (this.mode() !== 'per-player-device') {
      return this.playerNames();
    }

    return this.playerNames().map((name, index) => {
      if (index === 0) {
        return this.currentUserDisplayName();
      }

      const friendId = this.playerFriendIds()[index];
      const friend = friendId ? this.friends().find((candidate) => candidate.id === friendId) : null;

      return friend?.displayName ?? name;
    });
  }

  private currentUserDisplayName(): string {
    const user = this.auth.user();

    return user?.displayName || user?.email || 'Jugador 1';
  }

  private setTimerDurationParts(minutes: number, seconds: number): void {
    const normalizedMinutes = Math.min(30, Math.max(0, minutes));
    const normalizedSeconds = this.timerSecondOptions.includes(seconds) ? seconds : 0;
    this.timerDurationSeconds.set(Math.max(30, normalizedMinutes * 60 + normalizedSeconds));
  }

  private normalizeWheelNumber(value: string | number): number {
    return Number.parseInt(String(value), 10) || 0;
  }
}
