import { TestBed } from '@angular/core/testing';
import { ChatMessage } from '../../../../core/models/game.model';
import { GameTableChatReadStateService } from './game-table-chat-read-state.service';

describe('GameTableChatReadStateService', () => {
  let service: GameTableChatReadStateService;

  beforeEach(() => {
    window.localStorage.clear();
    TestBed.configureTestingModule({
      providers: [GameTableChatReadStateService],
    });
    service = TestBed.inject(GameTableChatReadStateService);
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('persists read public messages by game and player', () => {
    const context = readContext([
      message('user-2', 'Public one', null, '2026-04-30T20:03:00+00:00'),
    ]);

    expect(service.latestUnreadMessageKey(context)).not.toBeNull();

    service.markRead(context);

    expect(service.hasStoredReadKey(context)).toBe(true);
    expect(service.latestUnreadMessageKey(context)).toBeNull();
  });

  it('tracks private messages for the targeted player without treating own messages as unread', () => {
    const context = readContext([
      message('user-1', 'Own private', 'user-2', '2026-04-30T20:02:00+00:00'),
      message('user-2', 'Private one', 'user-1', '2026-04-30T20:03:00+00:00'),
    ]);

    service.markRead(context);
    const nextContext = readContext([
      ...context.messages,
      message('user-1', 'Own public', null, '2026-04-30T20:04:00+00:00'),
      message('user-2', 'Private two', 'user-1', '2026-04-30T20:05:00+00:00'),
    ]);

    expect(service.latestUnreadMessageKey(nextContext)).not.toBeNull();
  });
});

function readContext(messages: readonly ChatMessage[]) {
  return {
    gameId: 'game-1',
    currentPlayerId: 'user-1',
    currentUserId: 'user-1',
    messages,
  };
}

function message(userId: string, text: string, targetPlayerId: string | null, createdAt: string): ChatMessage {
  return {
    userId,
    displayName: userId,
    message: text,
    targetPlayerId,
    targetDisplayName: targetPlayerId,
    createdAt,
  };
}
