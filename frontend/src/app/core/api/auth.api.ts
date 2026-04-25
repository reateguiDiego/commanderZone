import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { LoginResponse, UserResponse } from '../models/api-responses.model';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  register(payload: { email: string; displayName: string; password: string }): Observable<UserResponse> {
    return this.http.post<UserResponse>(`${API_BASE_URL}/auth/register`, payload);
  }

  login(payload: { email: string; password: string }): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API_BASE_URL}/auth/login`, payload);
  }

  me(): Observable<UserResponse> {
    return this.http.get<UserResponse>(`${API_BASE_URL}/me`);
  }
}

