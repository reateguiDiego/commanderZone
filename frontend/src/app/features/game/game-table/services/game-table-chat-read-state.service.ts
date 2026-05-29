import { Injectable } from '@angular/core';
import { ChatMessage } from '../../../../core/models/game.model';

export interface GameTableChatReadContext {
  readonly gameId: string;
  readonly currentPlayerId: string;
  readonly currentUserId: string;
  readonly messages: readonly ChatMessage[];
}

interface ReadableChatMessage {
  readonly key: string;
  readonly message: ChatMessage;
}

@Injectable()
export class GameTableChatReadStateService {
  private readonly storagePrefix = 'commanderZone:game-chat-read:v1';

  hasStoredReadKey(context: GameTableChatReadContext): boolean {
    return this.readKey(context) !== null;
  }

  latestUnreadMessageKey(context: GameTableChatReadContext): string | null {
    return this.unreadMessageKeys(context).at(-1) ?? null;
  }

  unreadMessageKeys(context: GameTableChatReadContext): string[] {
    const incomingMessages = this.incomingMessages(context);
    const latestIncomingKey = incomingMessages.at(-1)?.key ?? null;
    if (!latestIncomingKey) {
      return [];
    }

    const readKey = this.readKey(context);
    if (!readKey) {
      return incomingMessages.map((message) => message.key);
    }

    const readIndex = incomingMessages.findIndex((message) => message.key === readKey);
    if (readIndex < 0) {
      return incomingMessages.map((message) => message.key);
    }

    return incomingMessages.slice(readIndex + 1).map((message) => message.key);
  }

  markRead(context: GameTableChatReadContext): void {
    const latestKey = this.incomingMessages(context).at(-1)?.key ?? null;
    if (!latestKey) {
      return;
    }

    this.writeReadKey(context, latestKey);
  }

  private incomingMessages(context: GameTableChatReadContext): ReadableChatMessage[] {
    return context.messages
      .map((message, index) => ({
        key: this.messageKey(message, index),
        message,
      }))
      .filter(({ message }) => this.isVisibleToCurrentPlayer(message, context))
      .filter(({ message }) => !this.isOwnMessage(message, context));
  }

  private isVisibleToCurrentPlayer(message: ChatMessage, context: GameTableChatReadContext): boolean {
    const targetPlayerId = message.targetPlayerId ?? null;

    return targetPlayerId === null
      || targetPlayerId === context.currentPlayerId
      || targetPlayerId === context.currentUserId
      || this.isOwnMessage(message, context);
  }

  private isOwnMessage(message: ChatMessage, context: GameTableChatReadContext): boolean {
    return message.userId === context.currentUserId || message.userId === context.currentPlayerId;
  }

  messageKey(message: ChatMessage, index: number): string {
    if (message.id) {
      return message.id;
    }

    return [
      index,
      message.createdAt,
      message.userId,
      message.targetPlayerId ?? 'all',
      message.message,
    ].join('|');
  }

  private readKey(context: GameTableChatReadContext): string | null {
    try {
      return globalThis.localStorage?.getItem(this.storageKey(context)) ?? null;
    } catch {
      return null;
    }
  }

  private writeReadKey(context: GameTableChatReadContext, key: string): void {
    try {
      globalThis.localStorage?.setItem(this.storageKey(context), key);
    } catch {
      // Local storage can be disabled; unread state still works for the current component lifetime.
    }
  }

  private storageKey(context: GameTableChatReadContext): string {
    return [
      this.storagePrefix,
      encodeURIComponent(context.gameId),
      encodeURIComponent(context.currentPlayerId),
    ].join(':');
  }
}
