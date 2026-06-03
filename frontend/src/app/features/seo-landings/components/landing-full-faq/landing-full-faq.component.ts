import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingFaqContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-full-faq',
  templateUrl: './landing-full-faq.component.html',
  styleUrl: './landing-full-faq.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingFullFaqComponent {
  readonly content = input.required<LandingFaqContent>();
}
