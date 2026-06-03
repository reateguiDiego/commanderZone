import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingBreadcrumbContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-breadcrumb',
  templateUrl: './landing-breadcrumb.component.html',
  styleUrl: './landing-breadcrumb.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingBreadcrumbComponent {
  readonly content = input.required<LandingBreadcrumbContent>();
}
