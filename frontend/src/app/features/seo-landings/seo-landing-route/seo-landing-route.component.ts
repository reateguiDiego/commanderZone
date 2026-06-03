import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { LocaleCode } from '../../../core/localization/locale-config';
import { getLocalizedRouteAlternates, getSeoPath, SeoRouteKey } from '../../../core/localization/seo-routes';
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
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly content = signal<SeoLandingContent>(getSeoLandingContent('home', 'es'));

  private readonly managedLinkRels = new Set(['canonical', 'alternate']);
  private jsonLdScript?: HTMLScriptElement;

  constructor() {
    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((data) => {
      const routeData = data as SeoLandingRouteData;
      const content = getSeoLandingContent(routeData.routeKey, routeData.locale);
      this.content.set(content);
      this.updateHead(content);
    });

    this.destroyRef.onDestroy(() => {
      this.removeManagedLinks();
      this.jsonLdScript?.remove();
    });
  }

  private updateHead(content: SeoLandingContent): void {
    const canonicalUrl = getSeoPath(content.routeKey, content.locale);

    this.title.setTitle(content.seo.title);
    this.meta.updateTag({ name: 'description', content: content.seo.description });
    this.meta.updateTag({ property: 'og:title', content: content.seo.ogTitle });
    this.meta.updateTag({ property: 'og:description', content: content.seo.ogDescription });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl });

    this.replaceManagedLinks(content.routeKey, canonicalUrl);
    this.replaceJsonLd(content);
  }

  private replaceManagedLinks(routeKey: SeoRouteKey, canonicalUrl: string): void {
    this.removeManagedLinks();

    this.appendHeadLink({ rel: 'canonical', href: canonicalUrl });

    const alternates = getLocalizedRouteAlternates(routeKey);
    for (const [locale, href] of Object.entries(alternates) as [LocaleCode, string][]) {
      this.appendHeadLink({ rel: 'alternate', href, hreflang: locale });
    }
  }

  private removeManagedLinks(): void {
    for (const rel of this.managedLinkRels) {
      this.document.head.querySelectorAll(`link[data-seo-landing="true"][rel="${rel}"]`).forEach((element) => element.remove());
    }
  }

  private appendHeadLink(attributes: { readonly rel: string; readonly href: string; readonly hreflang?: string }): void {
    const link = this.document.createElement('link');
    link.setAttribute('data-seo-landing', 'true');
    link.setAttribute('rel', attributes.rel);
    link.setAttribute('href', attributes.href);

    if (attributes.hreflang) {
      link.setAttribute('hreflang', attributes.hreflang);
    }

    this.document.head.appendChild(link);
  }

  private replaceJsonLd(content: SeoLandingContent): void {
    this.jsonLdScript?.remove();

    const script = this.document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-seo-landing', 'true');
    script.text = JSON.stringify(content.jsonLd);
    this.document.head.appendChild(script);
    this.jsonLdScript = script;
  }
}
