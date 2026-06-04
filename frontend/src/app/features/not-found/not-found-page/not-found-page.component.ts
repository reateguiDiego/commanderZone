import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { SeoLocaleCode, isSeoLocale } from '../../../core/localization/locale-config';

interface NotFoundContent {
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly cta: string;
  readonly imageAlt: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
}

const DEFAULT_NOT_FOUND_LOCALE = 'en' as const satisfies SeoLocaleCode;
const NOT_FOUND_IMAGE_SRC = '/assets/og/404-og.png';

const NOT_FOUND_CONTENT = {
  es: {
    title: 'Esta carta se ha exiliado',
    subtitle: 'La página que buscabas ha desaparecido del campo de batalla.',
    description: 'Puede que el enlace esté roto, que la sala ya no exista o que un goblin haya tocado algo que no debía.',
    cta: 'Volver al dashboard',
    imageAlt: 'Ilustración 404 de CommanderZone con una carta desapareciendo en un portal.',
    metaTitle: '404 — Página no encontrada | CommanderZone',
    metaDescription: 'La página que buscabas no existe o ha desaparecido del campo de batalla.',
  },
  en: {
    title: 'This card got exiled',
    subtitle: 'The page you were looking for has vanished from the battlefield.',
    description: 'The link may be broken, the room may be gone, or a goblin may have clicked the wrong thing.',
    cta: 'Back to dashboard',
    imageAlt: 'CommanderZone 404 illustration with a card disappearing into a portal.',
    metaTitle: '404 — Page not found | CommanderZone',
    metaDescription: 'The page you were looking for does not exist or has vanished from the battlefield.',
  },
  de: {
    title: 'Diese Karte wurde ins Exil geschickt',
    subtitle: 'Die Seite, die du gesucht hast, ist vom Spielfeld verschwunden.',
    description: 'Vielleicht ist der Link kaputt, der Raum existiert nicht mehr oder ein Goblin hat den falschen Knopf gedrückt.',
    cta: 'Zurück zum Dashboard',
    imageAlt: 'CommanderZone-404-Illustration mit einer Karte, die in einem Portal verschwindet.',
    metaTitle: '404 — Seite nicht gefunden | CommanderZone',
    metaDescription: 'Die gesuchte Seite existiert nicht oder ist vom Spielfeld verschwunden.',
  },
  fr: {
    title: 'Cette carte a été exilée',
    subtitle: 'La page que vous cherchiez a disparu du champ de bataille.',
    description: 'Le lien est peut-être cassé, la salle n’existe plus, ou un gobelin a appuyé sur le mauvais bouton.',
    cta: 'Retour au dashboard',
    imageAlt: 'Illustration 404 de CommanderZone avec une carte qui disparaît dans un portail.',
    metaTitle: '404 — Page introuvable | CommanderZone',
    metaDescription: 'La page que vous cherchiez n’existe pas ou a disparu du champ de bataille.',
  },
  pt: {
    title: 'Esta carta foi exilada',
    subtitle: 'A página que você procurava desapareceu do campo de batalha.',
    description: 'O link pode estar quebrado, a sala pode não existir mais ou um goblin pode ter apertado o botão errado.',
    cta: 'Voltar ao dashboard',
    imageAlt: 'Ilustração 404 do CommanderZone com uma carta desaparecendo em um portal.',
    metaTitle: '404 — Página não encontrada | CommanderZone',
    metaDescription: 'A página que você procurava não existe ou desapareceu do campo de batalha.',
  },
  it: {
    title: 'Questa carta è stata esiliata',
    subtitle: 'La pagina che cercavi è scomparsa dal campo di battaglia.',
    description: 'Il link potrebbe essere rotto, la stanza potrebbe non esistere più o un goblin potrebbe aver premuto il tasto sbagliato.',
    cta: 'Torna alla dashboard',
    imageAlt: 'Illustrazione 404 di CommanderZone con una carta che scompare in un portale.',
    metaTitle: '404 — Pagina non trovata | CommanderZone',
    metaDescription: 'La pagina che cercavi non esiste o è scomparsa dal campo di battaglia.',
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
  private readonly auth = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly meta = inject(Meta);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  readonly locale = signal<SeoLocaleCode>(localeFromNotFoundUrl(this.router.url));
  readonly imageSrc = NOT_FOUND_IMAGE_SRC;
  readonly ctaHref = computed(() => this.auth.isAuthenticated() ? '/dashboard' : '/');

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
    this.title.setTitle(content.metaTitle);
    this.meta.updateTag({ name: 'description', content: content.metaDescription });
  }
}

export function localeFromNotFoundUrl(url: string): SeoLocaleCode {
  const path = url.split(/[?#]/)[0] ?? '';
  const firstSegment = path.split('/').filter(Boolean)[0]?.toLowerCase();
  return isSeoLocale(firstSegment) ? firstSegment : DEFAULT_NOT_FOUND_LOCALE;
}
