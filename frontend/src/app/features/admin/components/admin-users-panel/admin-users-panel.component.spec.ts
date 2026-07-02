import { signal } from '@angular/core';
import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Hammer, LucideAngularModule, MoveDown, MoveUp, Send } from 'lucide-angular';
import { of } from 'rxjs';
import { AuthStore } from '../../../../core/auth/auth.store';
import { ROLE_ADMIN, ROLE_OWNER, ROLE_USER } from '../../../../core/auth/user-roles';
import { User } from '../../../../core/models/user.model';
import { AdminUsersApi } from '../../data-access/admin-users.api';
import { AdminUser } from '../../data-access/admin-users.models';
import { AdminUsersPanelComponent } from './admin-users-panel.component';

interface AdminUsersApiMock {
  readonly deleteUser: ReturnType<typeof vi.fn>;
  readonly listUsers: ReturnType<typeof vi.fn>;
  readonly impersonateUser: ReturnType<typeof vi.fn>;
  readonly removeFromRooms: ReturnType<typeof vi.fn>;
  readonly revokeSessions: ReturnType<typeof vi.fn>;
  readonly updateUser: ReturnType<typeof vi.fn>;
}

describe('AdminUsersPanelComponent', () => {
  let api: AdminUsersApiMock;
  let fixture: ComponentFixture<AdminUsersPanelComponent>;
  let navigate: ReturnType<typeof vi.fn>;
  let startImpersonation: ReturnType<typeof vi.fn>;
  const currentAuthUser = signal<User>(authUser('owner-actor', [ROLE_USER, ROLE_OWNER]));

  const user: AdminUser = {
    id: 'user-1',
    displayName: 'CommanderZone',
    email: 'cz@test.com',
    roles: [ROLE_USER],
    authorizationRole: ROLE_USER,
    premiumTier: 'none',
    lastConnectedAt: '2026-07-01T10:00:00+00:00',
    presenceStatus: 'online',
    isOnline: true,
    activeRoomsCount: 2,
    activeSessionsCount: 1,
    createdAt: '2026-06-30T10:00:00+00:00',
  };
  const adminUser: AdminUser = {
    id: 'user-2',
    displayName: 'Admin Tester',
    email: 'admin@test.com',
    roles: [ROLE_USER, ROLE_ADMIN],
    authorizationRole: ROLE_ADMIN,
    premiumTier: 'tier2',
    lastConnectedAt: null,
    presenceStatus: 'offline',
    isOnline: false,
    activeRoomsCount: 0,
    activeSessionsCount: 0,
    createdAt: '2026-06-29T11:00:00+00:00',
  };
  const ownerSelf: AdminUser = {
    id: 'owner-actor',
    displayName: 'Owner Self',
    email: 'owner@test.com',
    roles: [ROLE_USER, ROLE_OWNER],
    authorizationRole: ROLE_OWNER,
    premiumTier: 'tier1',
    lastConnectedAt: '2026-07-01T12:00:00+00:00',
    presenceStatus: 'online',
    isOnline: true,
    activeRoomsCount: 1,
    activeSessionsCount: 1,
    createdAt: '2026-06-28T11:00:00+00:00',
  };
  const ownerPeer: AdminUser = {
    id: 'owner-peer',
    displayName: 'Owner Peer',
    email: 'owner-peer@test.com',
    roles: [ROLE_USER, ROLE_OWNER],
    authorizationRole: ROLE_OWNER,
    premiumTier: 'tier3',
    lastConnectedAt: null,
    presenceStatus: 'offline',
    isOnline: false,
    activeRoomsCount: 1,
    activeSessionsCount: 1,
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
      listUsers: vi.fn().mockReturnValue(of({ users: [user, adminUser, ownerSelf, ownerPeer] })),
      removeFromRooms: vi.fn().mockReturnValue(of({ user })),
      revokeSessions: vi.fn().mockReturnValue(of({ user })),
      updateUser: vi.fn().mockReturnValue(of({ user: { ...user, authorizationRole: ROLE_ADMIN, roles: [ROLE_USER, ROLE_ADMIN] } })),
    };
    navigate = vi.fn().mockResolvedValue(true);
    startImpersonation = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AdminUsersPanelComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Hammer, MoveDown, MoveUp, Send })),
        { provide: AdminUsersApi, useValue: api },
        { provide: AuthStore, useValue: { user: currentAuthUser.asReadonly(), startImpersonation } },
        { provide: Router, useValue: { navigate } },
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
    expect(element.textContent).toContain('Online');
    expect(element.textContent).toContain('1 active session(s)');
    expect(element.textContent).toContain('2 active room(s)');
    expect(summaryValue(fixture, 'Total users')).toBe('4');
    expect(summaryValue(fixture, 'Online')).toBe('2');
    expect(summaryValue(fixture, 'Tier 1')).toBe('1');
    expect(summaryValue(fixture, 'Tier 2')).toBe('1');
    expect(summaryValue(fixture, 'Tier 3')).toBe('1');
  });

  it('asks for confirmation before updating authorization role from the role select', () => {
    selectFormatOption(fixture, 'authorizationRole', 'Admin');

    expect(api.updateUser).not.toHaveBeenCalled();
    clickModalPrimary(fixture);

    expect(api.updateUser).toHaveBeenCalledWith('user-1', { authorizationRole: ROLE_ADMIN });
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

    input.value = 'admin@test.com';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(element.textContent).toContain('Admin Tester');
    expect(element.textContent).not.toContain('CommanderZone');
  });

  it('paginates users in pages of thirty rows', () => {
    fixture.componentInstance.users.set(Array.from({ length: 35 }, (_, index) => pagedUser(index + 1)));
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

    clickButton(fixture, 'Remove rooms');
    expect(api.removeFromRooms).not.toHaveBeenCalled();
    clickModalPrimary(fixture);

    clickButton(fixture, 'Delete');
    expect(api.deleteUser).not.toHaveBeenCalled();
    clickModalPrimary(fixture);

    expect(api.revokeSessions).toHaveBeenCalledWith('user-1');
    expect(api.removeFromRooms).toHaveBeenCalledWith('user-1');
    expect(api.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('emits the selected username when the send message action is clicked', () => {
    const sendMessageSpy = vi.fn();
    fixture.componentInstance.sendMessageRequested.subscribe(sendMessageSpy);

    buttonByLabel(fixture, 'Send message to CommanderZone')?.click();
    fixture.detectChanges();

    expect(sendMessageSpy).toHaveBeenCalledWith({ id: 'user-1', name: 'CommanderZone' });
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

  it('disables session and room actions when the user has no active data', () => {
    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'));
    const adminRow = rows.find((row) => row.textContent?.includes('Admin Tester')) as HTMLTableRowElement | undefined;
    const closeSessions = buttonIn(adminRow, 'Close sessions');
    const removeRooms = buttonIn(adminRow, 'Remove rooms');

    expect(closeSessions?.disabled).toBe(true);
    expect(removeRooms?.disabled).toBe(true);
  });

  it('keeps owner premium, session and room actions enabled while blocking role and delete', () => {
    const selfRow = rowContaining(fixture, 'Owner Self');
    const ownerPeerRow = rowContaining(fixture, 'Owner Peer');

    expect(formatSelectTriggerIn(selfRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(selfRow, 'premiumTier')?.disabled).toBe(false);
    expect(buttonIn(selfRow, 'Close sessions')?.disabled).toBe(false);
    expect(buttonIn(selfRow, 'Remove rooms')?.disabled).toBe(false);
    expect(buttonIn(selfRow, 'Delete')?.disabled).toBe(true);

    expect(formatSelectTriggerIn(ownerPeerRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(ownerPeerRow, 'premiumTier')?.disabled).toBe(false);
    expect(buttonIn(ownerPeerRow, 'Close sessions')?.disabled).toBe(false);
    expect(buttonIn(ownerPeerRow, 'Remove rooms')?.disabled).toBe(false);
    expect(buttonIn(ownerPeerRow, 'Delete')?.disabled).toBe(true);
  });

  it('lets admins manage lower users but disables admin peers and role changes', () => {
    currentAuthUser.set(authUser('admin-actor', [ROLE_USER, ROLE_ADMIN]));
    fixture.detectChanges();

    const userRow = rowContaining(fixture, 'CommanderZone');
    const adminRow = rowContaining(fixture, 'Admin Tester');

    expect(formatSelectTriggerIn(userRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(userRow, 'premiumTier')?.disabled).toBe(false);
    expect(buttonIn(userRow, 'Delete')?.disabled).toBe(false);
    expect(buttonByLabelIn(userRow, 'Impersonate CommanderZone')?.disabled).toBe(true);

    expect(formatSelectTriggerIn(adminRow, 'authorizationRole')?.disabled).toBe(true);
    expect(formatSelectTriggerIn(adminRow, 'premiumTier')?.disabled).toBe(true);
    expect(buttonIn(adminRow, 'Delete')?.disabled).toBe(true);
  });
});

function selectFormatOption(fixture: ComponentFixture<AdminUsersPanelComponent>, inputName: string, optionText: string): void {
  const nativeElement = fixture.nativeElement as HTMLElement;
  const selectHost = nativeElement.querySelector(`app-format-select input[name="${inputName}"]`)
    ?.closest('app-format-select') as HTMLElement | null;
  const trigger = selectHost?.querySelector('.format-select-trigger') as HTMLButtonElement | null;
  trigger?.click();
  fixture.detectChanges();

  const option = Array.from(selectHost?.querySelectorAll('.format-select-option') ?? [])
    .find((candidate) => candidate.textContent?.includes(optionText)) as HTMLButtonElement | undefined;
  option?.click();
  fixture.detectChanges();
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
  const pill = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.admin-users-summary-pill'))
    .find((candidate) => candidate.textContent?.includes(label));

  return pill?.querySelector('dd')?.textContent?.trim();
}

function tableRowCount(fixture: ComponentFixture<AdminUsersPanelComponent>): number {
  return (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length;
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
    email: `paged-${index}@test.com`,
    roles: [ROLE_USER],
    authorizationRole: ROLE_USER,
    premiumTier: 'none',
    lastConnectedAt: null,
    presenceStatus: 'offline',
    isOnline: false,
    activeRoomsCount: 0,
    activeSessionsCount: 0,
    createdAt: `2026-06-${String(Math.max(1, Math.min(index, 30))).padStart(2, '0')}T10:00:00+00:00`,
  };
}
