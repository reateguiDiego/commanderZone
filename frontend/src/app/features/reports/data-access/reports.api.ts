import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api/api.config';
import {
  AdminReportResponse,
  AdminReportsResponse,
  AdminReportsSummaryResponse,
  CreateReportRequest,
  CreateReportResponse,
  CreateUserStrikeRequest,
  CreateUserStrikeResponse,
  DeleteUserStrikeResponse,
  ResolveReportRequest,
  ResolveReportResponse,
  UserModerationResponse,
} from './reports.models';

@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly http = inject(HttpClient);

  createReport(request: CreateReportRequest): Observable<CreateReportResponse> {
    return this.http.post<CreateReportResponse>(`${API_BASE_URL}/reports`, request);
  }

  getSummary(): Observable<AdminReportsSummaryResponse> {
    return this.http.get<AdminReportsSummaryResponse>(`${API_BASE_URL}/admin/reports/summary`);
  }

  listReports(page = 1, limit = 30): Observable<AdminReportsResponse> {
    const params = new HttpParams({
      fromObject: { page: String(page), limit: String(limit) },
    });

    return this.http.get<AdminReportsResponse>(`${API_BASE_URL}/admin/reports`, { params });
  }

  getReport(reportId: string): Observable<AdminReportResponse> {
    return this.http.get<AdminReportResponse>(`${API_BASE_URL}/admin/reports/${reportId}`);
  }

  resolveReport(reportId: string, request: ResolveReportRequest): Observable<ResolveReportResponse> {
    return this.http.patch<ResolveReportResponse>(`${API_BASE_URL}/admin/reports/${reportId}/resolution`, request);
  }

  deleteReport(reportId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/admin/reports/${reportId}`);
  }

  getUserModeration(userId: string): Observable<UserModerationResponse> {
    return this.http.get<UserModerationResponse>(`${API_BASE_URL}/admin/users/${userId}/moderation`);
  }

  createUserStrike(userId: string, request: CreateUserStrikeRequest): Observable<CreateUserStrikeResponse> {
    return this.http.post<CreateUserStrikeResponse>(`${API_BASE_URL}/admin/users/${userId}/strikes`, request);
  }

  deleteUserStrike(userId: string, strikeId: string): Observable<DeleteUserStrikeResponse> {
    return this.http.delete<DeleteUserStrikeResponse>(`${API_BASE_URL}/admin/users/${userId}/strikes/${strikeId}`);
  }
}
