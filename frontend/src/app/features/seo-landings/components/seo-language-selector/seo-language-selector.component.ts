import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { SeoLocaleCode } from '../../../../core/localization/locale-config';
import { getPublicChromeCopy } from '../../../../core/localization/public-chrome-copy';
import { LandingLocaleLink } from '../../models/seo-landing-content.model';
import { SeoInternalLinkDirective } from '../../directives/seo-internal-link.directive';

const FLAG_ICON_BY_LOCALE: Record<SeoLocaleCode, string> = {
  en: '/assets/icons/flags/uk.png',
  es: '/assets/icons/flags/spain.png',
  de: '/assets/icons/flags/germany.png',
  fr: '/assets/icons/flags/france.png',
  pt: '/assets/icons/flags/portugal.png',
  it: '/assets/icons/flags/italy.png',
};

@Component({
  selector: 'app-seo-language-selector',
  imports: [SeoInternalLinkDirective],
  templateUrl: './seo-language-selector.component.html',
  styleUrl: './seo-language-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeoLanguageSelectorComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly currentLocale = input.required<SeoLocaleCode>();
  readonly links = input.required<readonly LandingLocaleLink[]>();
  readonly currentLink = computed(() => this.links().find((link) => this.isCurrentLocale(link.locale)) ?? this.links()[0]);
  readonly copy = computed(() => getPublicChromeCopy(this.currentLocale()).languageSelector);
  readonly menuOpen = signal(false);

  @HostListener('document:click', ['$event'])
  closeOnOutsideClick(event: MouseEvent): void {
    if (!this.menuOpen()) {
      return;
    }

    const target = event.target;
    if (target instanceof Node && !this.host.nativeElement.contains(target)) {
      this.menuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    this.menuOpen.set(false);
  }

  syncMenuState(event: Event): void {
    const details = event.currentTarget;
    if (details instanceof HTMLDetailsElement) {
      this.menuOpen.set(details.open);
    }
  }

  isCurrentLocale(locale: SeoLocaleCode): boolean {
    return locale === this.currentLocale();
  }

  flagIcon(locale: SeoLocaleCode): string {
    return FLAG_ICON_BY_LOCALE[locale];
  }
}
