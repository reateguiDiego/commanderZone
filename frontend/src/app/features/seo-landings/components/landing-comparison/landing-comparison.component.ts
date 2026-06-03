import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingComparisonContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-comparison',
  templateUrl: './landing-comparison.component.html',
  styleUrl: './landing-comparison.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingComparisonComponent {
  readonly content = input.required<LandingComparisonContent>();
}
