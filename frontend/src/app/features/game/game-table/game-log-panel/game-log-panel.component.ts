import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, ViewChild, input, output } from '@angular/core';
import { GameCardInstance } from '../../../../core/models/game.model';
import { PrettyScrollDirective } from '../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { GameLogEntryView } from '../game-table.store';

@Component({
  selector: 'app-game-log-panel',
  imports: [PrettyScrollDirective],
  templateUrl: './game-log-panel.component.html',
  styleUrl: './game-log-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameLogPanelComponent implements AfterViewChecked {
  readonly entries = input.required<ReadonlyArray<GameLogEntryView>>();
  readonly logTime = input.required<(createdAt: string) => string>();
  readonly previewCard = output<GameCardInstance>();
  readonly hidePreview = output<void>();

  @ViewChild('feed') private readonly feed?: ElementRef<HTMLElement>;

  private lastAutoScrollKey = '';

  ngAfterViewChecked(): void {
    const entries = this.entries();
    const latest = entries.at(-1)?.id ?? '';
    const key = `${entries.length}:${latest}`;
    if (key === this.lastAutoScrollKey) {
      return;
    }

    this.lastAutoScrollKey = key;
    queueMicrotask(() => {
      const element = this.feed?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }
}
