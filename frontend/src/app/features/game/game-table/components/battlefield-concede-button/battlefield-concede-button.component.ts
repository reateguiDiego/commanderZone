import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';

@Component({
  selector: 'app-battlefield-concede-button',
  imports: [LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './battlefield-concede-button.component.html',
  styleUrl: './battlefield-concede-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BattlefieldConcedeButtonComponent {
  readonly concedeRequested = output<MouseEvent>();
}
