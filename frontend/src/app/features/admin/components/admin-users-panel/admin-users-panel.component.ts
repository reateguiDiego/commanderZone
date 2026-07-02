import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { finalize } from 'rxjs';
import {
  AuthorizationRole,
  ROLE_ADMIN,
  ROLE_OWNER,
  ROLE_USER,
  authorizationRoleFor,
  isLowerAuthorizationRole,
} from '../../../../core/auth/user-roles';
import { AuthStore } from '../../../../core/auth/auth.store';
import { FormatSelectComponent, FormatSelectOption } from '../../../../shared/components/format-select/format-select.component';
import { AppModalComponent } from '../../../../shared/ui/app-modal/app-modal.component';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { TooltipComponent } from '../../../../shared/ui/tooltip/tooltip.component';
import { AdminUsersApi } from '../../data-access/admin-users.api';
import { AdminUser, AdminUserPresenceStatus, PremiumTier } from '../../data-access/admin-users.models';

type UserAction = 'delete' | 'impersonate' | 'premium' | 'role' | 'rooms' | 'sessions';
type SortField = 'createdAt' | 'email' | 'lastConnectedAt' | 'name' | 'premium' | 'role';
type SortDirection = 'asc' | 'desc';
type SortIconName = 'move-down' | 'move-up';
type RoleFilter = AuthorizationRole | 'all';
type PremiumTierFilter = PremiumTier | 'all';
type PresenceFilter = AdminUserPresenceStatus | 'all';

interface PendingConfirmation {
  readonly title: string;
  readonly message: string;
  readonly primaryLabel: string;
  readonly danger: boolean;
  readonly action: () => void;
}

interface UsersSummary {
  readonly total: number;
  readonly online: number;
  readonly tier1: number;
  readonly tier2: number;
  readonly tier3: number;
}

export interface AdminMessageRecipientSelection {
  readonly id: string;
  readonly name: string;
}

@Component({
  selector: 'app-admin-users-panel',
  imports: [DatePipe, FormatSelectComponent, AppModalComponent, CzButtonDirective, LucideAngularModule, TooltipComponent],
  templateUrl: './admin-users-panel.component.html',
  styleUrl: './admin-users-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersPanelComponent {
  private readonly api = inject(AdminUsersApi);
  private readonly auth = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly pageSize = 30;

  readonly roleOptions: readonly FormatSelectOption[] = [
    { id: ROLE_USER, name: 'User' },
    { id: ROLE_ADMIN, name: 'Admin' },
    { id: ROLE_OWNER, name: 'Owner' },
  ];
  readonly roleFilterOptions: readonly FormatSelectOption[] = [
    { id: 'all', name: 'All roles' },
    ...this.roleOptions,
  ];
  readonly premiumTierOptions: readonly FormatSelectOption[] = [
    { id: 'none', name: 'None' },
    { id: 'tier1', name: 'Tier 1' },
    { id: 'tier2', name: 'Tier 2' },
    { id: 'tier3', name: 'Tier 3' },
  ];
  readonly premiumTierFilterOptions: readonly FormatSelectOption[] = [
    { id: 'all', name: 'All premium' },
    ...this.premiumTierOptions,
  ];
  readonly presenceFilterOptions: readonly FormatSelectOption[] = [
    { id: 'all', name: 'All status' },
    { id: 'online', name: 'Online' },
    { id: 'in_game', name: 'In game' },
    { id: 'offline', name: 'Offline' },
  ];
  readonly users = signal<readonly AdminUser[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly pendingActions = signal<Readonly<Record<string, UserAction | undefined>>>({});
  readonly searchQuery = signal('');
  readonly roleFilter = signal<RoleFilter>('all');
  readonly premiumTierFilter = signal<PremiumTierFilter>('all');
  readonly presenceFilter = signal<PresenceFilter>('all');
  readonly sortField = signal<SortField>('createdAt');
  readonly sortDirection = signal<SortDirection>('desc');
  readonly currentPage = signal(1);
  readonly pendingConfirmation = signal<PendingConfirmation | null>(null);
  readonly sendMessageRequested = output<AdminMessageRecipientSelection>();
  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);
  readonly currentUserRole = computed(() => authorizationRoleFor(this.auth.user()));
  readonly usersSummary = computed<UsersSummary>(() => this.summarizeUsers(this.users()));
  readonly visibleUsers = computed(() => this.sortedUsers(this.filteredUsers()));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.visibleUsers().length / this.pageSize)));
  readonly activePage = computed(() => Math.min(this.currentPage(), this.totalPages()));
  readonly paginatedUsers = computed(() => {
    const startIndex = (this.activePage() - 1) * this.pageSize;

    return this.visibleUsers().slice(startIndex, startIndex + this.pageSize);
  });
  readonly firstVisibleUserIndex = computed(() => this.visibleUsers().length === 0 ? 0 : ((this.activePage() - 1) * this.pageSize) + 1);
  readonly lastVisibleUserIndex = computed(() => Math.min(this.activePage() * this.pageSize, this.visibleUsers().length));

  constructor() {
    this.loadUsers();
  }

  loadUsers(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.api.listUsers()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe({
        next: (response) => this.users.set(response.users),
        error: (error: unknown) => this.errorMessage.set(this.readErrorMessage(error)),
      });
  }

  changeAuthorizationRole(user: AdminUser, selectedRole: string): void {
    if (!this.isAuthorizationRole(selectedRole) || selectedRole === user.authorizationRole || !this.canChangeRole(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'Confirm role change',
      message: `Change ${user.displayName}'s role from ${this.roleLabel(user.authorizationRole)} to ${this.roleLabel(selectedRole)}?`,
      primaryLabel: 'Change role',
      danger: selectedRole === ROLE_OWNER || user.authorizationRole === ROLE_OWNER,
      action: () => this.updateUser(user, 'role', { authorizationRole: selectedRole }),
    });
  }

  changePremiumTier(user: AdminUser, selectedTier: string): void {
    if (!this.isPremiumTier(selectedTier) || selectedTier === user.premiumTier || !this.canChangePremium(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'Confirm premium change',
      message: `Change ${user.displayName}'s premium tier from ${this.premiumTierLabel(user.premiumTier)} to ${this.premiumTierLabel(selectedTier)}?`,
      primaryLabel: 'Change premium',
      danger: false,
      action: () => this.updateUser(user, 'premium', { premiumTier: selectedTier }),
    });
  }

  revokeSessions(user: AdminUser): void {
    if (user.activeSessionsCount <= 0 || !this.canRevokeSessions(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'Confirm session closure',
      message: `Close ${user.activeSessionsCount} active session(s) for ${user.displayName}?`,
      primaryLabel: 'Close sessions',
      danger: true,
      action: () => this.runUserAction(user, 'sessions', () => this.api.revokeSessions(user.id)),
    });
  }

  removeFromRooms(user: AdminUser): void {
    if (user.activeRoomsCount <= 0 || !this.canRemoveFromRooms(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'Confirm room removal',
      message: `Remove ${user.displayName} from ${user.activeRoomsCount} active room(s)?`,
      primaryLabel: 'Remove from rooms',
      danger: true,
      action: () => this.runUserAction(user, 'rooms', () => this.api.removeFromRooms(user.id)),
    });
  }

  deleteUser(user: AdminUser): void {
    if (!this.canDeleteUser(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'Confirm user deletion',
      message: `Delete ${user.displayName}? This cannot be undone.`,
      primaryLabel: 'Delete user',
      danger: true,
      action: () => this.confirmDeleteUser(user),
    });
  }

  requestSendMessage(user: AdminUser): void {
    this.sendMessageRequested.emit({ id: user.id, name: user.displayName });
  }

  impersonateUser(user: AdminUser): void {
    if (!this.canImpersonate(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'Confirm impersonation',
      message: `Impersonate ${user.displayName}? You will act as this user until you stop impersonating.`,
      primaryLabel: 'Impersonate',
      danger: false,
      action: () => this.confirmImpersonateUser(user),
    });
  }

  updateSearchQuery(event: Event): void {
    this.searchQuery.set(event.target instanceof HTMLInputElement ? event.target.value : '');
    this.resetPagination();
  }

  changeRoleFilter(value: string): void {
    if (value === 'all' || this.isAuthorizationRole(value)) {
      this.roleFilter.set(value);
      this.resetPagination();
    }
  }

  changePremiumTierFilter(value: string): void {
    if (value === 'all' || this.isPremiumTier(value)) {
      this.premiumTierFilter.set(value);
      this.resetPagination();
    }
  }

  changePresenceFilter(value: string): void {
    if (this.isPresenceFilter(value)) {
      this.presenceFilter.set(value);
      this.resetPagination();
    }
  }

  changeSort(field: SortField): void {
    if (this.sortField() === field) {
      this.sortDirection.update((direction) => direction === 'asc' ? 'desc' : 'asc');
      this.resetPagination();
      return;
    }

    this.sortField.set(field);
    this.sortDirection.set(field === 'createdAt' || field === 'lastConnectedAt' ? 'desc' : 'asc');
    this.resetPagination();
  }

  previousPage(): void {
    this.currentPage.update((page) => Math.max(1, page - 1));
  }

  nextPage(): void {
    this.currentPage.update((page) => Math.min(this.totalPages(), page + 1));
  }

  sortLabel(field: SortField): string {
    if (this.sortField() !== field) {
      return 'Not sorted';
    }

    return this.sortDirection() === 'asc' ? 'Ascending' : 'Descending';
  }

  sortIcon(field: SortField): SortIconName | null {
    if (this.sortField() !== field) {
      return null;
    }

    return this.sortDirection() === 'asc' ? 'move-up' : 'move-down';
  }

  confirmPendingAction(): void {
    const confirmation = this.pendingConfirmation();
    if (!confirmation) {
      return;
    }

    this.pendingConfirmation.set(null);
    confirmation.action();
  }

  cancelPendingAction(): void {
    this.pendingConfirmation.set(null);
  }

  roleLabel(role: AuthorizationRole): string {
    return this.roleOptions.find((option) => option.id === role)?.name ?? role;
  }

  premiumTierLabel(tier: PremiumTier): string {
    return this.premiumTierOptions.find((option) => option.id === tier)?.name ?? tier;
  }

  presenceLabel(status: AdminUserPresenceStatus): string {
    return this.presenceFilterOptions.find((option) => option.id === status)?.name ?? status;
  }

  isUserBusy(userId: string): boolean {
    return this.pendingActions()[userId] !== undefined;
  }

  isUserRowDisabled(user: AdminUser): boolean {
    return !this.canChangeRole(user)
      && !this.canChangePremium(user)
      && !this.canRevokeSessions(user)
      && !this.canRemoveFromRooms(user)
      && !this.canDeleteUser(user)
      && !this.canImpersonate(user);
  }

  canChangeRole(user: AdminUser): boolean {
    return this.currentUserRole() === ROLE_OWNER && this.canManageLowerRole(user);
  }

  canChangePremium(user: AdminUser): boolean {
    return this.canManageLowerRole(user) || this.isOwnerActingOnOwner(user);
  }

  canRevokeSessions(user: AdminUser): boolean {
    return this.canChangePremium(user);
  }

  canRemoveFromRooms(user: AdminUser): boolean {
    return this.canChangePremium(user);
  }

  canDeleteUser(user: AdminUser): boolean {
    return this.canManageLowerRole(user);
  }

  canImpersonate(user: AdminUser): boolean {
    return this.currentUserRole() === ROLE_OWNER && this.canManageLowerRole(user);
  }

  private canManageLowerRole(user: AdminUser): boolean {
    const currentUserId = this.currentUserId();
    if (currentUserId === null || user.id === currentUserId) {
      return false;
    }

    return isLowerAuthorizationRole(user.authorizationRole, this.currentUserRole());
  }

  private isOwnerActingOnOwner(user: AdminUser): boolean {
    return this.currentUserRole() === ROLE_OWNER && user.authorizationRole === ROLE_OWNER;
  }

  trackUser(_index: number, user: AdminUser): string {
    return user.id;
  }

  private filteredUsers(): readonly AdminUser[] {
    const query = this.searchQuery().trim().toLowerCase();
    const roleFilter = this.roleFilter();
    const premiumTierFilter = this.premiumTierFilter();
    const presenceFilter = this.presenceFilter();

    return this.users().filter((user) => {
      if (roleFilter !== 'all' && user.authorizationRole !== roleFilter) {
        return false;
      }
      if (premiumTierFilter !== 'all' && user.premiumTier !== premiumTierFilter) {
        return false;
      }
      if (presenceFilter !== 'all' && user.presenceStatus !== presenceFilter) {
        return false;
      }
      if (query === '') {
        return true;
      }

      return [
        user.displayName,
        user.email,
        this.roleLabel(user.authorizationRole),
        this.premiumTierLabel(user.premiumTier),
        this.presenceLabel(user.presenceStatus),
      ].some((value) => value.toLowerCase().includes(query));
    });
  }

  private sortedUsers(users: readonly AdminUser[]): readonly AdminUser[] {
    const field = this.sortField();
    const direction = this.sortDirection();
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...users].sort((left, right) => {
      const compared = this.sortValue(left, field).localeCompare(
        this.sortValue(right, field),
        undefined,
        { numeric: true, sensitivity: 'base' },
      );

      return compared * multiplier;
    });
  }

  private sortValue(user: AdminUser, field: SortField): string {
    switch (field) {
      case 'createdAt':
        return user.createdAt;
      case 'email':
        return user.email;
      case 'lastConnectedAt':
        return user.lastConnectedAt ?? '';
      case 'name':
        return user.displayName;
      case 'premium':
        return this.premiumTierLabel(user.premiumTier);
      case 'role':
        return this.roleLabel(user.authorizationRole);
    }
  }

  private summarizeUsers(users: readonly AdminUser[]): UsersSummary {
    return users.reduce<UsersSummary>((summary, user) => ({
      total: summary.total + 1,
      online: summary.online + (user.isOnline ? 1 : 0),
      tier1: summary.tier1 + (user.premiumTier === 'tier1' ? 1 : 0),
      tier2: summary.tier2 + (user.premiumTier === 'tier2' ? 1 : 0),
      tier3: summary.tier3 + (user.premiumTier === 'tier3' ? 1 : 0),
    }), {
      total: 0,
      online: 0,
      tier1: 0,
      tier2: 0,
      tier3: 0,
    });
  }

  private updateUser(
    user: AdminUser,
    action: UserAction,
    payload: { readonly authorizationRole?: AuthorizationRole; readonly premiumTier?: PremiumTier },
  ): void {
    this.runUserAction(user, action, () => this.api.updateUser(user.id, payload));
  }

  private requestConfirmation(confirmation: PendingConfirmation): void {
    this.pendingConfirmation.set(confirmation);
  }

  private resetPagination(): void {
    this.currentPage.set(1);
  }

  private confirmDeleteUser(user: AdminUser): void {
    this.setPendingAction(user.id, 'delete');
    this.errorMessage.set(null);
    this.api.deleteUser(user.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.clearPendingAction(user.id)),
      )
      .subscribe({
        next: () => this.users.update((users) => users.filter((currentUser) => currentUser.id !== user.id)),
        error: (error: unknown) => this.errorMessage.set(this.readErrorMessage(error)),
      });
  }

  private confirmImpersonateUser(user: AdminUser): void {
    this.setPendingAction(user.id, 'impersonate');
    this.errorMessage.set(null);
    this.api.impersonateUser(user.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.clearPendingAction(user.id)),
      )
      .subscribe({
        next: (response) => {
          this.auth.startImpersonation(response.token, response.user, response.impersonation);
          void this.router.navigate(['/dashboard']);
        },
        error: (error: unknown) => this.errorMessage.set(this.readErrorMessage(error)),
      });
  }

  private runUserAction(
    user: AdminUser,
    action: UserAction,
    requestFactory: () => ReturnType<AdminUsersApi['updateUser']>,
  ): void {
    this.setPendingAction(user.id, action);
    this.errorMessage.set(null);
    requestFactory()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.clearPendingAction(user.id)),
      )
      .subscribe({
        next: (response) => this.replaceUser(response.user),
        error: (error: unknown) => this.errorMessage.set(this.readErrorMessage(error)),
      });
  }

  private replaceUser(updatedUser: AdminUser): void {
    this.users.update((users) => users.map((user) => user.id === updatedUser.id ? updatedUser : user));
  }

  private setPendingAction(userId: string, action: UserAction): void {
    this.pendingActions.update((actions) => ({ ...actions, [userId]: action }));
  }

  private clearPendingAction(userId: string): void {
    this.pendingActions.update((actions) => {
      const { [userId]: _removedAction, ...remainingActions } = actions;

      return remainingActions;
    });
  }

  private isAuthorizationRole(value: string): value is AuthorizationRole {
    return this.roleOptions.some((option) => option.id === value);
  }

  private isPremiumTier(value: string): value is PremiumTier {
    return this.premiumTierOptions.some((option) => option.id === value);
  }

  private isPresenceFilter(value: string): value is PresenceFilter {
    return this.presenceFilterOptions.some((option) => option.id === value);
  }

  private readErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }

    return 'The admin users action could not be completed.';
  }
}
