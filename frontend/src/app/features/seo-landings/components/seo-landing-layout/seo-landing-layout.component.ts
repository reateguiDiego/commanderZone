import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, PLATFORM_ID, inject, input } from '@angular/core';
import { LandingBreadcrumbComponent } from '../landing-breadcrumb/landing-breadcrumb.component';
import { LandingInternalLinksComponent } from '../landing-internal-links/landing-internal-links.component';
import { SeoLanguageSelectorComponent } from '../seo-language-selector/seo-language-selector.component';
import { SeoLandingContent } from '../../models/seo-landing-content.model';

const SEO_SCROLL_CLASSES = ['app-pretty-scroll', 'seo-scroll-context'] as const;

@Component({
  selector: 'app-seo-landing-layout',
  imports: [LandingBreadcrumbComponent, LandingInternalLinksComponent, SeoLanguageSelectorComponent],
  templateUrl: './seo-landing-layout.component.html',
  styleUrl: './seo-landing-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeoLandingLayoutComponent implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly content = input.required<SeoLandingContent>();

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    this.document.documentElement.classList.add(...SEO_SCROLL_CLASSES);
    this.document.body.classList.add(...SEO_SCROLL_CLASSES);
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) {
      return;
    }

    this.document.documentElement.classList.remove(...SEO_SCROLL_CLASSES);
    this.document.body.classList.remove(...SEO_SCROLL_CLASSES);
  }
}
