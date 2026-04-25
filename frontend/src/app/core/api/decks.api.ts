import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import {
  CommanderValidationResponse,
  DataResponse,
  DeckImportResponse,
  DeckResponse,
} from '../models/api-responses.model';
import { Deck } from '../models/deck.model';

@Injectable({ providedIn: 'root' })
export class DecksApi {
  private readonly http = inject(HttpClient);

  list(): Observable<DataResponse<Deck>> {
    return this.http.get<DataResponse<Deck>>(`${API_BASE_URL}/decks`);
  }

  create(name: string): Observable<DeckResponse> {
    return this.http.post<DeckResponse>(`${API_BASE_URL}/decks`, { name });
  }

  get(id: string): Observable<DeckResponse> {
    return this.http.get<DeckResponse>(`${API_BASE_URL}/decks/${id}`);
  }

  rename(id: string, name: string): Observable<DeckResponse> {
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}`, { name });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/decks/${id}`);
  }

  importDecklist(id: string, decklist: string): Observable<DeckImportResponse> {
    return this.http.post<DeckImportResponse>(`${API_BASE_URL}/decks/${id}/import`, { decklist });
  }

  validateCommander(id: string): Observable<CommanderValidationResponse> {
    return this.http.post<CommanderValidationResponse>(`${API_BASE_URL}/decks/${id}/validate-commander`, {});
  }
}

