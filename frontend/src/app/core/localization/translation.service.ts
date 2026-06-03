import { Injectable, inject } from '@angular/core';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { DEFAULT_LOCALE, isSupportedLocale, LocaleCode, SUPPORTED_LOCALE_CODES } from './locale-config';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly translate = inject(NgxTranslateService, { optional: true });

  readonly supportedLocales = SUPPORTED_LOCALE_CODES;
  readonly defaultLocale = DEFAULT_LOCALE.code;

  constructor() {
    this.translate?.addLangs([...SUPPORTED_LOCALE_CODES]);
  }

  useLocale(locale: string | null | undefined): Observable<unknown> {
    const normalizedLocale = this.normalizeLocale(locale);
    return this.translate?.use(normalizedLocale) ?? of(normalizedLocale);
  }

  currentLocale(): LocaleCode {
    return this.normalizeLocale(this.translate?.getCurrentLang());
  }

  instant(key: string, params?: Record<string, unknown>): unknown {
    return this.translate?.instant(key, params) ?? key;
  }

  stream(key: string, params?: Record<string, unknown>): Observable<unknown> {
    return this.translate?.stream(key, params) ?? of(key);
  }

  private normalizeLocale(locale: string | null | undefined): LocaleCode {
    return isSupportedLocale(locale) ? locale : DEFAULT_LOCALE.code;
  }
}
