import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';

@Component({
  selector: 'app-pagination',
  imports: [LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './pagination.component.html',
  styleUrl: './pagination.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaginationComponent {
  readonly currentPage = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly previousDisabled = input(false);
  readonly nextDisabled = input(false);
  readonly ariaLabelKey = input.required<string>();

  readonly previousRequested = output<void>();
  readonly nextRequested = output<void>();
}
