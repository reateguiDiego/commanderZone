import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { SeoLocaleCode, isSeoLocale } from '../../../core/localization/locale-config';

interface NotFoundContent {
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly imageAlt: string;
}

interface NotFoundLink {
  readonly href: string;
  readonly label: string;
}

const DEFAULT_NOT_FOUND_LOCALE = 'en' as const satisfies SeoLocaleCode;
const NOT_FOUND_IMAGE_SRC = '/assets/og/404-og.png';
const NOT_FOUND_META_TITLE = 'Page not found | CommanderZone';
const NOT_FOUND_META_DESCRIPTION = 'The page you were looking for does not exist.';

const NOT_FOUND_LINKS: readonly NotFoundLink[] = [
  { href: '/', label: 'Home' },
  { href: '/en/play-commander-online/', label: 'Play Commander online' },
  { href: '/en/faq/', label: 'FAQ' },
];

const NOT_FOUND_CONTENT = {
  es: {
    title: 'Pagina no encontrada',
    subtitle: 'La pagina que buscabas no existe.',
    description: 'Puede que el enlace este roto o que la URL haya cambiado.',
    imageAlt: 'Imagen 404 de CommanderZone para una pagina no encontrada.',
  },
  en: {
    title: 'Page not found',
    subtitle: 'The page you were looking for does not exist.',
    description: 'The link may be broken or the URL may have changed.',
    imageAlt: 'CommanderZone 404 image for a page not found.',
  },
  de: {
    title: 'Seite nicht gefunden',
    subtitle: 'Die gesuchte Seite existiert nicht.',
    description: 'Der Link ist moglicherweise defekt oder die URL hat sich geandert.',
    imageAlt: 'CommanderZone 404 image for a page not found.',
  },
  fr: {
    title: 'Page introuvable',
    subtitle: 'La page que vous cherchiez n existe pas.',
    description: 'Le lien est peut-etre casse ou l URL a change.',
    imageAlt: 'CommanderZone 404 image for a page not found.',
  },
  pt: {
    title: 'Pagina nao encontrada',
    subtitle: 'A pagina que voce procurava nao existe.',
    description: 'O link pode estar quebrado ou a URL pode ter mudado.',
    imageAlt: 'CommanderZone 404 image for a page not found.',
  },
  it: {
    title: 'Pagina non trovata',
    subtitle: 'La pagina che cercavi non esiste.',
    description: 'Il link potrebbe essere rotto o l URL potrebbe essere cambiato.',
    imageAlt: 'CommanderZone 404 image for a page not found.',
  },
} as const satisfies Record<SeoLocaleCode, NotFoundContent>;

@Component({
  selector: 'app-not-found-page',
  imports: [],
  templateUrl: './not-found-page.component.html',
  styleUrl: './not-found-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly meta = inject(Meta);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  readonly locale = signal<SeoLocaleCode>(localeFromNotFoundUrl(this.router.url));
  readonly imageSrc = NOT_FOUND_IMAGE_SRC;
  readonly links = NOT_FOUND_LINKS;

  constructor() {
    this.applyUrl(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => this.applyUrl(event.urlAfterRedirects));
  }

  content(): NotFoundContent {
    return NOT_FOUND_CONTENT[this.locale()];
  }

  private applyUrl(url: string): void {
    const locale = localeFromNotFoundUrl(url);
    this.locale.set(locale);
    this.title.setTitle(NOT_FOUND_META_TITLE);
    this.meta.updateTag({ name: 'description', content: NOT_FOUND_META_DESCRIPTION });
  }
}

export function localeFromNotFoundUrl(url: string): SeoLocaleCode {
  const path = url.split(/[?#]/)[0] ?? '';
  const firstSegment = path.split('/').filter(Boolean)[0]?.toLowerCase();
  return isSeoLocale(firstSegment) ? firstSegment : DEFAULT_NOT_FOUND_LOCALE;
}
