import { Injectable, inject } from '@angular/core';
import { ROLE_OWNER } from '../../../core/auth/user-roles';
import { AuthStore } from '../../../core/auth/auth.store';
import { ChatMessage } from '../../../core/models/game.model';
import { ReportStore } from './report.store';

interface ReportableGamePlayer {
  readonly state: {
    readonly user: {
      readonly id: string;
      readonly displayName: string;
      readonly roles: readonly string[];
    };
  };
}

@Injectable({ providedIn: 'root' })
export class GameReportActionsService {
  private readonly auth = inject(AuthStore);
  private readonly reports = inject(ReportStore);

  canReportPlayer(player: ReportableGamePlayer | null | undefined): boolean {
    const currentUserId = this.auth.user()?.id;
    const reportedUser = player?.state.user;

    return Boolean(
      reportedUser
      && currentUserId
      && reportedUser.id !== currentUserId
      && !reportedUser.roles.includes(ROLE_OWNER),
    );
  }

  canReportChatMessage(message: ChatMessage, players: readonly ReportableGamePlayer[]): boolean {
    if (!message.id) {
      return false;
    }

    const author = players.find((player) => player.state.user.id === message.userId);
    if (author) {
      return this.canReportPlayer(author);
    }

    return message.userId !== this.auth.user()?.id;
  }

  openGamePlayerReport(gameId: string | null, player: ReportableGamePlayer | null | undefined): void {
    if (!gameId || !this.canReportPlayer(player) || !player) {
      return;
    }

    this.reports.open({
      source: 'game_player',
      gameId,
      reportedUserId: player.state.user.id,
      targetDisplayName: player.state.user.displayName,
    });
  }

  openChatMessageReport(gameId: string | null, message: ChatMessage, players: readonly ReportableGamePlayer[]): void {
    if (!gameId || !message.id || !this.canReportChatMessage(message, players)) {
      return;
    }

    this.reports.open({
      source: 'chat_message',
      gameId,
      messageId: message.id,
      targetDisplayName: message.displayName,
    });
  }
}
