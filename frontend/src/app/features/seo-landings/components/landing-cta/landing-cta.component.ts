import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingCtaContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-cta',
  templateUrl: './landing-cta.component.html',
  styleUrl: './landing-cta.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingCtaComponent {
  readonly content = input.required<LandingCtaContent>();
}
