import { Injectable, inject } from '@angular/core';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { DEFAULT_LOCALE, isSupportedLocale, LocaleCode, SUPPORTED_LOCALE_CODES } from './locale-config';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly translate = inject(NgxTranslateService);

  readonly supportedLocales = SUPPORTED_LOCALE_CODES;
  readonly defaultLocale = DEFAULT_LOCALE.code;

  constructor() {
    this.translate.addLangs([...SUPPORTED_LOCALE_CODES]);
  }

  useLocale(locale: string | null | undefined): Observable<unknown> {
    return this.translate.use(this.normalizeLocale(locale));
  }

  currentLocale(): LocaleCode {
    return this.normalizeLocale(this.translate.getCurrentLang());
  }

  instant(key: string, params?: Record<string, unknown>): unknown {
    return this.translate.instant(key, params);
  }

  stream(key: string, params?: Record<string, unknown>): Observable<unknown> {
    return this.translate.stream(key, params);
  }

  private normalizeLocale(locale: string | null | undefined): LocaleCode {
    return isSupportedLocale(locale) ? locale : DEFAULT_LOCALE.code;
  }
}
