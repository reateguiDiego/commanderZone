import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingFeatureGridContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-feature-grid',
  templateUrl: './landing-feature-grid.component.html',
  styleUrl: './landing-feature-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingFeatureGridComponent {
  readonly content = input.required<LandingFeatureGridContent>();
}
