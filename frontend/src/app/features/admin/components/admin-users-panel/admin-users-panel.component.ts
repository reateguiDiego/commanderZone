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
  ROLE_SUPPORT,
  ROLE_USER,
  authorizationRoleFor,
  isLowerAuthorizationRole,
} from '../../../../core/auth/user-roles';
import { AuthStore } from '../../../../core/auth/auth.store';
import { TranslationService } from '../../../../core/localization/translation.service';
import { LANGUAGE_OPTIONS } from '../../../../core/localization/language-preferences';
import { RuntimeTranslatePipe, runtimeTranslationFallback } from '../../../../core/localization/runtime-translate.pipe';
import { FormatSelectComponent, FormatSelectOption } from '../../../../shared/components/format-select/format-select.component';
import { AppModalComponent } from '../../../../shared/ui/app-modal/app-modal.component';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { TooltipComponent } from '../../../../shared/ui/tooltip/tooltip.component';
import { AdminUsersApi } from '../../data-access/admin-users.api';
import {
  AdminUser,
  AdminUserPresenceStatus,
  AdminUsersLocalizationBreakdown,
  AdminUsersLocalizationDimension,
  AdminUsersLocalizationItem,
  AdminUsersLocalizationScope,
  AdminUsersLocalizationSummary,
  AdminUsersListQuery,
  AdminUsersPresenceFilter,
  AdminUsersSortDirection,
  AdminUsersSortField,
  AdminUsersSummary,
  PremiumTier,
} from '../../data-access/admin-users.models';

type UserAction = 'delete' | 'impersonate' | 'premium' | 'role' | 'sessions';
type SortField = AdminUsersSortField;
type SortDirection = AdminUsersSortDirection;
type SortIconName = 'move-down' | 'move-up';
type RoleFilter = AuthorizationRole | 'all';
type PremiumTierFilter = PremiumTier | 'all';
type PresenceFilter = AdminUsersPresenceFilter;
type LocalizationView = 'countries_all' | 'countries_active' | 'continents_all' | 'continents_active' | 'languages_all' | 'languages_active';

const INITIAL_USER_LIST_FILTERS = {
  query: '',
  role: 'all' as RoleFilter,
  premiumTier: 'all' as PremiumTierFilter,
  presence: 'active' as PresenceFilter,
  sort: 'createdAt' as SortField,
  direction: 'desc' as SortDirection,
};

interface LocalizationViewDefinition {
  readonly id: LocalizationView;
  readonly dimension: AdminUsersLocalizationDimension;
  readonly scope: AdminUsersLocalizationScope;
  readonly labelKey: string;
}

interface PendingConfirmation {
  readonly title: string;
  readonly message: string;
  readonly messageParams?: Record<string, unknown>;
  readonly primaryLabel: string;
  readonly danger: boolean;
  readonly action: () => void;
}

const EMPTY_USERS_SUMMARY: AdminUsersSummary = {
  total: 0,
  online: 0,
  recentlyConnected: 0,
  recentlyCreated: 0,
  neverConnected: 0,
  totalDecks: 0,
  tier0: 0,
  tier1: 0,
  tier2: 0,
  tier3: 0,
};

const EMPTY_LOCALIZATION_BREAKDOWN: AdminUsersLocalizationBreakdown = {
  totalUsers: 0,
  countries: [],
  continents: [],
  languages: [],
};

const EMPTY_LOCALIZATION_SUMMARY: AdminUsersLocalizationSummary = {
  all: EMPTY_LOCALIZATION_BREAKDOWN,
  active: EMPTY_LOCALIZATION_BREAKDOWN,
};

const LOCALIZATION_VIEW_DEFINITIONS: readonly LocalizationViewDefinition[] = [
  { id: 'countries_all', dimension: 'countries', scope: 'all', labelKey: 'admin.users.localization.views.countriesAll' },
  { id: 'countries_active', dimension: 'countries', scope: 'active', labelKey: 'admin.users.localization.views.countriesActive' },
  { id: 'continents_all', dimension: 'continents', scope: 'all', labelKey: 'admin.users.localization.views.continentsAll' },
  { id: 'continents_active', dimension: 'continents', scope: 'active', labelKey: 'admin.users.localization.views.continentsActive' },
  { id: 'languages_all', dimension: 'languages', scope: 'all', labelKey: 'admin.users.localization.views.languagesAll' },
  { id: 'languages_active', dimension: 'languages', scope: 'active', labelKey: 'admin.users.localization.views.languagesActive' },
];

const LOCALIZATION_DIMENSION_LABEL_KEYS: Readonly<Record<AdminUsersLocalizationDimension, string>> = {
  countries: 'admin.users.localization.country',
  continents: 'admin.users.localization.continents',
  languages: 'admin.users.localization.language',
};

const LATIN_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  ca: 'Catalan',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  nl: 'Dutch',
  pt: 'Portuguese',
  ru: 'Russian',
  zhs: 'Chinese (Simplified)',
};

export interface AdminMessageRecipientSelection {
  readonly id: string;
  readonly name: string;
}

@Component({
  selector: 'app-admin-users-panel',
  imports: [DatePipe, RuntimeTranslatePipe, FormatSelectComponent, AppModalComponent, CzButtonDirective, LucideAngularModule, TooltipComponent],
  templateUrl: './admin-users-panel.component.html',
  styleUrl: './admin-users-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersPanelComponent {
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;
  private readonly api = inject(AdminUsersApi);
  private readonly auth = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly translation = inject(TranslationService);
  private listRequestSequence = 0;
  readonly pageSize = 30;
  readonly dateTimeFormat = 'dd/MM/yyyy HH:mm';

  readonly allRoleOptions: readonly FormatSelectOption[] = [
    { id: ROLE_USER, labelKey: 'admin.users.roles.user' },
    { id: ROLE_SUPPORT, labelKey: 'shared.text.support' },
    { id: ROLE_ADMIN, labelKey: 'shared.text.admin' },
    { id: ROLE_OWNER, labelKey: 'shared.text.owner' },
  ];
  readonly roleOptions: readonly FormatSelectOption[] = this.allRoleOptions.filter((option) => option.id !== ROLE_OWNER);
  readonly roleFilterOptions: readonly FormatSelectOption[] = [
    { id: 'all', labelKey: 'shared.text.all' },
    ...this.allRoleOptions,
  ];
  readonly premiumTierOptions: readonly FormatSelectOption[] = [
    { id: 'none', labelKey: 'admin.users.premium.none' },
    { id: 'tier1', labelKey: 'admin.users.premium.tier1' },
    { id: 'tier2', labelKey: 'admin.users.premium.tier2' },
    { id: 'tier3', labelKey: 'admin.users.premium.tier3' },
  ];
  readonly premiumTierFilterOptions: readonly FormatSelectOption[] = [
    { id: 'all', labelKey: 'shared.text.all' },
    ...this.premiumTierOptions,
  ];
  readonly presenceFilterOptions: readonly FormatSelectOption[] = [
    { id: 'all', labelKey: 'shared.text.all' },
    { id: 'active', labelKey: 'admin.users.status.active' },
    { id: 'online', labelKey: 'shared.text.online' },
    { id: 'in_game', labelKey: 'shared.text.inGame' },
    { id: 'offline', labelKey: 'shared.text.offline' },
    { id: 'recently_connected', labelKey: 'admin.users.status.recentlyConnected' },
    { id: 'recently_created', labelKey: 'admin.users.status.recentlyCreated' },
    { id: 'never_connected', labelKey: 'admin.users.status.neverConnected' },
  ];
  readonly sortFieldOptions: readonly FormatSelectOption[] = [
    { id: 'name', labelKey: 'shared.text.name' },
    { id: 'email', labelKey: 'shared.text.email' },
    { id: 'lastConnectedAt', labelKey: 'admin.users.columns.lastConnectedAt' },
    { id: 'createdAt', labelKey: 'shared.text.created' },
    { id: 'role', labelKey: 'admin.users.columns.role' },
    { id: 'premium', labelKey: 'shared.text.premium' },
    { id: 'totalDecks', labelKey: 'admin.users.summary.totalDecks' },
  ];
  readonly localizationViewOptions: readonly FormatSelectOption[] = LOCALIZATION_VIEW_DEFINITIONS.map(({ id, labelKey }) => ({ id, labelKey }));
  readonly languageLabels = Object.fromEntries(LANGUAGE_OPTIONS.map((option) => [option.code, option.label])) as Readonly<Partial<Record<string, string>>>;
  readonly users = signal<readonly AdminUser[]>([]);
  readonly usersSummary = signal<AdminUsersSummary>(EMPTY_USERS_SUMMARY);
  readonly localizationSummary = signal<AdminUsersLocalizationSummary>(EMPTY_LOCALIZATION_SUMMARY);
  readonly totalMatchingUsers = signal(0);
  readonly totalPages = signal(1);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly pendingActions = signal<Readonly<Record<string, UserAction | undefined>>>({});
  readonly searchQuery = signal(INITIAL_USER_LIST_FILTERS.query);
  readonly appliedSearchQuery = signal(INITIAL_USER_LIST_FILTERS.query);
  readonly roleFilter = signal<RoleFilter>(INITIAL_USER_LIST_FILTERS.role);
  readonly appliedRoleFilter = signal<RoleFilter>(INITIAL_USER_LIST_FILTERS.role);
  readonly premiumTierFilter = signal<PremiumTierFilter>(INITIAL_USER_LIST_FILTERS.premiumTier);
  readonly appliedPremiumTierFilter = signal<PremiumTierFilter>(INITIAL_USER_LIST_FILTERS.premiumTier);
  readonly presenceFilter = signal<PresenceFilter>(INITIAL_USER_LIST_FILTERS.presence);
  readonly appliedPresenceFilter = signal<PresenceFilter>(INITIAL_USER_LIST_FILTERS.presence);
  readonly sortField = signal<SortField>(INITIAL_USER_LIST_FILTERS.sort);
  readonly appliedSortField = signal<SortField>(INITIAL_USER_LIST_FILTERS.sort);
  readonly sortDirection = signal<SortDirection>(INITIAL_USER_LIST_FILTERS.direction);
  readonly appliedSortDirection = signal<SortDirection>(INITIAL_USER_LIST_FILTERS.direction);
  readonly currentPage = signal(1);
  readonly pendingConfirmation = signal<PendingConfirmation | null>(null);
  readonly isLocalizationModalOpen = signal(false);
  readonly localizationView = signal<LocalizationView>('countries_all');
  readonly isMobileFiltersOpen = signal(false);
  readonly sendMessageRequested = output<AdminMessageRecipientSelection>();
  readonly currentUserId = computed(() => this.auth.user()?.id ?? null);
  readonly currentUserRole = computed(() => authorizationRoleFor(this.auth.user()));
  readonly hasPendingSearch = computed(() => this.searchQuery() !== this.appliedSearchQuery()
    || this.roleFilter() !== this.appliedRoleFilter()
    || this.premiumTierFilter() !== this.appliedPremiumTierFilter()
    || this.presenceFilter() !== this.appliedPresenceFilter()
    || this.sortField() !== this.appliedSortField()
    || this.sortDirection() !== this.appliedSortDirection());
  readonly canResetFilters = computed(() => this.searchQuery() !== INITIAL_USER_LIST_FILTERS.query
    || this.roleFilter() !== INITIAL_USER_LIST_FILTERS.role
    || this.premiumTierFilter() !== INITIAL_USER_LIST_FILTERS.premiumTier
    || this.presenceFilter() !== INITIAL_USER_LIST_FILTERS.presence
    || this.sortField() !== INITIAL_USER_LIST_FILTERS.sort
    || this.sortDirection() !== INITIAL_USER_LIST_FILTERS.direction);
  readonly tierShares = computed(() => {
    const summary = this.usersSummary();

    return {
      tier0: this.percentageOfUsers(summary.tier0, summary.total),
      tier1: this.percentageOfUsers(summary.tier1, summary.total),
      tier2: this.percentageOfUsers(summary.tier2, summary.total),
      tier3: this.percentageOfUsers(summary.tier3, summary.total),
    };
  });
  readonly selectedLocalizationView = computed(() => LOCALIZATION_VIEW_DEFINITIONS.find(({ id }) => id === this.localizationView()) ?? LOCALIZATION_VIEW_DEFINITIONS[0]);
  readonly selectedLocalizationBreakdown = computed(() => this.localizationSummary()[this.selectedLocalizationView().scope]);
  readonly selectedLocalizationItems = computed(() => this.selectedLocalizationBreakdown()[this.selectedLocalizationView().dimension]);
  readonly selectedLocalizationScopeLabelKey = computed(() => this.selectedLocalizationView().scope === 'active'
    ? 'admin.users.localization.activeUsers'
    : 'admin.notifications.allUsers');
  readonly selectedLocalizationDimensionLabelKey = computed(() => LOCALIZATION_DIMENSION_LABEL_KEYS[this.selectedLocalizationView().dimension]);
  readonly firstVisibleUserIndex = computed(() => this.totalMatchingUsers() === 0 ? 0 : ((this.currentPage() - 1) * this.pageSize) + 1);
  readonly lastVisibleUserIndex = computed(() => Math.min(this.currentPage() * this.pageSize, this.totalMatchingUsers()));

  constructor() {
    this.loadUsers(true);
  }

  loadUsers(useInitialPresenceFallback = false): void {
    const requestSequence = ++this.listRequestSequence;
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.api.listUsers(this.listQuery())
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (requestSequence === this.listRequestSequence) {
            this.isLoading.set(false);
          }
        }),
      )
      .subscribe({
        next: (response) => {
          if (requestSequence !== this.listRequestSequence) {
            return;
          }

          if (useInitialPresenceFallback && this.appliedPresenceFilter() === 'active' && response.total === 0) {
            this.presenceFilter.set('recently_created');
            this.appliedPresenceFilter.set('recently_created');
            this.currentPage.set(1);
            this.loadUsers();

            return;
          }

          this.users.set(response.users);
          this.usersSummary.set(response.summary);
          this.localizationSummary.set(response.localizationSummary);
          this.totalMatchingUsers.set(response.total);
          this.totalPages.set(response.totalPages);
          this.currentPage.set(response.page);
        },
        error: (error: unknown) => {
          if (requestSequence === this.listRequestSequence) {
            this.errorMessage.set(this.readErrorMessage(error));
          }
        },
      });
  }

  openLocalizationModal(): void {
    this.isLocalizationModalOpen.set(true);
  }

  closeLocalizationModal(): void {
    this.isLocalizationModalOpen.set(false);
  }

  changeLocalizationView(value: string): void {
    if (this.isLocalizationView(value)) {
      this.localizationView.set(value);
    }
  }

  toggleMobileFilters(): void {
    this.isMobileFiltersOpen.update((isOpen) => !isOpen);
  }

  changeAuthorizationRole(user: AdminUser, selectedRole: string): void {
    if (!this.isAssignableAuthorizationRole(selectedRole) || selectedRole === user.authorizationRole || !this.canChangeRole(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'admin.users.confirmations.changeRole.title',
      message: 'admin.users.confirmations.changeRole.message',
      messageParams: {
        name: user.displayName,
        previousRole: this.roleLabel(user.authorizationRole),
        role: this.roleLabel(selectedRole),
      },
      primaryLabel: 'admin.users.confirmations.changeRole.confirm',
      danger: user.authorizationRole === ROLE_OWNER,
      action: () => this.updateUser(user, 'role', { authorizationRole: selectedRole }),
    });
  }

  changePremiumTier(user: AdminUser, selectedTier: string): void {
    if (!this.isPremiumTier(selectedTier) || selectedTier === user.premiumTier || !this.canChangePremium(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'admin.users.confirmations.changePremium.title',
      message: 'admin.users.confirmations.changePremium.message',
      messageParams: {
        name: user.displayName,
        previousTier: this.premiumTierLabel(user.premiumTier),
        tier: this.premiumTierLabel(selectedTier),
      },
      primaryLabel: 'admin.users.confirmations.changePremium.confirm',
      danger: false,
      action: () => this.updateUser(user, 'premium', { premiumTier: selectedTier }),
    });
  }

  revokeSessions(user: AdminUser): void {
    if (user.activeSessionsCount <= 0 || !this.canRevokeSessions(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'admin.users.confirmations.closeSessions.title',
      message: 'admin.users.confirmations.closeSessions.message',
      messageParams: { count: user.activeSessionsCount, name: user.displayName },
      primaryLabel: 'admin.users.closeSessions',
      danger: true,
      action: () => this.runUserAction(user, 'sessions', () => this.api.revokeSessions(user.id)),
    });
  }

  deleteUser(user: AdminUser): void {
    if (!this.canDeleteUser(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'admin.users.confirmations.deleteUser.title',
      message: 'admin.users.confirmations.deleteUser.message',
      messageParams: { name: user.displayName },
      primaryLabel: 'admin.users.deleteUser',
      danger: true,
      action: () => this.confirmDeleteUser(user),
    });
  }

  requestSendMessage(user: AdminUser): void {
    this.sendMessageRequested.emit({ id: user.id, name: user.displayName });
  }

  viewUserProfile(user: AdminUser): void {
    const path = user.publicProfilePath?.trim();
    if (!path) {
      return;
    }

    window.open(path, '_blank', 'noopener');
  }

  impersonateUser(user: AdminUser): void {
    if (!this.canImpersonate(user)) {
      return;
    }

    this.requestConfirmation({
      title: 'admin.users.confirmations.impersonate.title',
      message: 'admin.users.confirmations.impersonate.message',
      messageParams: { name: user.displayName },
      primaryLabel: 'admin.users.impersonate',
      danger: false,
      action: () => this.confirmImpersonateUser(user),
    });
  }

  updateSearchQuery(event: Event): void {
    this.searchQuery.set(event.target instanceof HTMLInputElement ? event.target.value : '');
  }

  searchUsers(event?: Event): void {
    event?.preventDefault();
    this.appliedSearchQuery.set(this.searchQuery());
    this.appliedRoleFilter.set(this.roleFilter());
    this.appliedPremiumTierFilter.set(this.premiumTierFilter());
    this.appliedPresenceFilter.set(this.presenceFilter());
    this.appliedSortField.set(this.sortField());
    this.appliedSortDirection.set(this.sortDirection());
    this.reloadFirstPage();
  }

  resetFilters(): void {
    this.searchQuery.set(INITIAL_USER_LIST_FILTERS.query);
    this.roleFilter.set(INITIAL_USER_LIST_FILTERS.role);
    this.premiumTierFilter.set(INITIAL_USER_LIST_FILTERS.premiumTier);
    this.presenceFilter.set(INITIAL_USER_LIST_FILTERS.presence);
    this.sortField.set(INITIAL_USER_LIST_FILTERS.sort);
    this.sortDirection.set(INITIAL_USER_LIST_FILTERS.direction);
  }

  changeRoleFilter(value: string): void {
    if (value === 'all' || this.isAuthorizationRole(value)) {
      this.roleFilter.set(value);
    }
  }

  changePremiumTierFilter(value: string): void {
    if (value === 'all' || this.isPremiumTier(value)) {
      this.premiumTierFilter.set(value);
    }
  }

  changePresenceFilter(value: string): void {
    if (this.isPresenceFilter(value)) {
      this.presenceFilter.set(value);
    }
  }

  changeSort(field: SortField): void {
    if (this.sortField() === field) {
      this.sortDirection.update((direction) => direction === 'asc' ? 'desc' : 'asc');
      this.appliedSortField.set(field);
      this.appliedSortDirection.set(this.sortDirection());
      this.reloadFirstPage();
      return;
    }

    this.sortField.set(field);
    this.sortDirection.set(this.defaultSortDirection(field));
    this.appliedSortField.set(field);
    this.appliedSortDirection.set(this.sortDirection());
    this.reloadFirstPage();
  }

  changeMobileSort(value: string): void {
    if (!this.isSortField(value) || this.sortField() === value) {
      return;
    }

    this.sortField.set(value);
    this.sortDirection.set(this.defaultSortDirection(value));
  }

  toggleSortDirection(): void {
    this.sortDirection.update((direction) => direction === 'asc' ? 'desc' : 'asc');
  }

  previousPage(): void {
    if (this.currentPage() <= 1) {
      return;
    }

    this.currentPage.update((page) => page - 1);
    this.loadUsers();
  }

  nextPage(): void {
    if (this.currentPage() >= this.totalPages()) {
      return;
    }

    this.currentPage.update((page) => page + 1);
    this.loadUsers();
  }

  sortLabel(field: SortField): string {
    if (this.sortField() !== field) {
      return this.translateText('admin.users.sort.notSorted');
    }

    return this.translateText(this.sortDirection() === 'asc' ? 'admin.users.sort.ascending' : 'admin.users.sort.descending');
  }

  mobileSortDirectionLabel(): string {
    return this.translateText(this.sortDirection() === 'asc' ? 'admin.users.sort.asc' : 'admin.users.sort.desc');
  }

  sortAriaLabel(field: SortField): string {
    return this.translateText('admin.users.sort.ariaLabel', {
      field: this.sortFieldLabel(field),
      direction: this.sortLabel(field),
    });
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
    const key = this.allRoleOptions.find((option) => option.id === role)?.labelKey;

    return key ? this.translateText(key) : role;
  }

  premiumTierLabel(tier: PremiumTier): string {
    const key = this.premiumTierOptions.find((option) => option.id === tier)?.labelKey;

    return key ? this.translateText(key) : tier;
  }

  presenceLabel(status: AdminUserPresenceStatus): string {
    const key = this.presenceFilterOptions.find((option) => option.id === status)?.labelKey;

    return key ? this.translateText(key) : status;
  }

  lastConnectionDaysAgoLabel(lastConnectedAt: string): string {
    const timestamp = Date.parse(lastConnectedAt);
    const elapsedDays = Number.isFinite(timestamp)
      ? Math.max(0, Math.floor((Date.now() - timestamp) / AdminUsersPanelComponent.DAY_MS))
      : 0;

    if (elapsedDays === 0) {
      return this.translateText('admin.users.lastConnectedToday');
    }
    if (elapsedDays === 1) {
      return this.translateText('admin.users.lastConnectedYesterday');
    }

    return this.translateText('admin.users.lastConnectedAgo', { count: elapsedDays });
  }

  isUserBusy(userId: string): boolean {
    return this.pendingActions()[userId] !== undefined;
  }

  isUserRowDisabled(user: AdminUser): boolean {
    return !this.canChangeRole(user)
      && !this.canChangePremium(user)
      && !this.canRevokeSessions(user)
      && !this.canDeleteUser(user)
      && !this.canImpersonate(user);
  }

  canChangeRole(user: AdminUser): boolean {
    return this.currentUserRole() === ROLE_OWNER && this.canManageLowerRole(user);
  }

  canChangePremium(user: AdminUser): boolean {
    return this.canUseManagementActions() && (this.canManageLowerRole(user) || this.isOwnerActingOnOwner(user));
  }

  canRevokeSessions(user: AdminUser): boolean {
    return this.canChangePremium(user);
  }

  canDeleteUser(user: AdminUser): boolean {
    return this.canUseManagementActions() && this.canManageLowerRole(user);
  }

  canImpersonate(user: AdminUser): boolean {
    const currentUserId = this.currentUserId();
    if (currentUserId === null || user.id === currentUserId) {
      return false;
    }

    switch (this.currentUserRole()) {
      case ROLE_OWNER:
        return true;
      case ROLE_ADMIN:
        return user.authorizationRole === ROLE_SUPPORT || user.authorizationRole === ROLE_USER;
      case ROLE_SUPPORT:
        return user.authorizationRole === ROLE_USER;
      case ROLE_USER:
        return false;
    }
  }

  private canManageLowerRole(user: AdminUser): boolean {
    const currentUserId = this.currentUserId();
    if (currentUserId === null || user.id === currentUserId) {
      return false;
    }

    return isLowerAuthorizationRole(user.authorizationRole, this.currentUserRole());
  }

  private canUseManagementActions(): boolean {
    return this.currentUserRole() === ROLE_ADMIN || this.currentUserRole() === ROLE_OWNER;
  }

  private isOwnerActingOnOwner(user: AdminUser): boolean {
    return this.currentUserRole() === ROLE_OWNER && user.authorizationRole === ROLE_OWNER;
  }

  trackUser(_index: number, user: AdminUser): string {
    return user.id;
  }

  trackLocalizationItem(_index: number, item: AdminUsersLocalizationItem): string {
    return item.code ?? 'unknown';
  }

  localizationItemLabel(item: AdminUsersLocalizationItem): string {
    if (this.selectedLocalizationView().dimension === 'languages' && item.code !== null) {
      return LATIN_LANGUAGE_LABELS[item.code] ?? item.code;
    }

    return item.name ?? this.translateText('deckBuilder.advancedAnalysis.status.unknown');
  }

  private sortFieldLabel(field: SortField): string {
    const key = this.sortFieldOptions.find((option) => option.id === field)?.labelKey;

    return key ? this.translateText(key) : field;
  }

  private defaultSortDirection(field: SortField): SortDirection {
    return field === 'createdAt' || field === 'lastConnectedAt' || field === 'totalDecks' ? 'desc' : 'asc';
  }

  private percentageOfUsers(value: number, total: number): number {
    return total === 0 ? 0 : Math.round((value / total) * 100);
  }

  private isLocalizationView(value: string): value is LocalizationView {
    return LOCALIZATION_VIEW_DEFINITIONS.some((view) => view.id === value);
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

  private reloadFirstPage(): void {
    this.currentPage.set(1);
    this.loadUsers();
  }

  private listQuery(): AdminUsersListQuery {
    return {
      query: this.appliedSearchQuery(),
      role: this.appliedRoleFilter(),
      premiumTier: this.appliedPremiumTierFilter(),
      status: this.appliedPresenceFilter(),
      sort: this.appliedSortField(),
      direction: this.appliedSortDirection(),
      page: this.currentPage(),
      limit: this.pageSize,
    };
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
        next: () => this.loadUsers(),
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
        next: () => this.loadUsers(),
        error: (error: unknown) => this.errorMessage.set(this.readErrorMessage(error)),
      });
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
    return this.allRoleOptions.some((option) => option.id === value);
  }

  private isAssignableAuthorizationRole(value: string): value is Exclude<AuthorizationRole, typeof ROLE_OWNER> {
    return this.roleOptions.some((option) => option.id === value);
  }

  private isPremiumTier(value: string): value is PremiumTier {
    return this.premiumTierOptions.some((option) => option.id === value);
  }

  private isPresenceFilter(value: string): value is PresenceFilter {
    return this.presenceFilterOptions.some((option) => option.id === value);
  }

  private isSortField(value: string): value is SortField {
    return this.sortFieldOptions.some((option) => option.id === value);
  }

  private readErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }

    return this.translateText('admin.users.errors.actionFailed');
  }

  private translateText(key: string, params?: Record<string, unknown>): string {
    const translated = this.translation.instant(key, params);

    return typeof translated === 'string' && translated !== key
      ? translated
      : runtimeTranslationFallback(key, params);
  }
}
