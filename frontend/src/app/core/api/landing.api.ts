import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { withoutGlobalLoading } from '../loading/loading-context';

export interface LandingPreviewResponse {
  cardName: string;
  displayName: string;
}

@Injectable({ providedIn: 'root' })
export class LandingApi {
  private readonly http = inject(HttpClient);

  preview(): Observable<LandingPreviewResponse> {
    return this.http.get<LandingPreviewResponse>(`${API_BASE_URL}/landing/preview`, {
      context: withoutGlobalLoading(),
    });
  }
}
