import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, firstValueFrom } from 'rxjs';
import { GamesApi } from '../../core/api/games.api';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../core/models/game.model';
import { MercureService } from '../../core/realtime/mercure.service';

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
  template: `
    <section class="game-screen">
      <header class="game-topbar">
        <div>
          <span class="eyebrow">Game</span>
          <h2>{{ gameId() }}</h2>
        </div>
        @if (snapshot(); as snapshot) {
          <div class="turn-controls">
            <select name="activePlayer" [ngModel]="snapshot.turn.activePlayerId" (ngModelChange)="changeTurnPlayer($event)">
              @for (player of players(); track player.id) {
                <option [value]="player.id">{{ player.state.user.displayName }}</option>
              }
            </select>
            <select name="phase" [ngModel]="snapshot.turn.phase" (ngModelChange)="changePhase($event)">
              @for (phase of phases; track phase) {
                <option [value]="phase">{{ phase }}</option>
              }
            </select>
            <input
              class="turn-number"
              type="number"
              min="1"
              [ngModel]="snapshot.turn.number"
              (ngModelChange)="changeTurnNumber($event)"
              aria-label="Turn number"
            />
          </div>
        }
      </header>

      @if (loading()) {
        <p class="notice">Loading game snapshot...</p>
      } @else if (error()) {
        <p class="notice error">{{ error() }}</p>
      } @else if (snapshot(); as snapshot) {
        <div class="game-layout">
          <main class="battle-table">
            @for (player of players(); track player.id) {
              <section class="player-board" [class.active]="snapshot.turn.activePlayerId === player.id">
                <header class="player-header">
                  <div>
                    <strong>{{ player.state.user.displayName }}</strong>
                    <small>{{ snapshot.turn.activePlayerId === player.id ? 'Active player' : 'Waiting' }}</small>
                  </div>
                  <div class="life-control">
                    <button type="button" (click)="changeLife(player.id, -1)">-</button>
                    <input #lifeInput type="number" [value]="player.state.life" />
                    <button type="button" (click)="changeLife(player.id, 1)">+</button>
                    <button type="button" (click)="setLife(player.id, lifeInput.value)">Set</button>
                  </div>
                </header>

                <div class="zones-grid">
                  @for (zone of zones; track zone) {
                    <section class="zone-panel" [class.primary-zone]="zone === 'battlefield'">
                      <header>
                        <strong>{{ zoneTitle(zone) }}</strong>
                        <span>{{ player.state.zones[zone].length }}</span>
                      </header>
                      <div class="zone-cards">
                        @for (card of player.state.zones[zone]; track card.instanceId) {
                          <button
                            type="button"
                            class="table-card"
                            [class.tapped]="card.tapped"
                            [class.selected]="isSelected(player.id, zone, card.instanceId)"
                            (click)="selectCard(player.id, zone, card)"
                          >
                            <span>{{ card.name }}</span>
                          </button>
                        }
                      </div>
                    </section>
                  }
                </div>

                <section class="commander-damage">
                  <strong>Commander damage received</strong>
                  <div class="damage-grid">
                    @for (source of players(); track source.id) {
                      <label>
                        <span>{{ source.state.user.displayName }}</span>
                        <input #damageInput type="number" min="0" [value]="commanderDamage(player.id, source.id)" />
                        <button type="button" (click)="setCommanderDamage(player.id, source.id, damageInput.value)">Set</button>
                      </label>
                    }
                  </div>
                </section>
              </section>
            }
          </main>

          <aside class="game-side">
            @if (selectedCard(); as selected) {
              <section class="panel selected-panel">
                <span class="eyebrow">Selected card</span>
                <strong>{{ selected.card.name }}</strong>
                <small>{{ zoneTitle(selected.zone) }}</small>
                <div class="button-row">
                  <button class="secondary-button compact" type="button" (click)="tapSelected(!selected.card.tapped)">
                    <lucide-icon name="rotate-cw" size="16" />
                    {{ selected.card.tapped ? 'Untap' : 'Tap' }}
                  </button>
                </div>
                <div class="inline-form">
                  <select #moveZone>
                    @for (zone of zones; track zone) {
                      <option [value]="zone">{{ zoneTitle(zone) }}</option>
                    }
                  </select>
                  <button class="primary-button compact" type="button" (click)="moveSelected(moveZone.value)">Move</button>
                </div>
              </section>
            }

            <section class="panel chat-panel">
              <header>
                <lucide-icon name="message-square" size="18" />
                <strong>Chat</strong>
              </header>
              <div class="chat-log">
                @for (message of snapshot.chat; track message.createdAt + message.userId) {
                  <p>
                    <strong>{{ message.displayName }}</strong>
                    <span>{{ message.message }}</span>
                  </p>
                }
              </div>
              <form class="chat-form" (ngSubmit)="sendChat()">
                <input name="chatMessage" placeholder="Message" [(ngModel)]="chatMessage" />
                <button class="icon-button" type="submit" title="Send chat">
                  <lucide-icon name="send" size="17" />
                </button>
              </form>
            </section>
          </aside>
        </div>
      }
    </section>
  `,
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
