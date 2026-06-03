import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { RUNTIME_TRANSLATION_FALLBACKS } from './runtime-translation-fallbacks';

@Pipe({
  name: 'runtimeTranslate',
  standalone: true,
  pure: false,
})
export class RuntimeTranslatePipe implements PipeTransform {
  private readonly translate = inject(NgxTranslateService, { optional: true });

  transform(key: string, params?: Record<string, unknown>): string {
    if (!this.translate) {
      return runtimeTranslationFallback(key, params);
    }

    const translated = this.translate.instant(key, params);
    if (typeof translated !== 'string' || translated === key) {
      return runtimeTranslationFallback(key, params);
    }

    return translated;
  }
}

export function runtimeTranslationFallback(key: string, params?: Record<string, unknown>): string {
  const fallback = RUNTIME_TRANSLATION_FALLBACKS[key] ?? key;
  if (!params) {
    return fallback;
  }

  return Object.entries(params).reduce(
    (text, [paramKey, paramValue]) => text.replace(new RegExp(`{{\\s*${paramKey}\\s*}}`, 'g'), String(paramValue)),
    fallback,
  );
}
