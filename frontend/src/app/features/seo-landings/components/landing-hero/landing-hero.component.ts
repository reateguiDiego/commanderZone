import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingHeroContent } from '../../models/seo-landing-content.model';
import { SeoInternalLinkDirective } from '../../directives/seo-internal-link.directive';

@Component({
  selector: 'app-landing-hero',
  imports: [SeoInternalLinkDirective],
  templateUrl: './landing-hero.component.html',
  styleUrl: './landing-hero.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingHeroComponent {
  readonly content = input.required<LandingHeroContent>();
}
