import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable } from 'rxjs';

@Injectable()
export class RuntimeTranslationLoader extends TranslateLoader {
  private readonly http = inject(HttpClient);

  override getTranslation(lang: string): Observable<TranslationObject> {
    return this.http.get<TranslationObject>(`assets/i18n/${encodeURIComponent(lang)}.json`);
  }
}
