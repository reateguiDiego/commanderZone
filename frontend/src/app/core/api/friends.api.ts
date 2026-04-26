import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { DataResponse, FriendshipResponse } from '../models/api-responses.model';
import { Friendship } from '../models/friendship.model';

@Injectable({ providedIn: 'root' })
export class FriendsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<DataResponse<Friendship>> {
    return this.http.get<DataResponse<Friendship>>(`${API_BASE_URL}/friends`);
  }

  request(email: string): Observable<FriendshipResponse> {
    return this.http.post<FriendshipResponse>(`${API_BASE_URL}/friends/requests`, { email });
  }

  incoming(): Observable<DataResponse<Friendship>> {
    return this.http.get<DataResponse<Friendship>>(`${API_BASE_URL}/friends/requests/incoming`);
  }

  outgoing(): Observable<DataResponse<Friendship>> {
    return this.http.get<DataResponse<Friendship>>(`${API_BASE_URL}/friends/requests/outgoing`);
  }

  accept(id: string): Observable<FriendshipResponse> {
    return this.http.post<FriendshipResponse>(`${API_BASE_URL}/friends/requests/${id}/accept`, {});
  }

  decline(id: string): Observable<FriendshipResponse> {
    return this.http.post<FriendshipResponse>(`${API_BASE_URL}/friends/requests/${id}/decline`, {});
  }

  remove(userId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/friends/${userId}`);
  }
}
