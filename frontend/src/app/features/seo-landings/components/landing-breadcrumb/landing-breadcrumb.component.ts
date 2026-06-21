import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingBreadcrumbContent } from '../../models/seo-landing-content.model';
import { SeoInternalLinkDirective } from '../../../../shared/directives/seo-internal-link.directive';

@Component({
  selector: 'app-landing-breadcrumb',
  imports: [SeoInternalLinkDirective],
  templateUrl: './landing-breadcrumb.component.html',
  styleUrl: './landing-breadcrumb.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingBreadcrumbComponent {
  readonly content = input.required<LandingBreadcrumbContent>();
}
