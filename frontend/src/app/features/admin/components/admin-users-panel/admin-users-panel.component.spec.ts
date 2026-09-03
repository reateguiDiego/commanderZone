import { signal } from '@angular/core';
import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ChevronDown, ChevronRight, Eye, Hammer, LucideAngularModule, MoveDown, MoveUp, RefreshCcw, Send, Trash2, X } from 'lucide-angular';
import { of } from 'rxjs';
import { AuthStore } from '../../../../core/auth/auth.store';
import { ROLE_ADMIN, ROLE_OWNER, ROLE_SUPPORT, ROLE_USER } from '../../../../core/auth/user-roles';
import { User } from '../../../../core/models/user.model';
import { AdminUsersApi } from '../../data-access/admin-users.api';
import { AdminUser, AdminUsersListQuery, AdminUsersResponse } from '../../data-access/admin-users.models';
import { AdminUsersPanelComponent } from './admin-users-panel.component';

interface AdminUsersApiMock {
  readonly deleteUser: ReturnType<typeof vi.fn>;
  readonly listUsers: ReturnType<typeof vi.fn>;
  readonly impersonateUser: ReturnType<typeof vi.fn>;
  readonly revokeSessions: ReturnType<typeof vi.fn>;
  readonly updateUser: ReturnType<typeof vi.fn>;
}

describe('AdminUsersPanelComponent', () => {
  let api: AdminUsersApiMock;
  let fixture: ComponentFixture<AdminUsersPanelComponent>;
  let navigate: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let startImpersonation: ReturnType<typeof vi.fn>;
  const currentAuthUser = signal<User>(authUser('owner-actor', [ROLE_USER, ROLE_OWNER]));

  const user: AdminUser = {
    id: 'user-1',
    displayName: 'CommanderZone',
    publicProfilePath: '/community/users/CommanderZone',
    email: 'cz@test.com',
    authProviders: ['Google'],
    roles: [ROLE_USER],
    authorizationRole: ROLE_USER,
    premiumTier: 'none',
    lastConnectedAt: new Date().toISOString(),
    presenceStatus: 'online',
    isOnline: true,
    activeSessionsCount: 1,
    deckCounts: { total: 3, privateCount: 1, publicCount: 2 },
    localization: { countryCode: 'ES', countryName: 'Spain', appLanguage: 'es' },
    createdAt: new Date().toISOString(),
  };
  const adminUser: AdminUser = {
    id: 'user-2',
    displayName: 'Admin Tester',
    publicProfilePath: '/community/users/Admin-Tester',
    email: 'admin@test.com',
    authProviders: [],
    roles: [ROLE_USER, ROLE_ADMIN],
    authorizationRole: ROLE_ADMIN,
    premiumTier: 'tier2',
    lastConnectedAt: null,
    presenceStatus: 'offline',
    isOnline: false,
    activeSessionsCount: 0,
    deckCounts: { total: 0, privateCount: 0, publicCount: 0 },
    localization: { countryCode: 'DE', countryName: 'Germany', appLanguage: 'en' },
    createdAt: '2026-06-29T11:00:00+00:00',
  };
  const supportUser: AdminUser = {
    id: 'user-support',
    displayName: 'Support Tester',
    publicProfilePath: '/community/users/Support-Tester',
    email: 'support@test.com',
    authProviders: [],
    roles: [ROLE_USER, ROLE_SUPPORT],
    authorizationRole: ROLE_SUPPORT,
    premiumTier: 'none',
    lastConnectedAt: null,
    presenceStatus: 'offline',
    isOnline: false,
    activeSessionsCount: 0,
    deckCounts: { total: 0, privateCount: 0, publicCount: 0 },
    localization: { countryCode: null, countryName: null, appLanguage: 'en' },
    createdAt: '2026-06-29T10:00:00+00:00',
  };
  const ownerSelf: AdminUser = {
    id: 'owner-actor',
    displayName: 'Owner Self',
    publicProfilePath: '/community/users/Owner-Self',
    email: 'owner@test.com',
    authProviders: [],
    roles: [ROLE_USER, ROLE_OWNER],
    authorizationRole: ROLE_OWNER,
    premiumTier: 'tier1',
    lastConnectedAt: '2026-07-01T12:00:00+00:00',
    presenceStatus: 'online',
    isOnline: true,
    activeSessionsCount: 1,
    deckCounts: { total: 1, privateCount: 1, publicCount: 0 },
    localization: { countryCode: null, countryName: null, appLanguage: 'en' },
    createdAt: '2026-06-28T11:00:00+00:00',
  };
  const ownerPeer: AdminUser = {
    id: 'owner-peer',
    displayName: 'Owner Peer',
    publicProfilePath: '/community/users/Owner-Peer',
    email: 'owner-peer@test.com',
    authProviders: [],
    roles: [ROLE_USER, ROLE_OWNER],
    authorizationRole: ROLE_OWNER,
    premiumTier: 'tier3',
    lastConnectedAt: null,
    presenceStatus: 'offline',
    isOnline: false,
    activeSessionsCount: 1,
    deckCounts: { total: 1, privateCount: 0, publicCount: 1 },
    localization: { countryCode: null, countryName: null, appLanguage: 'en' },
    createdAt: '2026-06-27T11:00:00+00:00',
  };

  beforeEach(async () => {
    currentAuthUser.set(authUser('owner-actor', [ROLE_USER, ROLE_OWNER]));
    api = {
      deleteUser: vi.fn().mockReturnValue(of(void 0)),
      impersonateUser: vi.fn().mockReturnValue(of({
        token: 'impersonated-token',
        user: authUser(user.id, [ROLE_USER]),
        impersonation: {
          active: true,
          impersonatorId: 'owner-actor',
          targetUserId: user.id,
        },
      })),
      listUsers: vi.fn((query: AdminUsersListQuery) => of(adminUsersResponse([user, adminUser, supportUser, ownerSelf, ownerPeer], query))),
      revokeSessions: vi.fn().mockReturnValue(of({ user })),
      updateUser: vi.fn().mockReturnValue(of({ user: { ...user, authorizationRole: ROLE_ADMIN, roles: [ROLE_USER, ROLE_ADMIN] } })),
    };
    navigate = vi.fn().mockResolvedValue(true);
    navigateByUrl = vi.fn().mockResolvedValue(true);
    startImpersonation = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AdminUsersPanelComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ChevronDown, ChevronRight, Eye, Hammer, MoveDown, MoveUp, RefreshCcw, Send, Trash2, X })),
        { provide: AdminUsersApi, useValue: api },
        { provide: AuthStore, useValue: { user: currentAuthUser.asReadonly(), startImpersonation } },
        { provide: Router, useValue: { navigate, navigateByUrl } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminUsersPanelComponent);
    fixture.detectChanges();
  });

  it('renders users returned by the admin API', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(api.listUsers).toHaveBeenCalled();
    expect(element.textContent).toContain('CommanderZone');
    expect(element.textContent).toContain('cz@test.com');
    expect(element.textContent).toContain('Google');
    expect(element.textContent).not.toContain('google-cz@test.com');
    expect(element.textContent).not.toContain('google-user-1');
    expect(element.textContent).toContain('Online');
    expect(element.textContent).toContain('1 active session(s)');
    expect(element.textContent).toContain('Total3');
    expect(element.textContent).toContain('Private1');
    expect(element.textContent).toContain('Public2');
    expect(element.textContent).toContain('Spain');
    expect(element.textContent).toContain('Español');
    expect(summaryValue(fixture, 'Total users')).toBe('5');
    expect(summaryValue(fixture, 'Total decks')).toBe('5');
    expect(summaryValue(fixture, 'New users last 7 days')).toBe('1');
    expect(summaryValue(fixture, 'Online')).toBe('2');
    expect(summaryValue(fixture, 'Online last 7 days')).toBe('1');
    expect(summaryValue(fixture, 'Never connected')).toBe('3');
    expect(summaryValue(fixture, 'Tier 0')).toBe('2');
    expect(summaryValue(fixture, 'Tier 1')).toBe('1');
    expect(summaryValue(fixture, 'Tier 2')).toBe('1');
    expect(summaryValue(fixture, 'Tier 3')).toBe('1');
  });

  it('shows online and in-game users by default', () => {
    expect(fixture.componentInstance.presenceFilter()).toBe('active');
    expect(tableRowCount(fixture)).toBe(2);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('CommanderZone');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Owner Self');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Support Tester');
    expect(api.listUsers).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('falls back to new users from the last seven days when the initial active filter is empty', () => {
    api.listUsers.mockClear();
    api.listUsers.mockImplementation((query: AdminUsersListQuery) => {
      const response = adminUsersResponse([user, adminUser, supportUser, ownerSelf, ownerPeer], query);

      return of(query.status === 'active'
        ? { ...response, users: [], total: 0, totalPages: 1, page: 1 }
        : response);
    });

    const fallbackFixture = TestBed.createComponent(AdminUsersPanelComponent);
    fallbackFixture.detectChanges();

    expect(fallbackFixture.componentInstance.presenceFilter()).toBe('recently_created');
    expect(api.listUsers).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'active' }));
    expect(api.listUsers).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'recently_created' }));
    expect((fallbackFixture.nativeElement as HTMLElement).textContent).toContain('CommanderZone');
  });

  it('shows the elapsed days below a known last connection', () => {
    const lastConnection = (fixture.nativeElement as HTMLElement).querySelector('.admin-users-last-connection');

    expect(lastConnection?.textContent).toContain('Today');
  });

  it('shows a country name resolved from its code without exposing the country code', () => {
    showAllUsers(fixture);

    const localization = rowContaining(fixture, 'Admin Tester')?.querySelector('.admin-users-localization')?.textContent;

    expect(localization).toContain('Germany');
    expect(localization).not.toContain('DE');
  });

  it('shows the all-users location summary from the already loaded data and closes it from its icon button', () => {
    clickButton(fixture, 'Location');

    const table = (fixture.nativeElement as HTMLElement).querySelector('.admin-users-localization-table') as HTMLTableElement | null;
    const rows = Array.from(table?.querySelectorAll('tbody tr') ?? []) as HTMLTableRowElement[];

    expect(api.listUsers).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.textContent?.includes('All users'))?.textContent).toContain('100%');
    expect(rows.find((row) => row.textContent?.includes('Spain'))?.textContent).toContain('20%');
    expect(rows.find((row) => row.textContent?.includes('Germany'))?.textContent).toContain('20%');
    expect(rows.find((row) => row.textContent?.includes('Unknown'))?.textContent).toContain('60%');

    buttonByLabel(fixture, 'Close locations')?.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.admin-users-localization-table')).toBeNull();
  });

  it('switches the location summary between active countries, continents, and languages', () => {
    clickButton(fixture, 'Location');

    selectFormatOption(fixture, 'admin-user-localization-view', 'Countries · active users');
    let rows = localizationRows(fixture);
    expect(rows.find((row) => row.textContent?.includes('Active users'))?.textContent).toContain('2');
    expect(rows.find((row) => row.textContent?.includes('Spain'))?.textContent).toContain('50%');

    selectFormatOption(fixture, 'admin-user-localization-view', 'Continents · active users');
    rows = localizationRows(fixture);
    expect(rows.find((row) => row.textContent?.includes('Europe'))?.textContent).toContain('50%');
    expect(rows.find((row) => row.textContent?.includes('Unknown'))?.textContent).toContain('50%');

    selectFormatOption(fixture, 'admin-user-localization-view', 'Languages · active users');
    rows = localizationRows(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('.admin-users-localization-table thead')?.textContent).toContain('Language');
    expect(rows.find((row) => row.textContent?.includes('Spanish'))?.textContent).toContain('50%');
    expect(rows.find((row) => row.textContent?.includes('English'))?.textContent).toContain('50%');
  });

  it('uses Latin labels for every language in the location summary', () => {
    fixture.componentInstance.changeLocalizationView('languages_all');

    expect(fixture.componentInstance.localizationItemLabel({ code: 'ja', name: '日本語', userCount: 1, share: 100 })).toBe('Japanese');
    expect(fixture.componentInstance.localizationItemLabel({ code: 'ru', name: 'Русский', userCount: 1, share: 100 })).toBe('Russian');
    expect(fixture.componentInstance.localizationItemLabel({ code: 'zhs', name: '简体中文', userCount: 1, share: 100 })).toBe('Chinese (Simplified)');
  });

  it('asks for confirmation before updating authorization role from the role select', () => {
    selectFormatOption(fixture, 'authorizationRole', 'Admin');

    expect(api.updateUser).not.toHaveBeenCalled();
    clickModalPrimary(fixture);

    expect(api.updateUser).toHaveBeenCalledWith('user-1', { authorizationRole: ROLE_ADMIN });
  });

  it('does not expose owner as an assignable role in the role select', () => {
    const options = openFormatSelectOptions(fixture, 'authorizationRole');

    expect(options.map((option) => option.textContent?.trim())).toEqual(['User', 'Support', 'Admin']);
  });

  it('uses the shared all label for every user filter', () => {
    expect(fixture.componentInstance.roleFilterOptions[0].labelKey).toBe('shared.text.all');
    expect(fixture.componentInstance.premiumTierFilterOptions[0].labelKey).toBe('shared.text.all');
    expect(fixture.componentInstance.presenceFilterOptions[0].labelKey).toBe('shared.text.all');
  });

  it('asks for confirmation before updating premium tier from the premium select', () => {
    selectFormatOption(fixture, 'premiumTier', 'Tier 2');

    expect(api.updateUser).not.toHaveBeenCalled();
    clickModalPrimary(fixture);

    expect(api.updateUser).toHaveBeenCalledWith('user-1', { premiumTier: 'tier2' });
  });

  it('filters users from the search input', () => {
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector('input[name="adminUserSearch"]') as HTMLInputElement;

    fixture.componentInstance.changePresenceFilter('all');
    input.value = 'admin@test.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(api.listUsers).toHaveBeenCalledTimes(1);
    clickButton(fixture, 'Search');

    expect(element.textContent).toContain('Admin Tester');
    expect(element.textContent).not.toContain('CommanderZone');
    expect(api.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'admin@test.com' }));
  });

  it('keeps filter and sorting selections pending until search is submitted', () => {
    api.listUsers.mockClear();

    fixture.componentInstance.changeRoleFilter(ROLE_ADMIN);
    fixture.componentInstance.changePremiumTierFilter('tier2');
    fixture.componentInstance.changePresenceFilter('offline');
    fixture.componentInstance.changeMobileSort('name');
    fixture.componentInstance.toggleSortDirection();

    expect(api.listUsers).not.toHaveBeenCalled();

    fixture.componentInstance.searchUsers();

    expect(api.listUsers).toHaveBeenCalledWith(expect.objectContaining({
      role: ROLE_ADMIN,
      premiumTier: 'tier2',
      status: 'offline',
      sort: 'name',
      direction: 'desc',
    }));
  });

  it('keeps the mobile filters and sorting panel closed until toggled', () => {
    const mobileToggle = (fixture.nativeElement as HTMLElement)
      .querySelector('.admin-users-mobile-filter-toggle') as HTMLButtonElement | null;

    expect(fixture.componentInstance.isMobileFiltersOpen()).toBe(false);
    expect(mobileToggle?.getAttribute('aria-expanded')).toBe('false');

    clickButton(fixture, 'Filters and sorting');
    expect(fixture.componentInstance.isMobileFiltersOpen()).toBe(true);
    expect(mobileToggle?.getAttribute('aria-expanded')).toBe('true');

    clickButton(fixture, 'Filters and sorting');
    expect(fixture.componentInstance.isMobileFiltersOpen()).toBe(false);
  });

  it('paginates users in pages of thirty rows', () => {
    const pagedUsers = Array.from({ length: 35 }, (_, index) => pagedUser(index + 1));
    api.listUsers.mockImplementation((query: AdminUsersListQuery) => of(adminUsersResponse(pagedUsers, query)));
    fixture.componentInstance.changePresenceFilter('all');
    fixture.componentInstance.searchUsers();
    fixture.detectChanges();

    expect(tableRowCount(fixture)).toBe(30);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Showing 1-30 of 35');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Page 1 of 2');

    clickButton(fixture, 'Next');

    expect(tableRowCount(fixture)).toBe(5);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Showing 31-35 of 35');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Page 2 of 2');
  });

  it('runs user row actions only after confirmation', () => {
    clickButton(fixture, 'Close sessions');
    expect(api.revokeSessions).not.toHaveBeenCalled();
    clickModalPrimary(fixture);

    buttonByLabel(fixture, 'Delete user')?.click();
    fixture.detectChanges();
    expect(api.deleteUser).not.toHaveBeenCalled();
    clickModalPrimary(fixture);

    expect(api.revokeSessions).toHaveBeenCalledWith('user-1');
    expect(api.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('filters users connected during the last seven days from lastConnectedAt', () => {
    fixture.componentInstance.changePresenceFilter('recently_connected');
    fixture.componentInstance.searchUsers();
    fixture.detectChanges();

    expect(tableRowCount(fixture)).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('CommanderZone');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Admin Tester');
  });

  it('filters users created during the last seven days from createdAt', () => {
    fixture.componentInstance.changePresenceFilter('recently_created');
    fixture.componentInstance.searchUsers();
    fixture.detectChanges();

    expect(tableRowCount(fixture)).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('CommanderZone');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Admin Tester');
  });

  it('filters users that have never connected', () => {
    fixture.componentInstance.changePresenceFilter('never_connected');
    fixture.componentInstance.searchUsers();
    fixture.detectChanges();

    expect(tableRowCount(fixture)).toBe(3);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Admin Tester');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('CommanderZone');
  });

  it('sorts users from the mobile controls in both directions', () => {
    showAllUsers(fixture);
    selectFormatOption(fixture, 'mobileUserSort', 'Name');
    fixture.componentInstance.searchUsers();
    fixture.detectChanges();

    expect(rowContaining(fixture, 'Admin Tester')).toBe(tableRows(fixture)[0]);

    const directionButton = (fixture.nativeElement as HTMLElement)
      .querySelector('.admin-users-mobile-sort-direction') as HTMLButtonElement;
    expect(directionButton.textContent).toContain('Asc');

    directionButton.click();
    fixture.componentInstance.searchUsers();
    fixture.detectChanges();

    expect(rowContaining(fixture, 'Support Tester')).toBe(tableRows(fixture)[0]);
    expect(directionButton.textContent).toContain('Desc');
  });

  it('sorts users by total decks with the highest count first', () => {
    showAllUsers(fixture);

    fixture.componentInstance.changeSort('totalDecks');
    fixture.componentInstance.searchUsers();
    fixture.detectChanges();

    expect(fixture.componentInstance.sortDirection()).toBe('desc');
    expect(rowContaining(fixture, 'CommanderZone')).toBe(tableRows(fixture)[0]);
  });

  it('uses the requested theme tones for summary pills', () => {
    expect(summaryPill(fixture, 'Online')?.classList).toContain('admin-users-summary-pill--success');
    expect(summaryPill(fixture, 'Online last 7 days')?.classList).toContain('admin-users-summary-pill--success');
    expect(summaryPill(fixture, 'New users last 7 days')?.classList).toContain('admin-users-summary-pill--success');
    expect(summaryPill(fixture, 'Never connected')?.classList).toContain('admin-users-summary-pill--danger');
    expect(summaryPill(fixture, 'Tier 0')?.classList).toContain('admin-users-summary-pill--danger');
    expect(summaryPill(fixture, 'Tier 1')?.classList).toContain('admin-users-summary-pill--warning');
    expect(summaryPill(fixture, 'Tier 2')?.classList).toContain('admin-users-summary-pill--info');
    expect(summaryPill(fixture, 'Tier 3')?.classList).toContain('admin-users-summary-pill--success');
  });

  it('shows each premium tier share of the total user count', () => {
    expect(summaryPill(fixture, 'Tier 0')?.textContent).toContain('40%');
    expect(summaryPill(fixture, 'Tier 1')?.textContent).toContain('20%');
    expect(summaryPill(fixture, 'Tier 2')?.textContent).toContain('20%');
    expect(summaryPill(fixture, 'Tier 3')?.textContent).toContain('20%');
  });

  it('emits the selected username when the send message action is clicked', () => {
    const sendMessageSpy = vi.fn();
    fixture.componentInstance.sendMessageRequested.subscribe(sendMessageSpy);

    buttonByLabel(fixture, 'Send message to CommanderZone')?.click();
    fixture.detectChanges();

    expect(sendMessageSpy).toHaveBeenCalledWith({ id: 'user-1', name: 'CommanderZone' });
  });

  it('opens the selected user public profile in a new tab from the view action', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    buttonByLabel(fixture, 'View profile for CommanderZone')?.click();
    fixture.detectChanges();

    expect(openSpy).toHaveBeenCalledWith('/community/users/CommanderZone', '_blank', 'noopener');
    openSpy.mockRestore();
  });

  it('asks for confirmation before impersonating a lower-role user', () => {
    buttonByLabel(fixture, 'Impersonate CommanderZone')?.click();
    fixture.detectChanges();

    expect(api.impersonateUser).not.toHaveBeenCalled();
    clickModalPrimary(fixture);

    expect(api.impersonateUser).toHaveBeenCalledWith('user-1');
    expect(startImpersonation).toHaveBeenCalledWith('impersonated-token', expect.objectContaining({ id: 'user-1' }), {
      active: true,
      impersonatorId: 'owner-actor',
      targetUserId: 'user-1',
    });
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('disables session actions when the user has no active sessions', () => {
    showAllUsers(fixture);

    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'));
    const adminRow = rows.find((row) => row.textContent?.includes('Admin Tester')) as HTMLTableRowElement | undefined;
    const closeSessions = buttonIn(adminRow, 'Close sessions');

    expect(closeSessions?.disabled).toBe(true);
  });

  it('groups every icon action into one mobile action row', () => {
    const iconActions = rowContaining(fixture, 'CommanderZone')?.querySelectorAll('.admin-users-icon-actions .admin-users-icon-action');

    expect(iconActions).toHaveLength(4);
  });

  it('keeps owner premium and session actions enabled while blocking role and delete', () => {
    showAllUsers(fixture);

    const selfRow = rowContaining(fixture, 'Owner Self');
    const ownerPeerRow = rowContaining(fixture, 'Owner Peer');

    expect(formatSelectTriggerIn(selfRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(selfRow, 'premiumTier')?.disabled).toBe(false);
    expect(buttonIn(selfRow, 'Close sessions')?.disabled).toBe(false);
    expect(buttonByLabelIn(selfRow, 'Delete user')?.disabled).toBe(true);

    expect(formatSelectTriggerIn(ownerPeerRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(ownerPeerRow, 'premiumTier')?.disabled).toBe(false);
    expect(buttonIn(ownerPeerRow, 'Close sessions')?.disabled).toBe(false);
    expect(buttonByLabelIn(ownerPeerRow, 'Delete user')?.disabled).toBe(true);
  });

  it('lets admins manage lower users but disables admin peers and role changes', () => {
    showAllUsers(fixture);
    currentAuthUser.set(authUser('admin-actor', [ROLE_USER, ROLE_ADMIN]));
    fixture.detectChanges();

    const userRow = rowContaining(fixture, 'CommanderZone');
    const supportRow = rowContaining(fixture, 'Support Tester');
    const adminRow = rowContaining(fixture, 'Admin Tester');

    expect(formatSelectTriggerIn(userRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(userRow, 'premiumTier')?.disabled).toBe(false);
    expect(buttonByLabelIn(userRow, 'Delete user')?.disabled).toBe(false);
    expect(buttonByLabelIn(userRow, 'Impersonate CommanderZone')?.disabled).toBe(false);

    expect(formatSelectTriggerIn(supportRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(supportRow, 'premiumTier')?.disabled).toBe(false);
    expect(buttonByLabelIn(supportRow, 'Delete user')?.disabled).toBe(false);
    expect(buttonByLabelIn(supportRow, 'Impersonate Support Tester')?.disabled).toBe(false);

    expect(formatSelectTriggerIn(adminRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(adminRow, 'premiumTier')?.disabled).toBe(true);
    expect(buttonByLabelIn(adminRow, 'Delete user')?.disabled).toBe(true);
    expect(buttonByLabelIn(adminRow, 'Impersonate Admin Tester')?.disabled).toBe(true);
  });

  it('lets support impersonate only regular users without exposing management actions', () => {
    showAllUsers(fixture);
    currentAuthUser.set(authUser('support-actor', [ROLE_USER, ROLE_SUPPORT]));
    fixture.detectChanges();

    const userRow = rowContaining(fixture, 'CommanderZone');
    const supportRow = rowContaining(fixture, 'Support Tester');
    const adminRow = rowContaining(fixture, 'Admin Tester');

    expect(formatSelectTriggerIn(userRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(userRow, 'premiumTier')?.disabled).toBe(true);
    expect(buttonByLabelIn(userRow, 'Delete user')?.disabled).toBe(true);
    expect(buttonByLabelIn(userRow, 'Impersonate CommanderZone')?.disabled).toBe(false);

    expect(buttonByLabelIn(supportRow, 'Impersonate Support Tester')?.disabled).toBe(true);
    expect(buttonByLabelIn(adminRow, 'Impersonate Admin Tester')?.disabled).toBe(true);
  });
});

function selectFormatOption(fixture: ComponentFixture<AdminUsersPanelComponent>, inputName: string, optionText: string): void {
  const option = openFormatSelectOptions(fixture, inputName)
    .find((candidate) => candidate.textContent?.includes(optionText)) as HTMLButtonElement | undefined;
  option?.click();
  fixture.detectChanges();
}

function openFormatSelectOptions(fixture: ComponentFixture<AdminUsersPanelComponent>, inputName: string): HTMLButtonElement[] {
  const nativeElement = fixture.nativeElement as HTMLElement;
  const selectHost = nativeElement.querySelector(`app-format-select input[name="${inputName}"]`)
    ?.closest('app-format-select') as HTMLElement | null;
  const trigger = selectHost?.querySelector('.format-select-trigger') as HTMLButtonElement | null;
  trigger?.click();
  fixture.detectChanges();

  return Array.from(selectHost?.querySelectorAll('.format-select-option') ?? []) as HTMLButtonElement[];
}

function buttonByLabelIn(row: HTMLTableRowElement | undefined, label: string): HTMLButtonElement | undefined {
  return row?.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | undefined;
}

function clickButton(fixture: ComponentFixture<AdminUsersPanelComponent>, text: string): void {
  const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(text)) as HTMLButtonElement | undefined;
  button?.click();
  fixture.detectChanges();
}

function clickModalPrimary(fixture: ComponentFixture<AdminUsersPanelComponent>): void {
  const button = (fixture.nativeElement as HTMLElement).querySelector('app-modal .primary-button') as HTMLButtonElement | null;
  button?.click();
  fixture.detectChanges();
}

function buttonIn(row: HTMLTableRowElement | undefined, text: string): HTMLButtonElement | undefined {
  return Array.from(row?.querySelectorAll('button') ?? [])
    .find((candidate) => candidate.textContent?.includes(text)) as HTMLButtonElement | undefined;
}

function buttonByLabel(fixture: ComponentFixture<AdminUsersPanelComponent>, label: string): HTMLButtonElement | undefined {
  return (fixture.nativeElement as HTMLElement).querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | undefined;
}

function rowContaining(fixture: ComponentFixture<AdminUsersPanelComponent>, text: string): HTMLTableRowElement | undefined {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'))
    .find((row) => row.textContent?.includes(text)) as HTMLTableRowElement | undefined;
}

function formatSelectTriggerIn(row: HTMLTableRowElement | undefined, inputName: string): HTMLButtonElement | undefined {
  const selectHost = row?.querySelector(`app-format-select input[name="${inputName}"]`)
    ?.closest('app-format-select') as HTMLElement | null;

  return selectHost?.querySelector('.format-select-trigger') as HTMLButtonElement | undefined;
}

function summaryValue(fixture: ComponentFixture<AdminUsersPanelComponent>, label: string): string | undefined {
  const pill = summaryPill(fixture, label);

  return pill?.querySelector<HTMLElement>('.admin-users-summary-pill-count')?.textContent?.trim()
    ?? pill?.querySelector('dd')?.textContent?.trim();
}

function showAllUsers(fixture: ComponentFixture<AdminUsersPanelComponent>): void {
  fixture.componentInstance.changePresenceFilter('all');
  fixture.componentInstance.searchUsers();
  fixture.detectChanges();
}

function summaryPill(fixture: ComponentFixture<AdminUsersPanelComponent>, label: string): HTMLElement | undefined {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.admin-users-summary-pill'))
    .find((candidate): candidate is HTMLElement => candidate instanceof HTMLElement
      && candidate.querySelector('dt')?.textContent?.trim() === label);
}

function tableRowCount(fixture: ComponentFixture<AdminUsersPanelComponent>): number {
  return tableRows(fixture).length;
}

function tableRows(fixture: ComponentFixture<AdminUsersPanelComponent>): HTMLTableRowElement[] {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')) as HTMLTableRowElement[];
}

function authUser(id: string, roles: readonly string[]): User {
  return {
    id,
    email: `${id}@test.com`,
    displayName: id,
    roles: [...roles],
    premiumTier: 'none',
  };
}

function pagedUser(index: number): AdminUser {
  return {
    id: `paged-user-${index}`,
    displayName: `Paged User ${index}`,
    publicProfilePath: `/community/users/Paged-User-${index}`,
    email: `paged-${index}@test.com`,
    authProviders: [],
    roles: [ROLE_USER],
    authorizationRole: ROLE_USER,
    premiumTier: 'none',
    lastConnectedAt: null,
    presenceStatus: 'offline',
    isOnline: false,
    activeSessionsCount: 0,
    deckCounts: { total: 0, privateCount: 0, publicCount: 0 },
    localization: { countryCode: null, countryName: null, appLanguage: 'en' },
    createdAt: `2026-06-${String(Math.max(1, Math.min(index, 30))).padStart(2, '0')}T10:00:00+00:00`,
  };
}

function adminUsersResponse(allUsers: readonly AdminUser[], query: AdminUsersListQuery): AdminUsersResponse {
  const now = Date.now();
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
  const normalizedQuery = query.query.trim().toLowerCase();
  const filteredUsers = allUsers.filter((candidate) => {
    if (query.role !== 'all' && candidate.authorizationRole !== query.role) {
      return false;
    }
    if (query.premiumTier !== 'all' && candidate.premiumTier !== query.premiumTier) {
      return false;
    }
    if (!matchesStatus(candidate, query.status, now, sevenDaysAgo)) {
      return false;
    }

    return normalizedQuery === ''
      || candidate.displayName.toLowerCase().includes(normalizedQuery)
      || candidate.email.toLowerCase().includes(normalizedQuery);
  });
  const sortedUsers = [...filteredUsers].sort((left, right) => compareAdminUsers(left, right, query));
  const total = sortedUsers.length;
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, totalPages);
  const start = (page - 1) * query.limit;

  return {
    users: sortedUsers.slice(start, start + query.limit),
    page,
    limit: query.limit,
    total,
    totalPages,
    summary: adminUsersSummary(allUsers, now, sevenDaysAgo),
    countries: adminUsersCountries(allUsers),
    localizationSummary: adminUsersLocalizationSummary(allUsers),
  };
}

function matchesStatus(user: AdminUser, status: AdminUsersListQuery['status'], now: number, sevenDaysAgo: number): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'active':
      return user.isOnline;
    case 'online':
    case 'in_game':
    case 'offline':
      return user.presenceStatus === status;
    case 'recently_connected':
      return isDateWithinRange(user.lastConnectedAt, sevenDaysAgo, now);
    case 'recently_created':
      return isDateWithinRange(user.createdAt, sevenDaysAgo, now);
    case 'never_connected':
      return user.lastConnectedAt === null;
  }
}

function compareAdminUsers(left: AdminUser, right: AdminUser, query: AdminUsersListQuery): number {
  const compared = adminUserSortValue(left, query.sort).localeCompare(
    adminUserSortValue(right, query.sort),
    undefined,
    { numeric: true, sensitivity: 'base' },
  );

  return compared === 0 ? left.id.localeCompare(right.id) : compared * (query.direction === 'asc' ? 1 : -1);
}

function adminUserSortValue(user: AdminUser, sort: AdminUsersListQuery['sort']): string {
  switch (sort) {
    case 'name':
      return user.displayName;
    case 'email':
      return user.email;
    case 'lastConnectedAt':
      return user.lastConnectedAt ?? '';
    case 'role':
      return String({ [ROLE_USER]: 1, [ROLE_SUPPORT]: 2, [ROLE_ADMIN]: 3, [ROLE_OWNER]: 4 }[user.authorizationRole]);
    case 'premium':
      return String({ none: 0, tier1: 1, tier2: 2, tier3: 3 }[user.premiumTier]);
    case 'totalDecks':
      return String(user.deckCounts.total);
    case 'createdAt':
      return user.createdAt;
  }
}

function adminUsersSummary(users: readonly AdminUser[], now: number, sevenDaysAgo: number): AdminUsersResponse['summary'] {
  return users.reduce<AdminUsersResponse['summary']>((summary, user) => ({
    total: summary.total + 1,
    online: summary.online + (user.isOnline ? 1 : 0),
    recentlyConnected: summary.recentlyConnected + (isDateWithinRange(user.lastConnectedAt, sevenDaysAgo, now) ? 1 : 0),
    recentlyCreated: summary.recentlyCreated + (isDateWithinRange(user.createdAt, sevenDaysAgo, now) ? 1 : 0),
    neverConnected: summary.neverConnected + (user.lastConnectedAt === null ? 1 : 0),
    totalDecks: summary.totalDecks + user.deckCounts.total,
    tier0: summary.tier0 + (user.premiumTier === 'none' ? 1 : 0),
    tier1: summary.tier1 + (user.premiumTier === 'tier1' ? 1 : 0),
    tier2: summary.tier2 + (user.premiumTier === 'tier2' ? 1 : 0),
    tier3: summary.tier3 + (user.premiumTier === 'tier3' ? 1 : 0),
  }), {
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
  });
}

function adminUsersCountries(users: readonly AdminUser[]): AdminUsersResponse['countries'] {
  const countries = new Map<string, { countryCode: string | null; countryName: string | null; userCount: number }>();

  for (const user of users) {
    const countryCode = user.localization.countryCode;
    const countryKey = countryCode ?? 'unknown';
    const country = countries.get(countryKey);

    countries.set(countryKey, {
      countryCode,
      countryName: country?.countryName ?? user.localization.countryName,
      userCount: (country?.userCount ?? 0) + 1,
    });
  }

  return [...countries.values()].map((country) => ({
    ...country,
    share: Math.round((country.userCount / users.length) * 100),
  }));
}

function adminUsersLocalizationSummary(users: readonly AdminUser[]): AdminUsersResponse['localizationSummary'] {
  const breakdown = (scopedUsers: readonly AdminUser[]) => ({
    totalUsers: scopedUsers.length,
    countries: localizationItems(scopedUsers.map((user) => ({
      code: user.localization.countryCode,
      name: user.localization.countryName,
    })), scopedUsers.length),
    continents: localizationItems(scopedUsers.map((user) => ({
      code: continentForCountry(user.localization.countryCode),
      name: continentForCountry(user.localization.countryCode) === 'EU' ? 'Europe' : null,
    })), scopedUsers.length),
    languages: localizationItems(scopedUsers.map((user) => ({
      code: user.localization.appLanguage,
      name: user.localization.appLanguage,
    })), scopedUsers.length),
  });

  return {
    all: breakdown(users),
    active: breakdown(users.filter((user) => user.isOnline)),
  };
}

function localizationItems(
  entries: readonly { readonly code: string | null; readonly name: string | null }[],
  totalUsers: number,
): AdminUsersResponse['localizationSummary']['all']['countries'] {
  const groups = new Map<string, { code: string | null; name: string | null; userCount: number }>();

  for (const entry of entries) {
    const key = entry.code ?? 'unknown';
    const group = groups.get(key);
    groups.set(key, {
      code: entry.code,
      name: group?.name ?? entry.name,
      userCount: (group?.userCount ?? 0) + 1,
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      share: totalUsers === 0 ? 0 : Math.round((group.userCount / totalUsers) * 100),
    }))
    .sort((left, right) => right.userCount - left.userCount || (left.name ?? '').localeCompare(right.name ?? ''));
}

function continentForCountry(countryCode: string | null): string | null {
  return countryCode === 'ES' || countryCode === 'DE' ? 'EU' : null;
}

function localizationRows(fixture: ComponentFixture<AdminUsersPanelComponent>): HTMLTableRowElement[] {
  const table = (fixture.nativeElement as HTMLElement).querySelector('.admin-users-localization-table');

  return Array.from(table?.querySelectorAll('tbody tr') ?? []) as HTMLTableRowElement[];
}

function isDateWithinRange(value: string | null, from: number, to: number): boolean {
  const timestamp = value === null ? Number.NaN : Date.parse(value);

  return Number.isFinite(timestamp) && timestamp >= from && timestamp <= to;
}
