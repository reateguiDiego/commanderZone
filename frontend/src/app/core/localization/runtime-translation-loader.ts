import { HttpClient } from '@angular/common/http';
import { isPlatformServer } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { RUNTIME_TRANSLATION_FALLBACKS } from './runtime-translation-fallbacks';

@Injectable()
export class RuntimeTranslationLoader extends TranslateLoader {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  override getTranslation(lang: string): Observable<TranslationObject> {
    if (isPlatformServer(this.platformId)) {
      return of({ ...RUNTIME_TRANSLATION_FALLBACKS });
    }

    return this.http.get<TranslationObject>(`assets/i18n/${encodeURIComponent(lang)}.json`);
  }
}
