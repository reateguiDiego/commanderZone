import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { PrettyScrollDirective } from '../pretty-scroll/pretty-scroll.directive';

@Component({
  selector: 'app-modal',
  imports: [PrettyScrollDirective],
  templateUrl: './app-modal.component.html',
  styleUrl: './app-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppModalComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() message = '';
  @Input() primaryLabel = 'OK';
  @Input() secondaryLabel = 'Cancel';
  @Input() danger = false;
  @Input() showPrimary = true;
  @Input() showSecondary = true;
  @Input() primaryDisabled = false;

  @Output() primary = new EventEmitter<void>();
  @Output() secondary = new EventEmitter<void>();
}
