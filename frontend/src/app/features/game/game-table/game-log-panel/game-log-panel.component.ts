import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, input, output, signal } from '@angular/core';
import { GameCardInstance } from '../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameLogEntryView } from '../state/game-table-chat-log.state';

interface CardListPopover {
  readonly names: readonly string[];
  readonly left: number;
  readonly top: number;
}

@Component({
  selector: 'app-game-log-panel',
  imports: [PrettyScrollDirective],
  templateUrl: './game-log-panel.component.html',
  styleUrl: './game-log-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameLogPanelComponent implements AfterViewChecked, OnDestroy {
  readonly entries = input.required<ReadonlyArray<GameLogEntryView>>();
  readonly logTime = input.required<(createdAt: string) => string>();
  readonly previewCard = output<GameCardInstance>();
  readonly hidePreview = output<void>();
  readonly activeCardListPopover = signal<CardListPopover | null>(null);

  @ViewChild('feed') private readonly feed?: ElementRef<HTMLElement>;

  private lastAutoScrollKey = '';
  private scrollFrame: number | null = null;
  private scrollTimer: number | null = null;

  ngAfterViewChecked(): void {
    const entries = this.entries();
    const latest = entries.at(-1)?.id ?? '';
    const key = `${entries.length}:${latest}`;
    if (key === this.lastAutoScrollKey) {
      return;
    }

    this.lastAutoScrollKey = key;
    queueMicrotask(() => this.queueScrollToBottom());
  }

  ngOnDestroy(): void {
    this.clearQueuedScroll();
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

  private queueScrollToBottom(): void {
    this.clearQueuedScroll();
    this.scrollToBottom();
    this.scrollFrame = window.requestAnimationFrame(() => {
      this.scrollFrame = null;
      this.scrollToBottom();
    });
    this.scrollTimer = window.setTimeout(() => {
      this.scrollTimer = null;
      this.scrollToBottom();
    }, 260);
  }

  private clearQueuedScroll(): void {
    if (this.scrollFrame !== null) {
      window.cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = null;
    }

    if (this.scrollTimer !== null) {
      window.clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
  }
}
