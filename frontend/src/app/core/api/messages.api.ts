import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { withoutGlobalLoading } from '../loading/loading-context';
import {
  AdminMessageSendPayload,
  AdminMessageSendResponse,
  MessageResponse,
  MessagesResponse,
} from '../models/message.model';
import { API_BASE_URL } from './api.config';

@Injectable({ providedIn: 'root' })
export class MessagesApi {
  private readonly http = inject(HttpClient);

  list(): Observable<MessagesResponse> {
    return this.http.get<MessagesResponse>(`${API_BASE_URL}/messages`, {
      context: withoutGlobalLoading(),
    });
  }

  markRead(messageId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${API_BASE_URL}/messages/${messageId}/read`, {}, {
      context: withoutGlobalLoading(),
    });
  }

  sendAdminMessage(payload: AdminMessageSendPayload): Observable<AdminMessageSendResponse> {
    return this.http.post<AdminMessageSendResponse>(`${API_BASE_URL}/admin/messages`, payload);
  }
}
