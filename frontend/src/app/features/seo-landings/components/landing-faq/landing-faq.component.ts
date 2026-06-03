import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingFaqContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-faq',
  templateUrl: './landing-faq.component.html',
  styleUrl: './landing-faq.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingFaqComponent {
  readonly content = input.required<LandingFaqContent>();
}
