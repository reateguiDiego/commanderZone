import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingInternalLinksContent } from '../../models/seo-landing-content.model';
import { SeoInternalLinkDirective } from '../../../../shared/directives/seo-internal-link.directive';

@Component({
  selector: 'app-landing-internal-links',
  imports: [SeoInternalLinkDirective],
  templateUrl: './landing-internal-links.component.html',
  styleUrl: './landing-internal-links.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingInternalLinksComponent {
  readonly content = input.required<LandingInternalLinksContent>();
}
