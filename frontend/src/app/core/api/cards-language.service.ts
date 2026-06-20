import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { withoutGlobalLoading } from '../loading/loading-context';
import { SupportedCardLanguageCode } from '../localization/language-preferences';

export interface CardLanguageCoverage {
  readonly code: string;
  readonly label: string;
  readonly distinctCardNames: number;
  readonly percentageOfEnglish: number;
}

export interface CardLanguageCoverageResponse {
  readonly selectedCardLanguage: SupportedCardLanguageCode;
  readonly data: readonly CardLanguageCoverage[];
}

@Injectable({ providedIn: 'root' })
export class CardsLanguageService {
  private readonly http = inject(HttpClient);

  list(): Observable<CardLanguageCoverageResponse> {
    return this.http.get<CardLanguageCoverageResponse>(`${API_BASE_URL}/cards/languages`, {
      context: withoutGlobalLoading(),
    });
  }
}
