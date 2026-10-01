import { computed, inject, Injectable } from '@angular/core';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
import { ChatRecipientOption } from '../../models/game-table-chat.model';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameLogEntryView, GameTableChatLogState } from './game-table-chat-log.state';
import { GameTableSnapshotSelectors, PlayerView } from '../core/game-table-snapshot-selectors';
import { playerIsDefeated } from '../../utils/game-player-defeat';

const EVENT_LOG_MEMO_STORAGE_KEY = 'cz_perf_event_log_memo';
const EVENT_LOG_PRESENTATION_ZONES = [
  'library',
  'hand',
  'battlefield',
  'graveyard',
  'exile',
  'command',
] as const satisfies readonly GameZoneName[];

@Injectable()
export class GameTableChatStore {
  private readonly auth = inject(AuthStore);
  private readonly chatLogState = inject(GameTableChatLogState);
  private readonly core = inject(GameTableCoreState);
  private readonly selectors = inject(GameTableSnapshotSelectors);
  private readonly eventLogMemoEnabled =
    typeof window !== 'undefined'
    && window.localStorage.getItem(EVENT_LOG_MEMO_STORAGE_KEY) === '1';
  private readonly eventLogPresentationSnapshot = computed(
    () => this.core.snapshot(),
    {
      equal: (previous, next) => this.eventLogMemoEnabled
        && sameEventLogPresentationSnapshot(previous, next),
    },
  );

  readonly chatMessage = this.chatLogState.chatMessage;
  readonly chatTargetPlayerId = this.chatLogState.chatTargetPlayerId;
  readonly eventLog = computed<GameLogEntryView[]>(() => this.chatLogState.eventLogView(
    this.eventLogMemoEnabled ? this.eventLogPresentationSnapshot() : this.core.snapshot(),
    this.core.zones,
  ));
  readonly chatRecipients = computed<ChatRecipientOption[]>(() => this.chatRecipientOptions());
  readonly shouldShowChatRecipientSelect = computed(() => this.chatRecipients().length > 1);
  setChatMessage(value: string): void {
    this.chatLogState.setMessage(value);
  }

  setChatTargetPlayerId(value: string | null): void {
    this.chatLogState.setTargetPlayerId(value);
  }

  selectedChatTargetValue(): string {
    return this.selectedChatTargetPlayerId() ?? 'all';
  }

  selectedChatTargetPlayerId(): string | null {
    const recipients = this.chatRecipients();
    if (recipients.length === 0) {
      return null;
    }

    const current = this.chatLogState.chatTargetPlayerId();

    return recipients.some((recipient) => recipient.playerId === current) ? current : recipients[0]?.playerId ?? null;
  }

  normalizedMessage(): string {
    return this.chatLogState.normalizedMessage();
  }

  clearMessage(): void {
    this.chatLogState.clearMessage();
  }

  logTime(createdAt: string): string {
    return this.selectors.logTime(createdAt);
  }

  private chatRecipientOptions(): ChatRecipientOption[] {
    const players = this.core.snapshot()?.players ?? {};
    const currentPlayerId = Object.entries(players).find(([, player]) => player.user.id === this.auth.user()?.id)?.[0] ?? null;
    const opponents = Object.entries(players)
      .filter(([playerId]) => playerId !== currentPlayerId)
      .filter(([playerId, player]) => !playerIsDefeated({ id: playerId, state: player } as PlayerView))
      .map(([playerId, player]) => ({
        playerId,
        label: player.user.displayName,
      }));

    if (Object.keys(players).length === 2) {
      return opponents;
    }

    return [
      { playerId: null, labelKey: 'game.chat.allPlayers' },
      ...opponents,
    ];
  }
}

/**
 * Log presentation reads player names and card content, but never a card's
 * battlefield coordinates. A local pointer drag copies only `position`, so
 * retaining the prior snapshot here prevents the full log pipeline from
 * rebuilding while preserving every field that can affect an entry.
 */
function sameEventLogPresentationSnapshot(
  previous: GameSnapshot | null,
  next: GameSnapshot | null,
): boolean {
  if (previous === next) {
    return true;
  }

  if (!previous || !next || previous.eventLog !== next.eventLog) {
    return false;
  }

  if (previous.players === next.players) {
    return true;
  }

  const previousPlayerIds = Object.keys(previous.players);
  const nextPlayerIds = Object.keys(next.players);
  if (previousPlayerIds.length !== nextPlayerIds.length) {
    return false;
  }

  return previousPlayerIds.every((playerId) => {
    const previousPlayer = previous.players[playerId];
    const nextPlayer = next.players[playerId];

    if (!previousPlayer || !nextPlayer) {
      return false;
    }

    if (previousPlayer === nextPlayer) {
      return true;
    }

    return previousPlayer.user.displayName === nextPlayer.user.displayName
      && sameEventLogPresentationCards(previousPlayer.zones, nextPlayer.zones);
  });
}

function sameEventLogPresentationCards(
  previousZones: GameSnapshot['players'][string]['zones'],
  nextZones: GameSnapshot['players'][string]['zones'],
): boolean {
  if (previousZones === nextZones) {
    return true;
  }

  return EVENT_LOG_PRESENTATION_ZONES.every((zone) => {
    const previousCards = previousZones[zone];
    const nextCards = nextZones[zone];

    if (previousCards === nextCards) {
      return true;
    }

    return previousCards.length === nextCards.length
      && previousCards.every((card, index) => sameCardOutsidePosition(card, nextCards[index]));
  });
}

function sameCardOutsidePosition(
  previous: GameCardInstance,
  next: GameCardInstance | undefined,
): boolean {
  if (!next) {
    return false;
  }

  if (previous === next) {
    return true;
  }

  const previousRecord = previous as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  const previousKeys = Object.keys(previousRecord).filter((key) => key !== 'position');
  const nextKeys = Object.keys(nextRecord).filter((key) => key !== 'position');

  return previousKeys.length === nextKeys.length
    && previousKeys.every((key) => Object.is(previousRecord[key], nextRecord[key]));
}
