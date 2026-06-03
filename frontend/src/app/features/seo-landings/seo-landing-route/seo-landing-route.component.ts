import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { LocaleCode } from '../../../core/localization/locale-config';
import { SeoRouteKey } from '../../../core/localization/seo-routes';
import { SeoService } from '../../../core/seo/seo.service';
import { getSeoLandingContent } from '../content/seo-landing-content';
import { SeoLandingContent } from '../models/seo-landing-content.model';
import { SeoLandingPageComponent } from '../seo-landing-page/seo-landing-page.component';

interface SeoLandingRouteData {
  readonly routeKey: SeoRouteKey;
  readonly locale: LocaleCode;
}

@Component({
  selector: 'app-seo-landing-route',
  imports: [SeoLandingPageComponent],
  templateUrl: './seo-landing-route.component.html',
  styleUrl: './seo-landing-route.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeoLandingRouteComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  private readonly destroyRef = inject(DestroyRef);

  readonly content = signal<SeoLandingContent>(getSeoLandingContent('home', 'es'));

  constructor() {
    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((data) => {
      const routeData = data as SeoLandingRouteData;
      const content = getSeoLandingContent(routeData.routeKey, routeData.locale);
      this.content.set(content);
      this.updateHead(content);
    });

    this.destroyRef.onDestroy(() => {
      this.seo.clearSeoRouteMetadata();
    });
  }

  private updateHead(content: SeoLandingContent): void {
    this.seo.applySeoRouteMetadata({
      routeKey: content.routeKey,
      locale: content.locale,
      title: content.seo.title,
      description: content.seo.description,
      robots: 'index, follow',
      siteName: content.siteName,
      openGraphTitle: content.seo.ogTitle,
      openGraphDescription: content.seo.ogDescription,
      openGraphImage: content.seo.ogImage,
      jsonLd: [content.jsonLd],
    });
  }
}
