import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingBreadcrumbComponent } from '../landing-breadcrumb/landing-breadcrumb.component';
import { LandingInternalLinksComponent } from '../landing-internal-links/landing-internal-links.component';
import { SeoLandingContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-seo-landing-layout',
  imports: [LandingBreadcrumbComponent, LandingInternalLinksComponent],
  templateUrl: './seo-landing-layout.component.html',
  styleUrl: './seo-landing-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeoLandingLayoutComponent {
  readonly content = input.required<SeoLandingContent>();
}
