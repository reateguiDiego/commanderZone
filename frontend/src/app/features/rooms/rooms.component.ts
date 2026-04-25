import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { DecksApi } from '../../core/api/decks.api';
import { RoomsApi } from '../../core/api/rooms.api';
import { Deck } from '../../core/models/deck.model';
import { Room } from '../../core/models/room.model';

@Component({
  selector: 'app-rooms',
  imports: [FormsModule, RouterLink, LucideAngularModule],
  template: `
    <section class="page-stack">
      <div class="tool-header">
        <div>
          <span class="eyebrow">Rooms</span>
          <h2>Create or join</h2>
        </div>
      </div>

      @if (error()) {
        <p class="notice error">{{ error() }}</p>
      }

      <div class="room-layout">
        <section class="panel form-stack">
          <label>
            Deck
            <select name="deckId" [(ngModel)]="selectedDeckId">
              <option value="">No deck</option>
              @for (deck of decks(); track deck.id) {
                <option [value]="deck.id">{{ deck.name }}</option>
              }
            </select>
          </label>

          <button class="primary-button" type="button" (click)="createRoom()">
            <lucide-icon name="plus" size="17" />
            Create room
          </button>

          <label>
            Room id
            <input name="roomId" placeholder="Paste room id" [(ngModel)]="roomId" />
          </label>
          <button class="secondary-button" type="button" (click)="joinRoom()">
            <lucide-icon name="door-open" size="17" />
            Join room
          </button>
        </section>

        <section class="panel">
          @if (currentRoom(); as room) {
            <div class="room-header">
              <span class="eyebrow">Current room</span>
              <strong>{{ room.id }}</strong>
              <small>Status: {{ room.status }}</small>
            </div>

            <div class="dense-list compact-list">
              @for (player of room.players; track player.id) {
                <div class="list-row">
                  <span>
                    <strong>{{ player.user.displayName }}</strong>
                    <small>{{ player.deckId || 'No deck selected' }}</small>
                  </span>
                  @if (room.owner.id === player.user.id) {
                    <span class="metric">owner</span>
                  }
                </div>
              }
            </div>

            <div class="button-row">
              <button class="primary-button compact" type="button" (click)="startRoom(room.id)">
                <lucide-icon name="play" size="16" />
                Start game
              </button>
              <button class="secondary-button compact" type="button" (click)="leaveRoom(room.id)">
                <lucide-icon name="log-out" size="16" />
                Leave
              </button>
              @if (room.gameId) {
                <a class="secondary-button compact" [routerLink]="['/games', room.gameId]">Open game</a>
              }
            </div>
          } @else {
            <p class="notice">Create a room or paste a room id to join. There is no room listing endpoint yet.</p>
          }
        </section>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomsComponent {
  private readonly decksApi = inject(DecksApi);
  private readonly roomsApi = inject(RoomsApi);
  private readonly router = inject(Router);

  readonly decks = signal<Deck[]>([]);
  readonly currentRoom = signal<Room | null>(null);
  readonly error = signal<string | null>(null);
  selectedDeckId = '';
  roomId = '';

  constructor() {
    void this.loadDecks();
  }

  async loadDecks(): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.list());
      this.decks.set(response.data);
    } catch {
      this.error.set('Could not load decks for room selection.');
    }
  }

  async createRoom(): Promise<void> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.create(this.optionalDeckId()));
      this.currentRoom.set(response.room);
      this.roomId = response.room.id;
    } catch {
      this.error.set('Could not create room.');
    }
  }

  async joinRoom(): Promise<void> {
    const id = this.roomId.trim();
    if (!id) {
      return;
    }

    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.join(id, this.optionalDeckId()));
      this.currentRoom.set(response.room);
    } catch {
      this.error.set('Could not join room.');
    }
  }

  async leaveRoom(id: string): Promise<void> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.leave(id));
      this.currentRoom.set(response.room.players.length > 0 ? response.room : null);
    } catch {
      this.error.set('Could not leave room.');
    }
  }

  async startRoom(id: string): Promise<void> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.start(id));
      this.currentRoom.set(response.room);
      await this.router.navigate(['/games', response.game.id]);
    } catch {
      this.error.set('Could not start game. The owner needs at least two players.');
    }
  }

  private optionalDeckId(): string | undefined {
    return this.selectedDeckId || undefined;
  }
}
