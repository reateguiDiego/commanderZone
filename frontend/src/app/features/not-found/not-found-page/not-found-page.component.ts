import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { DEFAULT_LOCALE, LocaleCode, isSupportedLocale } from '../../../core/localization/locale-config';
import { getSeoPath } from '../../../core/localization/seo-routes';

interface NotFoundContent {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly homeLabel: string;
  readonly faqLabel: string;
  readonly navLabel: string;
}

const NOT_FOUND_CONTENT = {
  es: {
    eyebrow: '404',
    title: 'Pagina no encontrada',
    description: 'La URL no existe o ya no esta disponible. Puedes volver al inicio publico o consultar la ayuda.',
    homeLabel: 'Ir al inicio',
    faqLabel: 'Ver FAQ',
    navLabel: 'Navegacion de pagina no encontrada',
  },
  en: {
    eyebrow: '404',
    title: 'Page not found',
    description: 'This URL does not exist or is no longer available. You can return to the public home page or read the FAQ.',
    homeLabel: 'Go home',
    faqLabel: 'Read FAQ',
    navLabel: 'Not found navigation',
  },
  de: {
    eyebrow: '404',
    title: 'Seite nicht gefunden',
    description: 'Diese URL existiert nicht oder ist nicht mehr verfugbar. Zur Startseite oder zur FAQ.',
    homeLabel: 'Zur Startseite',
    faqLabel: 'FAQ lesen',
    navLabel: 'Navigation fur nicht gefundene Seite',
  },
  fr: {
    eyebrow: '404',
    title: 'Page introuvable',
    description: 'Cette URL n existe pas ou n est plus disponible. Revenez a l accueil public ou consultez la FAQ.',
    homeLabel: 'Accueil',
    faqLabel: 'Lire la FAQ',
    navLabel: 'Navigation page introuvable',
  },
  it: {
    eyebrow: '404',
    title: 'Pagina non trovata',
    description: 'Questo URL non esiste o non e piu disponibile. Torna alla home pubblica o leggi le FAQ.',
    homeLabel: 'Vai alla home',
    faqLabel: 'Leggi FAQ',
    navLabel: 'Navigazione pagina non trovata',
  },
  pt: {
    eyebrow: '404',
    title: 'Pagina nao encontrada',
    description: 'Este URL nao existe ou ja nao esta disponivel. Volte ao inicio publico ou leia a FAQ.',
    homeLabel: 'Ir ao inicio',
    faqLabel: 'Ler FAQ',
    navLabel: 'Navegacao da pagina nao encontrada',
  },
  ja: {
    eyebrow: '404',
    title: 'Page not found',
    description: 'This URL does not exist or is no longer available. Return to the public home page or read the FAQ.',
    homeLabel: 'Home',
    faqLabel: 'FAQ',
    navLabel: 'Not found navigation',
  },
  ko: {
    eyebrow: '404',
    title: 'Page not found',
    description: 'This URL does not exist or is no longer available. Return to the public home page or read the FAQ.',
    homeLabel: 'Home',
    faqLabel: 'FAQ',
    navLabel: 'Not found navigation',
  },
  'zh-hans': {
    eyebrow: '404',
    title: 'Page not found',
    description: 'This URL does not exist or is no longer available. Return to the public home page or read the FAQ.',
    homeLabel: 'Home',
    faqLabel: 'FAQ',
    navLabel: 'Not found navigation',
  },
  'zh-hant': {
    eyebrow: '404',
    title: 'Page not found',
    description: 'This URL does not exist or is no longer available. Return to the public home page or read the FAQ.',
    homeLabel: 'Home',
    faqLabel: 'FAQ',
    navLabel: 'Not found navigation',
  },
  nl: {
    eyebrow: '404',
    title: 'Pagina niet gevonden',
    description: 'Deze URL bestaat niet of is niet meer beschikbaar. Ga terug naar de startpagina of lees de FAQ.',
    homeLabel: 'Naar home',
    faqLabel: 'FAQ lezen',
    navLabel: 'Navigatie voor niet gevonden pagina',
  },
  ca: {
    eyebrow: '404',
    title: 'Pagina no trobada',
    description: 'Aquest URL no existeix o ja no esta disponible. Torna a l inici public o consulta les FAQ.',
    homeLabel: 'Anar a l inici',
    faqLabel: 'Veure FAQ',
    navLabel: 'Navegacio de pagina no trobada',
  },
  ru: {
    eyebrow: '404',
    title: 'Page not found',
    description: 'This URL does not exist or is no longer available. Return to the public home page or read the FAQ.',
    homeLabel: 'Home',
    faqLabel: 'FAQ',
    navLabel: 'Not found navigation',
  },
} as const satisfies Record<LocaleCode, NotFoundContent>;

@Component({
  selector: 'app-not-found-page',
  imports: [],
  templateUrl: './not-found-page.component.html',
  styleUrl: './not-found-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPageComponent {
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  readonly locale = signal<LocaleCode>(localeFromNotFoundUrl(this.router.url));

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

  homePath(): string {
    return getSeoPath('home', this.locale());
  }

  faqPath(): string {
    return getSeoPath('faq', this.locale());
  }

  private applyUrl(url: string): void {
    const locale = localeFromNotFoundUrl(url);
    this.locale.set(locale);
    this.title.setTitle(`${NOT_FOUND_CONTENT[locale].title} | CommanderZone`);
  }
}

export function localeFromNotFoundUrl(url: string): LocaleCode {
  const path = url.split(/[?#]/)[0] ?? '';
  const firstSegment = path.split('/').filter(Boolean)[0]?.toLowerCase();
  return isSupportedLocale(firstSegment) ? firstSegment : DEFAULT_LOCALE.code;
}
