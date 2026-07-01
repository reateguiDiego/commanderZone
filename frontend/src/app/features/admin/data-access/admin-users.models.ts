import { AuthorizationRole } from '../../../core/auth/user-roles';
import { User } from '../../../core/models/user.model';

export type PremiumTier = NonNullable<User['premiumTier']>;
export type AdminUserPresenceStatus = 'online' | 'in_game' | 'offline';

export interface AdminUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly authorizationRole: AuthorizationRole;
  readonly premiumTier: PremiumTier;
  readonly lastConnectedAt: string | null;
  readonly presenceStatus: AdminUserPresenceStatus;
  readonly isOnline: boolean;
  readonly activeRoomsCount: number;
  readonly activeSessionsCount: number;
  readonly createdAt: string;
}

export interface AdminUsersResponse {
  readonly users: readonly AdminUser[];
}

export interface AdminUserResponse {
  readonly user: AdminUser;
}

export interface AdminUserUpdatePayload {
  readonly authorizationRole?: AuthorizationRole;
  readonly premiumTier?: PremiumTier;
}
