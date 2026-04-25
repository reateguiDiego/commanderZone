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
import { Deck, DeckSection } from '../models/deck.model';

@Injectable({ providedIn: 'root' })
export class DecksApi {
  private readonly http = inject(HttpClient);

  list(folderId?: string | null): Observable<DataResponse<Deck>> {
    return folderId === undefined
      ? this.http.get<DataResponse<Deck>>(`${API_BASE_URL}/decks`)
      : this.http.get<DataResponse<Deck>>(`${API_BASE_URL}/decks`, { params: { folderId: folderId ?? 'null' } });
  }

  create(name: string, folderId: string | null = null): Observable<DeckResponse> {
    return this.http.post<DeckResponse>(`${API_BASE_URL}/decks`, { name, folderId });
  }

  get(id: string): Observable<DeckResponse> {
    return this.http.get<DeckResponse>(`${API_BASE_URL}/decks/${id}`);
  }

  rename(id: string, name: string): Observable<DeckResponse> {
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}`, { name });
  }

  moveToFolder(id: string, folderId: string | null): Observable<DeckResponse> {
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}`, { folderId });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/decks/${id}`);
  }

  importDecklist(id: string, decklist: string): Observable<DeckImportResponse> {
    return this.http.post<DeckImportResponse>(`${API_BASE_URL}/decks/${id}/import`, { decklist });
  }

  addCard(id: string, payload: { scryfallId: string; quantity?: number; section?: DeckSection }): Observable<DeckResponse> {
    return this.http.post<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards`, payload);
  }

  updateCard(id: string, deckCardId: string, payload: { quantity?: number; section?: DeckSection }): Observable<DeckResponse> {
    return this.http.patch<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}`, payload);
  }

  removeCard(id: string, deckCardId: string): Observable<DeckResponse> {
    return this.http.delete<DeckResponse>(`${API_BASE_URL}/decks/${id}/cards/${deckCardId}`);
  }

  validateCommander(id: string): Observable<CommanderValidationResponse> {
    return this.http.post<CommanderValidationResponse>(`${API_BASE_URL}/decks/${id}/validate-commander`, {});
  }
}
