import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingFaqContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-faq-preview',
  templateUrl: './landing-faq-preview.component.html',
  styleUrl: './landing-faq-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingFaqPreviewComponent {
  readonly content = input.required<LandingFaqContent>();
}
