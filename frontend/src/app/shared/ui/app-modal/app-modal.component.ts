import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-modal',
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

  @Output() primary = new EventEmitter<void>();
  @Output() secondary = new EventEmitter<void>();
}
