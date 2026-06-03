import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingStepsContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-steps',
  templateUrl: './landing-steps.component.html',
  styleUrl: './landing-steps.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingStepsComponent {
  readonly content = input.required<LandingStepsContent>();
}
