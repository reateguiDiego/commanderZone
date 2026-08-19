import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, ViewChild, input, output, signal } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameLogEntryView } from '../../state/chat/game-table-chat-log.state';

interface CardListPopover {
  readonly names: readonly string[];
  readonly left: number;
  readonly top: number;
}

interface LogScrollAnchor {
  readonly entryId: string;
  readonly top: number;
}

@Component({
  selector: 'app-game-log-panel',
  imports: [PrettyScrollDirective, RuntimeTranslatePipe],
  templateUrl: './game-log-panel.component.html',
  styleUrl: './game-log-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameLogPanelComponent implements AfterViewChecked {
  readonly entries = input.required<ReadonlyArray<GameLogEntryView>>();
  readonly highlightedEntryIds = input<readonly string[]>([]);
  readonly fadingEntryIds = input<readonly string[]>([]);
  readonly loadingOlder = input(false);
  readonly loadingNewer = input(false);
  readonly canLoadOlder = input(false);
  readonly canLoadNewer = input(false);
  readonly playerColor = input<(playerId: string) => string>(() => '');
  readonly logTime = input.required<(createdAt: string) => string>();
  readonly previewCard = output<GameCardInstance>();
  readonly hidePreview = output<void>();
  readonly loadOlder = output<void>();
  readonly loadNewer = output<void>();
  readonly activeCardListPopover = signal<CardListPopover | null>(null);

  @ViewChild('feed') private readonly feed?: ElementRef<HTMLElement>;

  private pendingHistoryAnchor: LogScrollAnchor | null = null;

  ngAfterViewChecked(): void {
    if (this.pendingHistoryAnchor !== null) {
      if (!this.loadingOlder() && !this.loadingNewer()) {
        const element = this.feed?.nativeElement;
        const anchor = element ? this.findLogEntry(element, this.pendingHistoryAnchor.entryId) : null;
        if (element && anchor) {
          element.scrollTop += anchor.getBoundingClientRect().top - this.pendingHistoryAnchor.top;
        }
        this.pendingHistoryAnchor = null;
      }
      return;
    }
  }

  showCardListPopover(event: MouseEvent | FocusEvent, names: readonly string[]): void {
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!target || names.length === 0) {
      this.activeCardListPopover.set(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const viewportPadding = 12;
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - 300 - viewportPadding),
    );
    const top = Math.min(rect.bottom + 8, Math.max(viewportPadding, window.innerHeight - 230));
    this.activeCardListPopover.set({ names, left, top });
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
    if (!element || element.scrollTop > 72 || !this.canLoadOlder()) {
      this.loadNewerWhenNearBottom(element);
      return;
    }

    const anchor = this.firstVisibleLogEntry(element);
    if (!anchor) {
      return;
    }

    this.captureHistoryAnchor(anchor);
    this.loadOlder.emit();
  }

  private loadNewerWhenNearBottom(feed: HTMLElement | undefined): void {
    if (!feed || !this.canLoadNewer() || feed.scrollTop + feed.clientHeight < feed.scrollHeight - 72) {
      return;
    }

    const anchor = this.firstVisibleLogEntry(feed);
    if (!anchor) {
      return;
    }

    this.captureHistoryAnchor(anchor);
    this.loadNewer.emit();
  }

  private captureHistoryAnchor(anchor: HTMLElement): void {
    this.pendingHistoryAnchor = {
      entryId: anchor.dataset['logEntryId'] ?? '',
      top: anchor.getBoundingClientRect().top,
    };
  }

  private firstVisibleLogEntry(feed: HTMLElement): HTMLElement | null {
    const feedTop = feed.getBoundingClientRect().top;

    return Array.from(feed.querySelectorAll<HTMLElement>('[data-log-entry-id]'))
      .find((entry) => entry.getBoundingClientRect().bottom >= feedTop) ?? null;
  }

  private findLogEntry(feed: HTMLElement, entryId: string): HTMLElement | null {
    return Array.from(feed.querySelectorAll<HTMLElement>('[data-log-entry-id]'))
      .find((entry) => entry.dataset['logEntryId'] === entryId) ?? null;
  }

}
