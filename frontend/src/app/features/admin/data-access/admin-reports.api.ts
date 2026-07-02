import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api/api.config';
import { AdminReportsResponse } from './admin-reports.models';

@Injectable({ providedIn: 'root' })
export class AdminReportsApi {
  private readonly http = inject(HttpClient);

  listReports(): Observable<AdminReportsResponse> {
    return this.http.get<AdminReportsResponse>(`${API_BASE_URL}/admin/reports`);
  }
}
