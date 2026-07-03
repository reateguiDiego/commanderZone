import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { SEO_DEFAULT_OPEN_GRAPH_IMAGE, toSeoAbsoluteUrl } from './seo.service';

export interface DynamicPublicSeoMetadata {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly image?: string | null;
  readonly type?: 'website' | 'article' | 'profile';
}

const DYNAMIC_PUBLIC_SEO_ATTRIBUTE = 'data-cz-dynamic-public-seo';
const SITE_NAME = 'CommanderZone';

@Injectable({ providedIn: 'root' })
export class DynamicPublicSeoService {
  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);

  apply(metadata: DynamicPublicSeoMetadata): void {
    this.clear();

    const canonicalUrl = toSeoAbsoluteUrl(this.normalizedPath(metadata.path));
    const imageUrl = toSeoAbsoluteUrl(metadata.image?.trim() || SEO_DEFAULT_OPEN_GRAPH_IMAGE);

    this.document.documentElement.lang = 'en';
    this.document.documentElement.dir = 'ltr';
    this.title.setTitle(metadata.title);

    this.appendMeta([
      { name: 'description', content: metadata.description },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:title', content: metadata.title },
      { property: 'og:description', content: metadata.description },
      { property: 'og:type', content: metadata.type ?? 'website' },
      { property: 'og:url', content: canonicalUrl },
      { property: 'og:image', content: imageUrl },
      { property: 'og:site_name', content: SITE_NAME },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: metadata.title },
      { name: 'twitter:description', content: metadata.description },
      { name: 'twitter:image', content: imageUrl },
    ]);
    this.appendLink('canonical', canonicalUrl);
  }

  clear(): void {
    this.document.head
      .querySelectorAll(`[${DYNAMIC_PUBLIC_SEO_ATTRIBUTE}="true"]`)
      .forEach((element) => element.remove());
  }

  private appendMeta(tags: ReadonlyArray<Readonly<Record<string, string>>>): void {
    for (const tag of tags) {
      const meta = this.document.createElement('meta');
      meta.setAttribute(DYNAMIC_PUBLIC_SEO_ATTRIBUTE, 'true');

      for (const [key, value] of Object.entries(tag)) {
        meta.setAttribute(key, value);
      }

      this.document.head.appendChild(meta);
    }
  }

  private appendLink(rel: 'canonical', href: string): void {
    const link = this.document.createElement('link');
    link.setAttribute(DYNAMIC_PUBLIC_SEO_ATTRIBUTE, 'true');
    link.setAttribute('rel', rel);
    link.setAttribute('href', href);
    this.document.head.appendChild(link);
  }

  private normalizedPath(path: string): string {
    const basePath = path.startsWith('/') ? path : `/${path}`;
    return basePath.endsWith('/') ? basePath : `${basePath}/`;
  }
}
