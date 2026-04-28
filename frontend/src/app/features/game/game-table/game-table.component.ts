import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../core/models/game.model';
import { MercureService } from '../../../core/realtime/mercure.service';

interface PlayerView {
  id: string;
  state: GameSnapshot['players'][string];
}

interface SelectedCard {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

@Component({
  selector: 'app-game-table',
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './game-table.component.html',
  styleUrl: './game-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameTableComponent implements OnDestroy {
  private readonly gamesApi = inject(GamesApi);
  private readonly mercure = inject(MercureService);
  private readonly route = inject(ActivatedRoute);
  private realtimeSubscription?: Subscription;

  readonly zones: GameZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
  readonly phases = ['beginning', 'precombat-main', 'combat', 'postcombat-main', 'ending'];
  readonly gameId = signal(this.route.snapshot.paramMap.get('id') ?? '');
  readonly snapshot = signal<GameSnapshot | null>(null);
  readonly selectedCard = signal<SelectedCard | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly players = computed<PlayerView[]>(() => {
    const players = this.snapshot()?.players ?? {};
    return Object.entries(players).map(([id, state]) => ({ id, state }));
  });

  chatMessage = '';

  constructor() {
    void this.load();
  }

  ngOnDestroy(): void {
    this.realtimeSubscription?.unsubscribe();
  }

  zoneTitle(zone: GameZoneName): string {
    const titles: Record<GameZoneName, string> = {
      library: 'Library',
      hand: 'Hand',
      battlefield: 'Battlefield',
      graveyard: 'Graveyard',
      exile: 'Exile',
      command: 'Command',
    };

    return titles[zone];
  }

  selectCard(playerId: string, zone: GameZoneName, card: GameCardInstance): void {
    this.selectedCard.set({ playerId, zone, card });
  }

  isSelected(playerId: string, zone: GameZoneName, instanceId: string): boolean {
    const selected = this.selectedCard();
    return selected?.playerId === playerId && selected.zone === zone && selected.card.instanceId === instanceId;
  }

  commanderDamage(targetPlayerId: string, sourcePlayerId: string): number {
    return this.snapshot()?.players[targetPlayerId]?.commanderDamage[sourcePlayerId] ?? 0;
  }

  async changeLife(playerId: string, delta: number): Promise<void> {
    await this.sendCommand('life.changed', { playerId, delta });
  }

  async setLife(playerId: string, life: string): Promise<void> {
    await this.sendCommand('life.changed', { playerId, life: Number(life) });
  }

  async setCommanderDamage(targetPlayerId: string, sourcePlayerId: string, damage: string): Promise<void> {
    await this.sendCommand('commander.damage.changed', {
      targetPlayerId,
      sourcePlayerId,
      damage: Number(damage),
    });
  }

  async tapSelected(tapped: boolean): Promise<void> {
    const selected = this.selectedCard();
    if (!selected) {
      return;
    }

    await this.sendCommand('card.tapped', {
      playerId: selected.playerId,
      instanceId: selected.card.instanceId,
      tapped,
    });
  }

  async moveSelected(toZoneValue: string): Promise<void> {
    const selected = this.selectedCard();
    const toZone = toZoneValue as GameZoneName;
    if (!selected || !this.zones.includes(toZone) || selected.zone === toZone) {
      return;
    }

    await this.sendCommand('card.moved', {
      playerId: selected.playerId,
      fromZone: selected.zone,
      toZone,
      instanceId: selected.card.instanceId,
    });
    this.selectedCard.set(null);
  }

  async changeTurnPlayer(activePlayerId: string): Promise<void> {
    await this.sendCommand('turn.changed', { activePlayerId });
  }

  async changePhase(phase: string): Promise<void> {
    await this.sendCommand('turn.changed', { phase });
  }

  async changeTurnNumber(number: string | number): Promise<void> {
    await this.sendCommand('turn.changed', { number: Number(number) });
  }

  async sendChat(): Promise<void> {
    const message = this.chatMessage.trim();
    if (!message) {
      return;
    }

    await this.sendCommand('chat.message', { message });
    this.chatMessage = '';
  }

  private async load(): Promise<void> {
    const id = this.gameId();
    if (!id) {
      this.error.set('Missing game id.');
      this.loading.set(false);
      return;
    }

    try {
      const response = await firstValueFrom(this.gamesApi.snapshot(id));
      this.snapshot.set(response.game.snapshot);
      this.subscribeToRealtime(id);
    } catch {
      this.error.set('Could not load game snapshot.');
    } finally {
      this.loading.set(false);
    }
  }

  private subscribeToRealtime(gameId: string): void {
    this.realtimeSubscription?.unsubscribe();
    this.realtimeSubscription = this.mercure.gameEvents(gameId).subscribe({
      next: (event) => this.snapshot.set(event.snapshot),
      error: () => this.error.set('Realtime connection lost. Commands still update after POST responses.'),
    });
  }

  private async sendCommand(type: Parameters<GamesApi['command']>[0]['type'], payload: Record<string, unknown>): Promise<void> {
    const id = this.gameId();
    if (!id) {
      return;
    }

    const response = await firstValueFrom(this.gamesApi.command({ type, payload }, id));
    this.snapshot.set(response.snapshot);
  }
}
