import { ChatMessage } from '../../../../core/models/game.model';
import { GameLogEntryView } from '../state/chat/game-table-chat-log.state';

export type GameActivityTimelineItem =
  | {
      readonly id: string;
      readonly kind: 'chat';
      readonly createdAt: string;
      readonly message: ChatMessage;
      readonly sourceIndex: number;
    }
  | {
      readonly id: string;
      readonly kind: 'log';
      readonly createdAt: string;
      readonly entry: GameLogEntryView;
    };

export function buildGameActivityTimeline(
  logEntries: readonly GameLogEntryView[],
  chatMessages: readonly ChatMessage[],
): readonly GameActivityTimelineItem[] {
  return [
    ...logEntries.map((entry) => ({
      id: `log:${entry.id}`,
      kind: 'log' as const,
      createdAt: entry.createdAt,
      entry,
    })),
    ...chatMessages.map((message, sourceIndex) => ({
      id: `chat:${message.id ?? `${message.createdAt}:${message.userId}:${sourceIndex}`}`,
      kind: 'chat' as const,
      createdAt: message.createdAt,
      message,
      sourceIndex,
    })),
  ].sort(compareTimelineItems);
}

function compareTimelineItems(left: GameActivityTimelineItem, right: GameActivityTimelineItem): number {
  const timestampDifference = timestampFor(left.createdAt) - timestampFor(right.createdAt);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  if (left.kind !== right.kind) {
    return left.kind === 'log' ? -1 : 1;
  }

  return left.id.localeCompare(right.id);
}

function timestampFor(value: string): number {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}
