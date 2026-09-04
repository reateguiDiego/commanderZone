import { AuthorizationRole } from '../../../core/auth/user-roles';
import { User } from '../../../core/models/user.model';

export type PremiumTier = NonNullable<User['premiumTier']>;
export type AdminUserPresenceStatus = 'online' | 'in_game' | 'offline';
export type AdminUsersPresenceFilter = AdminUserPresenceStatus | 'active' | 'never_connected' | 'recently_connected' | 'recently_created' | 'all';
export type AdminUsersSortField = 'createdAt' | 'email' | 'lastConnectedAt' | 'name' | 'premium' | 'role' | 'totalDecks';
export type AdminUsersSortDirection = 'asc' | 'desc';

export interface AdminUserDeckCounts {
  readonly total: number;
  readonly privateCount: number;
  readonly publicCount: number;
}

export interface AdminUserLocalization {
  readonly countryCode: string | null;
  readonly countryName: string | null;
  readonly appLanguage: string;
}

export interface AdminUser {
  readonly id: string;
  readonly displayName: string;
  readonly publicProfilePath: string | null;
  readonly email: string;
  readonly authProviders: readonly string[];
  readonly roles: readonly string[];
  readonly authorizationRole: AuthorizationRole;
  readonly premiumTier: PremiumTier;
  readonly lastConnectedAt: string | null;
  readonly presenceStatus: AdminUserPresenceStatus;
  readonly isOnline: boolean;
  readonly activeSessionsCount: number;
  readonly deckCounts: AdminUserDeckCounts;
  readonly localization: AdminUserLocalization;
  readonly createdAt: string;
}

export interface AdminUsersSummary {
  readonly total: number;
  readonly online: number;
  readonly recentlyConnected: number;
  readonly recentlyCreated: number;
  readonly neverConnected: number;
  readonly totalDecks: number;
  readonly tier0: number;
  readonly tier1: number;
  readonly tier2: number;
  readonly tier3: number;
}

export interface AdminUsersCountrySummary {
  readonly countryCode: string | null;
  readonly countryName: string | null;
  readonly userCount: number;
  readonly share: number;
}

export type AdminUsersLocalizationScope = 'all' | 'active';
export type AdminUsersLocalizationDimension = 'countries' | 'continents' | 'languages';

export interface AdminUsersLocalizationItem {
  readonly code: string | null;
  readonly name: string | null;
  readonly userCount: number;
  readonly share: number;
}

export interface AdminUsersLocalizationBreakdown {
  readonly totalUsers: number;
  readonly countries: readonly AdminUsersLocalizationItem[];
  readonly continents: readonly AdminUsersLocalizationItem[];
  readonly languages: readonly AdminUsersLocalizationItem[];
}

export interface AdminUsersLocalizationSummary {
  readonly all: AdminUsersLocalizationBreakdown;
  readonly active: AdminUsersLocalizationBreakdown;
}

export interface AdminUsersListQuery {
  readonly query: string;
  readonly role: AuthorizationRole | 'all';
  readonly premiumTier: PremiumTier | 'all';
  readonly status: AdminUsersPresenceFilter;
  readonly sort: AdminUsersSortField;
  readonly direction: AdminUsersSortDirection;
  readonly page: number;
  readonly limit: number;
}

export interface AdminUsersResponse {
  readonly users: readonly AdminUser[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly summary: AdminUsersSummary;
  readonly countries: readonly AdminUsersCountrySummary[];
  readonly localizationSummary: AdminUsersLocalizationSummary;
}

export interface AdminUserResponse {
  readonly user: AdminUser;
}

export interface AdminUserImpersonationState {
  readonly active: true;
  readonly impersonatorId: string;
  readonly targetUserId: string;
}

export interface AdminUserImpersonationResponse {
  readonly token: string;
  readonly user: User;
  readonly impersonation: AdminUserImpersonationState;
}

export interface AdminUserUpdatePayload {
  readonly authorizationRole?: AuthorizationRole;
  readonly premiumTier?: PremiumTier;
}
