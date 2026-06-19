import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { SeoLocaleCode, isSeoLocale } from '../../../core/localization/locale-config';
import { SeoService } from '../../../core/seo/seo.service';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';

interface NotFoundContent {
  readonly title: string;
  readonly description: string;
  readonly ctaLogged: string;
  readonly ctaAnonymous: string;
  readonly imageAlt: string;
  readonly metaTitle: string;
}

const DEFAULT_NOT_FOUND_LOCALE = 'en' as const satisfies SeoLocaleCode;
const NOT_FOUND_IMAGE_SRC = '/assets/og/404-og.png';

const NOT_FOUND_CONTENT = {
  es: {
    title: 'Página no encontrada',
    description: 'Esta página se ha ido al exilio. Vuelve a CommanderZone y sigue jugando.',
    ctaLogged: 'Volver al dashboard',
    ctaAnonymous: 'Volver al inicio',
    imageAlt: 'Ilustración 404 de CommanderZone',
    metaTitle: 'Página no encontrada | CommanderZone',
  },
  en: {
    title: 'Page not found',
    description: 'This page slipped into exile. Return to CommanderZone and keep playing.',
    ctaLogged: 'Back to dashboard',
    ctaAnonymous: 'Back home',
    imageAlt: 'CommanderZone 404 illustration',
    metaTitle: 'Page not found | CommanderZone',
  },
  de: {
    title: 'Seite nicht gefunden',
    description: 'Diese Seite ist ins Exil gegangen. Kehre zu CommanderZone zurück und spiele weiter.',
    ctaLogged: 'Zurück zum Dashboard',
    ctaAnonymous: 'Zur Startseite',
    imageAlt: 'CommanderZone 404-Illustration',
    metaTitle: 'Seite nicht gefunden | CommanderZone',
  },
  fr: {
    title: 'Page introuvable',
    description: 'Cette page est partie en exil. Retournez sur CommanderZone et continuez à jouer.',
    ctaLogged: 'Retour au tableau de bord',
    ctaAnonymous: 'Retour à l’accueil',
    imageAlt: 'Illustration 404 de CommanderZone',
    metaTitle: 'Page introuvable | CommanderZone',
  },
  pt: {
    title: 'Página não encontrada',
    description: 'Esta página foi para o exílio. Volte ao CommanderZone e continue jogando.',
    ctaLogged: 'Voltar ao dashboard',
    ctaAnonymous: 'Voltar ao início',
    imageAlt: 'Ilustração 404 do CommanderZone',
    metaTitle: 'Página não encontrada | CommanderZone',
  },
  it: {
    title: 'Pagina non trovata',
    description: 'Questa pagina è finita in esilio. Torna su CommanderZone e continua a giocare.',
    ctaLogged: 'Torna alla dashboard',
    ctaAnonymous: 'Torna alla home',
    imageAlt: 'Illustrazione 404 di CommanderZone',
    metaTitle: 'Pagina non trovata | CommanderZone',
  },
} as const satisfies Record<SeoLocaleCode, NotFoundContent>;

@Component({
  selector: 'app-not-found-page',
  imports: [CzButtonDirective],
  templateUrl: './not-found-page.component.html',
  styleUrl: './not-found-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPageComponent {
  private readonly auth = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly meta = inject(Meta);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  private readonly title = inject(Title);

  readonly locale = signal<SeoLocaleCode>(localeFromNotFoundUrl(this.router.url));
  readonly imageSrc = NOT_FOUND_IMAGE_SRC;
  readonly ctaHref = computed(() => this.auth.isAuthenticated() === true ? '/dashboard' : '/');
  readonly ctaLabel = computed(() => {
    const page = this.content();
    return this.auth.isAuthenticated() === true ? page.ctaLogged : page.ctaAnonymous;
  });

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
    const content = NOT_FOUND_CONTENT[locale];
    this.locale.set(locale);
    this.seo.clearSeoRouteMetadata();
    this.title.setTitle(content.metaTitle);
    this.meta.updateTag({ name: 'description', content: content.description });
  }
}

export function localeFromNotFoundUrl(url: string): SeoLocaleCode {
  const path = url.split(/[?#]/)[0] ?? '';
  const firstSegment = path.split('/').filter(Boolean)[0]?.toLowerCase();
  return isSeoLocale(firstSegment) ? firstSegment : DEFAULT_NOT_FOUND_LOCALE;
}
