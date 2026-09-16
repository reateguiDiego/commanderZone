import { ChatMessage } from '../../../../core/models/game.model';
import { GameLogEntryView } from '../state/chat/game-table-chat-log.state';
import { buildGameActivityTimeline } from './game-activity-timeline';

describe('buildGameActivityTimeline', () => {
  it('interleaves chat messages and game actions in chronological order', () => {
    const items = buildGameActivityTimeline(
      [logEntry('log-1', '2026-09-07T18:01:00.000Z')],
      [chatMessage('chat-1', '2026-09-07T18:00:00.000Z'), chatMessage('chat-2', '2026-09-07T18:02:00.000Z')],
    );

    expect(items.map((item) => item.id)).toEqual(['chat:chat-1', 'log:log-1', 'chat:chat-2']);
  });

  it('orders a game action before a chat message when both share a timestamp', () => {
    const items = buildGameActivityTimeline(
      [logEntry('log-1', '2026-09-07T18:00:00.000Z')],
      [chatMessage('chat-1', '2026-09-07T18:00:00.000Z')],
    );

    expect(items.map((item) => item.kind)).toEqual(['log', 'chat']);
  });
});

function logEntry(id: string, createdAt: string): GameLogEntryView {
  return {
    id,
    type: 'game.started',
    message: 'Game started.',
    createdAt,
    actorId: null,
    displayName: null,
    subject: null,
    card: null,
    cardList: [],
    cardListPrefix: '',
    cardListSuffix: '',
    cardListLabel: '',
    messagePrefix: 'Game started.',
    messageSuffix: '',
    appearance: 'default',
  };
}

function chatMessage(id: string, createdAt: string): ChatMessage {
  return {
    id,
    userId: 'player-1',
    displayName: 'Player 1',
    message: 'Hello.',
    createdAt,
  };
}
