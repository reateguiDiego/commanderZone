import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingUseCasesContent } from '../../models/seo-landing-content.model';
import { SeoInternalLinkDirective } from '../../directives/seo-internal-link.directive';

@Component({
  selector: 'app-landing-use-cases',
  imports: [SeoInternalLinkDirective],
  templateUrl: './landing-use-cases.component.html',
  styleUrl: './landing-use-cases.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingUseCasesComponent {
  readonly content = input.required<LandingUseCasesContent>();
}
