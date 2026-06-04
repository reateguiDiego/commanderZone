import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingComparisonComponent } from '../../components/landing-comparison/landing-comparison.component';
import { LandingCtaComponent } from '../../components/landing-cta/landing-cta.component';
import { LandingFaqComponent } from '../../components/landing-faq/landing-faq.component';
import { LandingFeatureGridComponent } from '../../components/landing-feature-grid/landing-feature-grid.component';
import { LandingFullFaqComponent } from '../../components/landing-full-faq/landing-full-faq.component';
import { LandingHeroComponent } from '../../components/landing-hero/landing-hero.component';
import { LandingSectionComponent } from '../../components/landing-section/landing-section.component';
import { LandingStepsComponent } from '../../components/landing-steps/landing-steps.component';
import { LandingTrustBarComponent } from '../../components/landing-trust-bar/landing-trust-bar.component';
import { LandingUseCasesComponent } from '../../components/landing-use-cases/landing-use-cases.component';
import { SeoLandingContent } from '../../models/seo-landing-content.model';
import { SeoLandingTemplateBlock } from '../../models/seo-landing-template.model';

@Component({
  selector: 'app-seo-landing-template-renderer',
  imports: [
    LandingComparisonComponent,
    LandingCtaComponent,
    LandingFaqComponent,
    LandingFeatureGridComponent,
    LandingFullFaqComponent,
    LandingHeroComponent,
    LandingSectionComponent,
    LandingStepsComponent,
    LandingTrustBarComponent,
    LandingUseCasesComponent,
  ],
  templateUrl: './seo-landing-template-renderer.component.html',
  styleUrl: './seo-landing-template-renderer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeoLandingTemplateRendererComponent {
  readonly content = input.required<SeoLandingContent>();
  readonly blocks = input.required<readonly SeoLandingTemplateBlock[]>();
}
