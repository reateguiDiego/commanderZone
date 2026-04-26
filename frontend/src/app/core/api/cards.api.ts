import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { withoutGlobalLoading } from '../loading/loading-context';
import { Card } from '../models/card.model';
import { CardImageResponse, CardResponse, DataResponse } from '../models/api-responses.model';

export interface CardSearchFilters {
  commanderLegal?: boolean;
  colorIdentity?: string[];
  type?: 'creature' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'planeswalker' | 'land';
}

@Injectable({ providedIn: 'root' })
export class CardsApi {
  private readonly http = inject(HttpClient);

  search(query: string, page = 1, limit = 24, filters: CardSearchFilters = {}): Observable<DataResponse<Card>> {
    let params = new HttpParams()
      .set('q', query)
      .set('page', page)
      .set('limit', limit);

    if (filters.commanderLegal !== undefined) {
      params = params.set('commanderLegal', String(filters.commanderLegal));
    }
    if (filters.colorIdentity && filters.colorIdentity.length > 0) {
      params = params.set('colorIdentity', filters.colorIdentity.join(','));
    }
    if (filters.type) {
      params = params.set('type', filters.type);
    }

    return this.http.get<DataResponse<Card>>(`${API_BASE_URL}/cards/search`, { params });
  }

  get(scryfallId: string): Observable<CardResponse> {
    return this.http.get<CardResponse>(`${API_BASE_URL}/cards/${scryfallId}`);
  }

  image(scryfallId: string, format: 'small' | 'normal' | 'large' | 'png' | 'art_crop' | 'border_crop' = 'normal'): Observable<CardImageResponse> {
    return this.http.get<CardImageResponse>(`${API_BASE_URL}/cards/${scryfallId}/image`, {
      params: { format, mode: 'uri' },
      context: withoutGlobalLoading(),
    });
  }
}
