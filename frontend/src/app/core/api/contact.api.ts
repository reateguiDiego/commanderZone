import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { ContactResponse } from '../models/api-responses.model';

export interface ContactRequestPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ContactApi {
  private readonly http = inject(HttpClient);

  send(payload: ContactRequestPayload): Observable<ContactResponse> {
    return this.http.post<ContactResponse>(`${API_BASE_URL}/contact`, payload);
  }
}
