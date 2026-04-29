import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { withoutGlobalLoading } from '../loading/loading-context';
import { DataResponse, FriendshipResponse } from '../models/api-responses.model';
import { FriendSearchResult, Friendship } from '../models/friendship.model';

@Injectable({ providedIn: 'root' })
export class FriendsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<DataResponse<Friendship>> {
    return this.http.get<DataResponse<Friendship>>(`${API_BASE_URL}/friends`, {
      context: withoutGlobalLoading(),
    });
  }

  search(query: string): Observable<DataResponse<FriendSearchResult>> {
    return this.http.get<DataResponse<FriendSearchResult>>(`${API_BASE_URL}/friends/search`, {
      context: withoutGlobalLoading(),
      params: { q: query },
    });
  }

  request(email: string): Observable<FriendshipResponse> {
    return this.http.post<FriendshipResponse>(`${API_BASE_URL}/friends/requests`, { email });
  }

  requestUser(userId: string): Observable<FriendshipResponse> {
    return this.http.post<FriendshipResponse>(`${API_BASE_URL}/friends/requests`, { userId });
  }

  incoming(): Observable<DataResponse<Friendship>> {
    return this.http.get<DataResponse<Friendship>>(`${API_BASE_URL}/friends/requests/incoming`, {
      context: withoutGlobalLoading(),
    });
  }

  outgoing(): Observable<DataResponse<Friendship>> {
    return this.http.get<DataResponse<Friendship>>(`${API_BASE_URL}/friends/requests/outgoing`, {
      context: withoutGlobalLoading(),
    });
  }

  accept(id: string): Observable<FriendshipResponse> {
    return this.http.post<FriendshipResponse>(`${API_BASE_URL}/friends/requests/${id}/accept`, {});
  }

  decline(id: string): Observable<void> {
    return this.http.post<void>(`${API_BASE_URL}/friends/requests/${id}/decline`, {});
  }

  cancel(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/friends/requests/${id}`);
  }

  remove(userId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/friends/${userId}`);
  }
}
