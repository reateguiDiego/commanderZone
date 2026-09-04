import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api/api.config';
import {
  AdminUserImpersonationResponse,
  AdminUsersListQuery,
  AdminUserResponse,
  AdminUserUpdatePayload,
  AdminUsersResponse,
} from './admin-users.models';

@Injectable({ providedIn: 'root' })
export class AdminUsersApi {
  private readonly http = inject(HttpClient);

  listUsers(query?: AdminUsersListQuery): Observable<AdminUsersResponse> {
    if (!query) {
      return this.http.get<AdminUsersResponse>(`${API_BASE_URL}/admin/users`);
    }

    const params = new HttpParams({
      fromObject: {
        q: query.query,
        role: query.role,
        premiumTier: query.premiumTier,
        status: query.status,
        sort: query.sort,
        direction: query.direction,
        page: String(query.page),
        limit: String(query.limit),
      },
    });

    return this.http.get<AdminUsersResponse>(`${API_BASE_URL}/admin/users`, { params });
  }

  updateUser(userId: string, payload: AdminUserUpdatePayload): Observable<AdminUserResponse> {
    return this.http.patch<AdminUserResponse>(`${API_BASE_URL}/admin/users/${userId}`, payload);
  }

  deleteUser(userId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/admin/users/${userId}`);
  }

  revokeSessions(userId: string): Observable<AdminUserResponse> {
    return this.http.post<AdminUserResponse>(`${API_BASE_URL}/admin/users/${userId}/sessions/revoke`, {});
  }

  impersonateUser(userId: string): Observable<AdminUserImpersonationResponse> {
    return this.http.post<AdminUserImpersonationResponse>(`${API_BASE_URL}/admin/users/${userId}/impersonate`, {});
  }
}
