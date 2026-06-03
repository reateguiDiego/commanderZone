import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SeoLandingContent } from '../../models/seo-landing-content.model';
import { COMPARISON_LANDING_TEMPLATE_BLOCKS } from '../../models/seo-landing-template.model';
import { SeoLandingTemplateRendererComponent } from '../seo-landing-template-renderer/seo-landing-template-renderer.component';

@Component({
  selector: 'app-comparison-landing-template',
  imports: [SeoLandingTemplateRendererComponent],
  templateUrl: './comparison-landing-template.component.html',
  styleUrl: './comparison-landing-template.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonLandingTemplateComponent {
  readonly content = input.required<SeoLandingContent>();
  readonly blocks = COMPARISON_LANDING_TEMPLATE_BLOCKS;
}
