import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SeoLandingLayoutComponent } from '../components/seo-landing-layout/seo-landing-layout.component';
import { SeoLandingContent } from '../models/seo-landing-content.model';
import { getSeoLandingTemplateName } from '../models/seo-landing-template.model';
import { ComparisonLandingTemplateComponent } from '../templates/comparison-landing-template/comparison-landing-template.component';
import { FaqLandingTemplateComponent } from '../templates/faq-landing-template/faq-landing-template.component';
import { GuideLandingTemplateComponent } from '../templates/guide-landing-template/guide-landing-template.component';
import { ProductLandingTemplateComponent } from '../templates/product-landing-template/product-landing-template.component';

@Component({
  selector: 'app-seo-landing-page',
  imports: [
    ComparisonLandingTemplateComponent,
    FaqLandingTemplateComponent,
    GuideLandingTemplateComponent,
    ProductLandingTemplateComponent,
    SeoLandingLayoutComponent,
  ],
  templateUrl: './seo-landing-page.component.html',
  styleUrl: './seo-landing-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeoLandingPageComponent {
  readonly content = input.required<SeoLandingContent>();
  readonly templateName = computed(() => getSeoLandingTemplateName(this.content().routeKey));
}
