import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { SEO_CANONICAL_ORIGIN, SeoService, toSeoAbsoluteUrl } from '../../../core/seo/seo.service';
import { getLegalLinks, getLegalPath, LegalPageKey } from '../../../core/legal/legal-routes';
import { SeoLocaleCode } from '../../../core/localization/locale-config';
import { getPublicChromeCopy } from '../../../core/localization/public-chrome-copy';
import { getLegalPageContent } from '../legal-page.content';

const LEGAL_HEAD_ATTRIBUTE = 'data-cz-legal';
const LEGAL_HEAD_SELECTOR = `meta[${LEGAL_HEAD_ATTRIBUTE}="true"], link[${LEGAL_HEAD_ATTRIBUTE}="true"]`;

@Component({
  selector: 'app-legal-page',
  templateUrl: './legal-page.component.html',
  styleUrl: './legal-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalPageComponent {
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  private readonly title = inject(Title);
  private readonly routeData = toSignal(this.route.data, { initialValue: this.route.snapshot.data });

  readonly pageKey = computed(() => this.routeData()['legalPageKey'] as LegalPageKey);
  readonly locale = computed(() => this.routeData()['locale'] as SeoLocaleCode);
  readonly content = computed(() => getLegalPageContent(this.pageKey(), this.locale()));
  readonly publicChrome = computed(() => getPublicChromeCopy(this.locale()));
  readonly homeHref = computed(() => (this.locale() === 'en' ? '/' : `/${this.locale()}/`));
  readonly legalLinks = computed(() => getLegalLinks(this.locale()));

  constructor() {
    effect(() => this.applyLegalMetadata());
  }

  private applyLegalMetadata(): void {
    const content = this.content();
    const canonicalUrl = toSeoAbsoluteUrl(getLegalPath(content.pageKey, content.locale), SEO_CANONICAL_ORIGIN);

    this.seo.clearSeoRouteMetadata();
    this.clearLegalMetadata();
    this.document.documentElement.lang = content.locale;
    this.document.documentElement.dir = 'ltr';
    this.title.setTitle(content.title);
    this.appendMeta('description', content.description);
    this.appendCanonical(canonicalUrl);
  }

  private clearLegalMetadata(): void {
    this.document.head.querySelectorAll(LEGAL_HEAD_SELECTOR).forEach((element) => element.remove());
  }

  private appendMeta(name: string, content: string): void {
    const meta = this.document.createElement('meta');
    meta.setAttribute(LEGAL_HEAD_ATTRIBUTE, 'true');
    meta.setAttribute('name', name);
    meta.setAttribute('content', content);
    this.document.head.appendChild(meta);
  }

  private appendCanonical(href: string): void {
    const link = this.document.createElement('link');
    link.setAttribute(LEGAL_HEAD_ATTRIBUTE, 'true');
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', href);
    this.document.head.appendChild(link);
  }
}
