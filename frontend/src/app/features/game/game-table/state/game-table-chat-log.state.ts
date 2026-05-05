import { Injectable, signal } from '@angular/core';
import { GameSnapshot } from '../../../../core/models/game.model';

@Injectable()
export class GameTableChatLogState {
  readonly chatMessage = signal('');

  normalizedMessage(): string {
    return this.chatMessage().trim();
  }

  setMessage(value: string): void {
    this.chatMessage.set(value);
  }

  clearMessage(): void {
    this.chatMessage.set('');
  }

  eventLog(snapshot: GameSnapshot | null): Array<GameSnapshot['eventLog'][number]> {
    return [...(snapshot?.eventLog ?? [])].reverse();
  }
}

