import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { DecksApi } from '../../../core/api/decks.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { Deck } from '../../../core/models/deck.model';
import { Room } from '../../../core/models/room.model';
import { AppModalComponent } from '../../../shared/ui/app-modal/app-modal.component';

@Component({
  selector: 'app-rooms',
  imports: [FormsModule, RouterLink, LucideAngularModule, AppModalComponent],
  templateUrl: './rooms.component.html',
  styleUrl: './rooms.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomsComponent {
  private readonly decksApi = inject(DecksApi);
  private readonly roomsApi = inject(RoomsApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly decks = signal<Deck[]>([]);
  readonly rooms = signal<Room[]>([]);
  readonly currentRoom = signal<Room | null>(null);
  readonly error = signal<string | null>(null);
  readonly deletingRoomId = signal<string | null>(null);
  readonly roomPendingDelete = signal<Room | null>(null);
  selectedDeckId = '';
  visibility: 'private' | 'public' = 'private';
  roomId = '';

  constructor() {
    void this.loadDecks();
    void this.loadRooms();
  }

  async loadDecks(): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.list());
      this.decks.set(response.data);
    } catch {
      this.error.set('Could not load decks for room selection.');
    }
  }

  async loadRooms(): Promise<void> {
    try {
      const response = await firstValueFrom(this.roomsApi.list());
      this.rooms.set(response.data);
    } catch {
      this.error.set('Could not load rooms.');
    }
  }

  async createRoom(): Promise<void> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.create(this.optionalDeckId(), this.visibility));
      this.currentRoom.set(response.room);
      this.roomId = response.room.id;
      await this.loadRooms();
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
      await this.loadRooms();
    } catch {
      this.error.set('Could not join room.');
    }
  }

  async joinListedRoom(id: string): Promise<void> {
    this.roomId = id;
    await this.joinRoom();
  }

  async leaveRoom(id: string): Promise<void> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.roomsApi.leave(id));
      this.currentRoom.set(response.room.players.length > 0 ? response.room : null);
      await this.loadRooms();
    } catch {
      this.error.set('Could not leave room.');
    }
  }

  requestDeleteRoom(room: Room): void {
    if (!this.canDeleteRoom(room)) {
      return;
    }

    this.roomPendingDelete.set(room);
  }

  cancelDeleteRoom(): void {
    this.roomPendingDelete.set(null);
  }

  async confirmDeleteRoom(): Promise<void> {
    const room = this.roomPendingDelete();
    if (!room || !this.canDeleteRoom(room)) {
      return;
    }

    this.error.set(null);
    this.deletingRoomId.set(room.id);
    try {
      await firstValueFrom(this.roomsApi.delete(room.id));
      if (this.currentRoom()?.id === room.id) {
        this.currentRoom.set(null);
      }
      if (this.roomId === room.id) {
        this.roomId = '';
      }
      await this.loadRooms();
      this.roomPendingDelete.set(null);
    } catch {
      this.error.set('Could not delete room.');
    } finally {
      this.deletingRoomId.set(null);
    }
  }

  canDeleteRoom(room: Room): boolean {
    return room.status === 'waiting' && room.owner.id === this.auth.user()?.id;
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
