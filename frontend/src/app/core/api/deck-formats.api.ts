import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { DeckFormatResponse } from '../models/api-responses.model';

@Injectable({ providedIn: 'root' })
export class DeckFormatsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<DeckFormatResponse> {
    return this.http.get<DeckFormatResponse>(`${API_BASE_URL}/deck-formats`);
  }
}
