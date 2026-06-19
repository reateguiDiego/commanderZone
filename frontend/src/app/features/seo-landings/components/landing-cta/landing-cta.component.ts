import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingCtaContent } from '../../models/seo-landing-content.model';
import { SeoInternalLinkDirective } from '../../../../shared/directives/seo-internal-link.directive';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-landing-cta',
  imports: [SeoInternalLinkDirective, CzButtonDirective],
  templateUrl: './landing-cta.component.html',
  styleUrl: './landing-cta.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingCtaComponent {
  readonly content = input.required<LandingCtaContent>();
}
