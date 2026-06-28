import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-premium-badge',
  templateUrl: './premium-badge.component.html',
  styleUrl: './premium-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PremiumBadgeComponent {
  readonly label = input('Premium');
}
