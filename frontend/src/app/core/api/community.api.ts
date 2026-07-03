import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import {
  CommunityDeckDetailResponse,
  CommunityDeckListResponse,
  CommunityDiscoveryDetailResponse,
  CommunityHomeResponse,
  CommunityIndexableResponse,
  CommunityPreviewCardsResponse,
  CommunityProfileResponse,
} from '../models/api-responses.model';

export interface CommunityDeckListFilters {
  q?: string;
  commander?: string;
  format?: string;
  colors?: string;
  lang?: string;
  page?: number;
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
      } else if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        params = params.set(key, String(Math.floor(value)));
      }
    }

    return this.http.get<CommunityDeckListResponse>(`${API_BASE_URL}/community/decks`, { params });
  }

  deck(id: string, lang?: string): Observable<CommunityDeckDetailResponse> {
    return this.http.get<CommunityDeckDetailResponse>(`${API_BASE_URL}/community/decks/${id}`, {
      params: this.langParams(lang),
    });
  }

  indexable(): Observable<CommunityIndexableResponse> {
    return this.http.get<CommunityIndexableResponse>(`${API_BASE_URL}/community/indexable`);
  }

  profile(handle: string, lang?: string): Observable<CommunityProfileResponse> {
    return this.http.get<CommunityProfileResponse>(`${API_BASE_URL}/community/profiles/${handle}`, {
      params: this.langParams(lang),
    });
  }

  commander(slug: string, lang?: string): Observable<CommunityDiscoveryDetailResponse> {
    return this.http.get<CommunityDiscoveryDetailResponse>(`${API_BASE_URL}/community/commanders/${slug}`, {
      params: this.langParams(lang),
    });
  }

  card(slug: string, lang?: string): Observable<CommunityDiscoveryDetailResponse> {
    return this.http.get<CommunityDiscoveryDetailResponse>(`${API_BASE_URL}/community/cards/${slug}`, {
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
