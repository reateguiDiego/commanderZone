import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AppThemeId } from '../theme/app-theme';
import { API_BASE_URL } from './api.config';

export interface ThemePreferenceResponse {
  readonly themeId: AppThemeId;
}

@Injectable({ providedIn: 'root' })
export class ThemesService {
  private readonly http = inject(HttpClient);

  get(): Observable<ThemePreferenceResponse> {
    return this.http.get<ThemePreferenceResponse>(`${API_BASE_URL}/themes`);
  }

  update(themeId: AppThemeId): Observable<ThemePreferenceResponse> {
    return this.http.put<ThemePreferenceResponse>(`${API_BASE_URL}/themes`, { themeId });
  }
}
