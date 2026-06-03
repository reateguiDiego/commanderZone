import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingTrustBarContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-trust-bar',
  templateUrl: './landing-trust-bar.component.html',
  styleUrl: './landing-trust-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingTrustBarComponent {
  readonly content = input.required<LandingTrustBarContent>();
}
