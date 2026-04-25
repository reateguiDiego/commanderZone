import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { Card } from '../models/card.model';
import { CardResponse, DataResponse } from '../models/api-responses.model';

@Injectable({ providedIn: 'root' })
export class CardsApi {
  private readonly http = inject(HttpClient);

  search(query: string, page = 1, limit = 24): Observable<DataResponse<Card>> {
    const params = new HttpParams()
      .set('q', query)
      .set('page', page)
      .set('limit', limit);

    return this.http.get<DataResponse<Card>>(`${API_BASE_URL}/cards/search`, { params });
  }

  get(scryfallId: string): Observable<CardResponse> {
    return this.http.get<CardResponse>(`${API_BASE_URL}/cards/${scryfallId}`);
  }
}

