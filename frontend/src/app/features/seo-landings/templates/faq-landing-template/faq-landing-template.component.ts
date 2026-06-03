import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SeoLandingContent } from '../../models/seo-landing-content.model';
import { FAQ_LANDING_TEMPLATE_BLOCKS } from '../../models/seo-landing-template.model';
import { SeoLandingTemplateRendererComponent } from '../seo-landing-template-renderer/seo-landing-template-renderer.component';

@Component({
  selector: 'app-faq-landing-template',
  imports: [SeoLandingTemplateRendererComponent],
  templateUrl: './faq-landing-template.component.html',
  styleUrl: './faq-landing-template.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FaqLandingTemplateComponent {
  readonly content = input.required<SeoLandingContent>();
  readonly blocks = FAQ_LANDING_TEMPLATE_BLOCKS;
}
