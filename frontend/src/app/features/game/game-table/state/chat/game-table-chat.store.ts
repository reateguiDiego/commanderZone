import { computed, inject, Injectable } from '@angular/core';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { ChatRecipientOption } from '../../models/game-table-chat.model';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameLogEntryView, GameTableChatLogState } from './game-table-chat-log.state';
import { GameTableSnapshotSelectors, PlayerView } from '../core/game-table-snapshot-selectors';
import { playerIsDefeated } from '../../utils/game-player-defeat';
import { runtimeTranslationFallback } from '../../../../../core/localization/runtime-translate.pipe';

@Injectable()
export class GameTableChatStore {
  private readonly auth = inject(AuthStore);
  private readonly chatLogState = inject(GameTableChatLogState);
  private readonly core = inject(GameTableCoreState);
  private readonly selectors = inject(GameTableSnapshotSelectors);

  readonly chatMessage = this.chatLogState.chatMessage;
  readonly chatTargetPlayerId = this.chatLogState.chatTargetPlayerId;
  readonly eventLog = computed<GameLogEntryView[]>(() => this.chatLogState.eventLogView(this.core.snapshot(), this.core.zones));
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
      { playerId: null, label: runtimeTranslationFallback('game.chat.allPlayers') },
      ...opponents,
    ];
  }
}
