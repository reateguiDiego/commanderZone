import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SeoLandingContent } from '../../models/seo-landing-content.model';
import { PRODUCT_LANDING_TEMPLATE_BLOCKS } from '../../models/seo-landing-template.model';
import { SeoLandingTemplateRendererComponent } from '../seo-landing-template-renderer/seo-landing-template-renderer.component';

@Component({
  selector: 'app-product-landing-template',
  imports: [SeoLandingTemplateRendererComponent],
  templateUrl: './product-landing-template.component.html',
  styleUrl: './product-landing-template.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductLandingTemplateComponent {
  readonly content = input.required<SeoLandingContent>();
  readonly blocks = PRODUCT_LANDING_TEMPLATE_BLOCKS;
}
