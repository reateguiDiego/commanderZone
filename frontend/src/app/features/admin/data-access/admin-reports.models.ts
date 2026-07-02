export interface AdminReportUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

export interface AdminReport {
  readonly id: string;
  readonly reporter: AdminReportUser;
  readonly reportedUser: AdminReportUser;
  readonly reason: string;
  readonly createdAt: string;
}

export interface AdminReportsResponse {
  readonly reports: readonly AdminReport[];
}
