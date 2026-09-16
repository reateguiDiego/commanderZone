import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChatMessage, ChatReactionType } from '../../../../../core/models/game.model';

export interface GameChatReactionOption {
  readonly type: ChatReactionType;
  readonly label: string;
  readonly emoji: string;
}

export interface GameChatReactionToggle {
  readonly event: MouseEvent;
  readonly message: ChatMessage;
  readonly reaction: ChatReactionType;
}

interface ReactionUsersTooltip {
  readonly users: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

interface ReactionOverlayPosition {
  readonly right: number;
  readonly top: number;
}

@Component({
  selector: 'app-game-chat-message',
  imports: [RuntimeTranslatePipe],
  templateUrl: './game-chat-message.component.html',
  styleUrl: './game-chat-message.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameChatMessageComponent {
  readonly message = input.required<ChatMessage>();
  readonly activityEntryId = input<string | null>(null);
  readonly isHighlighted = input(false);
  readonly isEvaporating = input(false);
  readonly playerColor = input.required<(playerId: string | null | undefined) => string>();
  readonly logTime = input.required<(createdAt: string) => string>();
  readonly canReact = input.required<(message: ChatMessage) => boolean>();
  readonly reactionOptions = input<readonly GameChatReactionOption[]>([]);
  readonly hasOwnReaction =
    input.required<(message: ChatMessage, reaction: ChatReactionType) => boolean>();
  readonly reactionCount =
    input.required<(message: ChatMessage, reaction: ChatReactionType) => number>();
  readonly reactionUsers =
    input.required<(message: ChatMessage, reaction: ChatReactionType) => string>();
  readonly hasAnyReaction = input.required<(message: ChatMessage) => boolean>();
  readonly shouldShowReactionUsers =
    input.required<(message: ChatMessage, reaction: ChatReactionType) => boolean>();

  readonly reactionToggled = output<GameChatReactionToggle>();
  protected readonly reactionOverlayDismissed = signal(false);
  protected readonly reactionOverlay = signal<ReactionOverlayPosition | null>(null);
  protected readonly reactionUsersTooltip = signal<ReactionUsersTooltip | null>(null);

  showReactionOverlay(event: MouseEvent): void {
    this.reactionOverlayDismissed.set(false);
    this.reactionUsersTooltip.set(null);
    this.positionReactionOverlay(event.currentTarget);
  }

  hideReactionOverlay(): void {
    this.reactionOverlay.set(null);
  }

  toggleReaction(event: MouseEvent, reaction: ChatReactionType): void {
    this.reactionOverlayDismissed.set(true);
    this.reactionOverlay.set(null);
    this.reactionUsersTooltip.set(null);
    this.reactionToggled.emit({ event, message: this.message(), reaction });
  }

  showReactionUsers(event: MouseEvent, reaction: ChatReactionType): void {
    if (!this.shouldShowReactionUsers()(this.message(), reaction)) {
      this.reactionUsersTooltip.set(null);
      return;
    }

    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.reactionOverlay.set(null);
    const messageBody = target?.closest<HTMLElement>('.chat-message-body');
    if (!target || !messageBody) {
      this.reactionUsersTooltip.set(null);
      return;
    }

    const viewportPadding = 12;
    const bodyBounds = messageBody.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const fixedLayerBounds = target
      .closest<HTMLElement>('.floating-expanded-content')
      ?.getBoundingClientRect();
    const width = Math.min(
      Math.max(0, bodyBounds.width - 6.4),
      Math.max(0, window.innerWidth - viewportPadding * 2),
    );
    const left = Math.min(
      Math.max(viewportPadding, bodyBounds.left + 3.2),
      Math.max(viewportPadding, window.innerWidth - viewportPadding - width),
    );

    this.reactionUsersTooltip.set({
      users: this.reactionUsers()(this.message(), reaction),
      left: left - (fixedLayerBounds?.left ?? 0),
      top: targetBounds.bottom + 4.48 - (fixedLayerBounds?.top ?? 0),
      width,
    });
  }

  hideReactionUsers(event: MouseEvent): void {
    this.reactionUsersTooltip.set(null);
    if (!this.reactionOverlayDismissed()) {
      this.positionReactionOverlay(event.currentTarget);
    }
  }

  private positionReactionOverlay(anchor: EventTarget | null): void {
    const entry = anchor instanceof HTMLElement ? anchor.closest<HTMLElement>('.chat-entry') : null;
    const messageBody = entry?.querySelector<HTMLElement>('.chat-message-body');
    if (!entry || !messageBody || !this.canReact()(this.message())) {
      this.reactionOverlay.set(null);
      return;
    }

    const bodyBounds = messageBody.getBoundingClientRect();
    const fixedLayerBounds = entry
      .closest<HTMLElement>('.floating-expanded-content')
      ?.getBoundingClientRect();
    const fixedLayerRight = fixedLayerBounds?.right ?? window.innerWidth;
    const fixedLayerTop = fixedLayerBounds?.top ?? 0;

    this.reactionOverlay.set({
      right: Math.max(0, fixedLayerRight - bodyBounds.right),
      top: bodyBounds.bottom - fixedLayerTop,
    });
  }
}
