import { User } from '../models/user.model';

export const ROLE_USER = 'ROLE_USER';
export const ROLE_ADMIN = 'ROLE_ADMIN';
export const ROLE_OWNER = 'ROLE_OWNER';

export type AuthorizationRole = typeof ROLE_USER | typeof ROLE_ADMIN | typeof ROLE_OWNER;

const ADMIN_ACCESS_ROLES = [ROLE_ADMIN, ROLE_OWNER] as const satisfies readonly AuthorizationRole[];
const ROLE_RANK: Readonly<Record<AuthorizationRole, number>> = {
  [ROLE_USER]: 1,
  [ROLE_ADMIN]: 2,
  [ROLE_OWNER]: 3,
};

export function canAccessAdmin(user: User | null | undefined): boolean {
  return hasAnyRole(user, ADMIN_ACCESS_ROLES);
}

export function hasAnyRole(user: User | null | undefined, allowedRoles: readonly AuthorizationRole[]): boolean {
  const assignedRoles = new Set(user?.roles ?? []);

  return allowedRoles.some((role) => assignedRoles.has(role));
}

export function authorizationRoleFor(user: User | null | undefined): AuthorizationRole {
  const roles = new Set(user?.roles ?? []);
  if (roles.has(ROLE_OWNER)) {
    return ROLE_OWNER;
  }
  if (roles.has(ROLE_ADMIN)) {
    return ROLE_ADMIN;
  }

  return ROLE_USER;
}

export function isLowerAuthorizationRole(targetRole: AuthorizationRole, actorRole: AuthorizationRole): boolean {
  return ROLE_RANK[targetRole] < ROLE_RANK[actorRole];
}
