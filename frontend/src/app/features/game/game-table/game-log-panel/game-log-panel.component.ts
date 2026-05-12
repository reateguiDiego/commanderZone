import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, input, output } from '@angular/core';
import { GameCardInstance } from '../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameLogEntryView } from '../state/game-table-chat-log.state';

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
