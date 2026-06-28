import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import {
  CommunityDeckDetailResponse,
  CommunityDeckListResponse,
  CommunityHomeResponse,
  CommunityPreviewCardsResponse,
} from '../models/api-responses.model';

export interface CommunityDeckListFilters {
  q?: string;
  commander?: string;
  format?: string;
  colors?: string;
  lang?: string;
}

export interface CommunityPreviewFilters {
  type?: string;
  colors?: string;
  lang?: string;
}

@Injectable({ providedIn: 'root' })
export class CommunityApi {
  private readonly http = inject(HttpClient);

  home(lang?: string): Observable<CommunityHomeResponse> {
    return this.http.get<CommunityHomeResponse>(`${API_BASE_URL}/community`, {
      params: this.langParams(lang),
    });
  }

  decks(filters: CommunityDeckListFilters = {}): Observable<CommunityDeckListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value === 'string' && value.trim() !== '') {
        params = params.set(key, value);
      }
    }

    return this.http.get<CommunityDeckListResponse>(`${API_BASE_URL}/community/decks`, { params });
  }

  deck(id: string, lang?: string): Observable<CommunityDeckDetailResponse> {
    return this.http.get<CommunityDeckDetailResponse>(`${API_BASE_URL}/community/decks/${id}`, {
      params: this.langParams(lang),
    });
  }

  topCommanders(filters: CommunityPreviewFilters = {}): Observable<CommunityPreviewCardsResponse> {
    return this.http.get<CommunityPreviewCardsResponse>(`${API_BASE_URL}/community/top-commanders`, {
      params: this.queryParams(filters),
    });
  }

  topCards(filters: CommunityPreviewFilters = {}): Observable<CommunityPreviewCardsResponse> {
    return this.http.get<CommunityPreviewCardsResponse>(`${API_BASE_URL}/community/top-cards`, {
      params: this.queryParams(filters),
    });
  }

  private langParams(lang?: string): HttpParams | undefined {
    return typeof lang === 'string' && lang.trim() !== ''
      ? new HttpParams().set('lang', lang)
      : undefined;
  }

  private queryParams<T extends object>(filters: T): HttpParams | undefined {
    let params = new HttpParams();

    for (const [key, value] of Object.entries(filters as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim() !== '') {
        params = params.set(key, value.trim());
      }
    }

    return params.keys().length > 0 ? params : undefined;
  }
}
