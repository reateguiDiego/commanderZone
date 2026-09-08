import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, ViewChild, input, output, signal } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChatMessage, ChatReactionType, GameCardInstance } from '../../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameActivityTimelineItem } from '../../utils/game-activity-timeline';

export interface GameActivityReactionOption {
  readonly type: ChatReactionType;
  readonly label: string;
  readonly emoji: string;
}

interface CardListPopover {
  readonly names: readonly string[];
  readonly left: number;
  readonly top: number;
}

interface ScrollAnchor {
  readonly entryId: string;
  readonly top: number;
}

@Component({
  selector: 'app-game-activity-panel',
  imports: [PrettyScrollDirective, RuntimeTranslatePipe],
  templateUrl: './game-activity-panel.component.html',
  styleUrl: './game-activity-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameActivityPanelComponent implements AfterViewChecked {
  readonly items = input.required<readonly GameActivityTimelineItem[]>();
  readonly highlightedLogEntryIds = input<readonly string[]>([]);
  readonly fadingLogEntryIds = input<readonly string[]>([]);
  readonly isChatMessageHighlighted = input.required<(message: ChatMessage, sourceIndex: number) => boolean>();
  readonly isChatMessageEvaporating = input.required<(message: ChatMessage, sourceIndex: number) => boolean>();
  readonly playerColor = input.required<(playerId: string) => string>();
  readonly logTime = input.required<(createdAt: string) => string>();
  readonly canReactToChatMessage = input.required<(message: ChatMessage) => boolean>();
  readonly reactionOptions = input<readonly GameActivityReactionOption[]>([]);
  readonly hasOwnChatReaction = input.required<(message: ChatMessage, reaction: ChatReactionType) => boolean>();
  readonly chatReactionCount = input.required<(message: ChatMessage, reaction: ChatReactionType) => number>();
  readonly chatReactionUsers = input.required<(message: ChatMessage, reaction: ChatReactionType) => string>();
  readonly hasAnyChatReaction = input.required<(message: ChatMessage) => boolean>();
  readonly shouldShowChatReactionUsers = input.required<(message: ChatMessage, reaction: ChatReactionType) => boolean>();
  readonly loadingOlder = input(false);
  readonly loadingNewer = input(false);
  readonly canLoadOlder = input(false);
  readonly canLoadNewer = input(false);

  readonly previewCard = output<GameCardInstance>();
  readonly hidePreview = output<void>();
  readonly loadOlder = output<void>();
  readonly loadNewer = output<void>();
  readonly reactionToggled = output<{ event: MouseEvent; message: ChatMessage; reaction: ChatReactionType }>();
  readonly activeCardListPopover = signal<CardListPopover | null>(null);

  @ViewChild('feed') private readonly feed?: ElementRef<HTMLElement>;

  private pendingHistoryAnchor: ScrollAnchor | null = null;

  ngAfterViewChecked(): void {
    if (this.pendingHistoryAnchor === null || this.loadingOlder() || this.loadingNewer()) {
      return;
    }

    const element = this.feed?.nativeElement;
    const anchor = element ? this.findActivityEntry(element, this.pendingHistoryAnchor.entryId) : null;
    if (element && anchor) {
      element.scrollTop += anchor.getBoundingClientRect().top - this.pendingHistoryAnchor.top;
    }
    this.pendingHistoryAnchor = null;
  }

  showCardListPopover(event: MouseEvent | FocusEvent, names: readonly string[]): void {
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!target || names.length === 0) {
      this.activeCardListPopover.set(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const viewportPadding = 12;
    this.activeCardListPopover.set({
      names,
      left: Math.min(Math.max(viewportPadding, rect.left), Math.max(viewportPadding, window.innerWidth - 300 - viewportPadding)),
      top: Math.min(rect.bottom + 8, Math.max(viewportPadding, window.innerHeight - 230)),
    });
  }

  hideCardListPopover(): void {
    this.activeCardListPopover.set(null);
  }

  scrollToBottom(): void {
    const element = this.feed?.nativeElement;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }

  onFeedScroll(): void {
    const element = this.feed?.nativeElement;
    if (!element) {
      return;
    }

    if (element.scrollTop <= 72 && this.canLoadOlder()) {
      this.captureHistoryAnchor(element);
      this.loadOlder.emit();
      return;
    }

    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 72 && this.canLoadNewer()) {
      this.captureHistoryAnchor(element);
      this.loadNewer.emit();
    }
  }

  private captureHistoryAnchor(feed: HTMLElement): void {
    const anchor = this.firstVisibleActivityEntry(feed);
    if (!anchor) {
      return;
    }

    this.pendingHistoryAnchor = {
      entryId: anchor.dataset['activityEntryId'] ?? '',
      top: anchor.getBoundingClientRect().top,
    };
  }

  private firstVisibleActivityEntry(feed: HTMLElement): HTMLElement | null {
    const feedTop = feed.getBoundingClientRect().top;

    return Array.from(feed.querySelectorAll<HTMLElement>('[data-activity-entry-id]'))
      .find((entry) => entry.getBoundingClientRect().bottom >= feedTop) ?? null;
  }

  private findActivityEntry(feed: HTMLElement, entryId: string): HTMLElement | null {
    return Array.from(feed.querySelectorAll<HTMLElement>('[data-activity-entry-id]'))
      .find((entry) => entry.dataset['activityEntryId'] === entryId) ?? null;
  }
}
