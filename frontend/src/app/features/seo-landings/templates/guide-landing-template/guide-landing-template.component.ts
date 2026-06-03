import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SeoLandingContent } from '../../models/seo-landing-content.model';
import { GUIDE_LANDING_TEMPLATE_BLOCKS } from '../../models/seo-landing-template.model';
import { SeoLandingTemplateRendererComponent } from '../seo-landing-template-renderer/seo-landing-template-renderer.component';

@Component({
  selector: 'app-guide-landing-template',
  imports: [SeoLandingTemplateRendererComponent],
  templateUrl: './guide-landing-template.component.html',
  styleUrl: './guide-landing-template.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuideLandingTemplateComponent {
  readonly content = input.required<SeoLandingContent>();
  readonly blocks = GUIDE_LANDING_TEMPLATE_BLOCKS;
}
