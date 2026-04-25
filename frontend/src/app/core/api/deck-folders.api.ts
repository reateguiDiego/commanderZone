import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { DataResponse, DeckFolderResponse } from '../models/api-responses.model';
import { DeckFolder } from '../models/deck.model';

@Injectable({ providedIn: 'root' })
export class DeckFoldersApi {
  private readonly http = inject(HttpClient);

  list(): Observable<DataResponse<DeckFolder>> {
    return this.http.get<DataResponse<DeckFolder>>(`${API_BASE_URL}/deck-folders`);
  }

  create(name: string): Observable<DeckFolderResponse> {
    return this.http.post<DeckFolderResponse>(`${API_BASE_URL}/deck-folders`, { name });
  }

  rename(id: string, name: string): Observable<DeckFolderResponse> {
    return this.http.patch<DeckFolderResponse>(`${API_BASE_URL}/deck-folders/${id}`, { name });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/deck-folders/${id}`);
  }
}
