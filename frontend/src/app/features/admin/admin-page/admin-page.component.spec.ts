import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { Bell, ChevronDown, ChevronRight, Eye, Flag, Hammer, LucideAngularModule, MoveDown, MoveUp, RefreshCcw, Send, ShieldCheck, Trash2, Upload, Users } from 'lucide-angular';
import { MessagesApi } from '../../../core/api/messages.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { ROLE_ADMIN, ROLE_USER } from '../../../core/auth/user-roles';
import { AdminUsersApi } from '../data-access/admin-users.api';
import { ReportsApi } from '../../reports/data-access/reports.api';
import { ModerationSummaryStore } from '../../reports/data-access/moderation-summary.store';
import { AdminReportsPanelComponent } from '../components/admin-reports-panel/admin-reports-panel.component';
import { AdminPageComponent } from './admin-page.component';

describe('AdminPageComponent', () => {
  let messagesApi: { readonly sendAdminMessage: ReturnType<typeof vi.fn> };
  let pendingReviewCount: ReturnType<typeof signal<number>>;
  let pendingReviewBadgeLabel: ReturnType<typeof signal<string>>;

  beforeEach(async () => {
    messagesApi = { sendAdminMessage: vi.fn().mockReturnValue(of({ sent: 1 })) };
    pendingReviewCount = signal(0);
    pendingReviewBadgeLabel = signal('0');

    await TestBed.configureTestingModule({
      imports: [AdminPageComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Bell, ChevronDown, ChevronRight, Eye, Flag, Hammer, MoveDown, MoveUp, RefreshCcw, Send, ShieldCheck, Trash2, Upload, Users })),
        {
          provide: AdminUsersApi,
          useValue: {
            listUsers: vi.fn().mockReturnValue(of({
              users: [{
                id: 'user-1',
                displayName: 'Admin User',
                publicProfilePath: '/community/users/Admin-User',
                email: 'admin@example.test',
                authProviders: [],
                roles: [ROLE_USER],
                authorizationRole: ROLE_USER,
                premiumTier: 'none',
                presenceStatus: 'offline',
                isOnline: false,
                activeSessionsCount: 0,
                deckCounts: { total: 0, privateCount: 0, publicCount: 0 },
                localization: { countryCode: null, countryName: null, appLanguage: 'en' },
                lastConnectedAt: null,
                createdAt: '2026-07-01T00:00:00+00:00',
              }],
              page: 1,
              limit: 30,
              total: 1,
              totalPages: 1,
              appliedStatus: 'active',
              summary: {
                total: 1,
                online: 0,
                recentlyConnected: 0,
                recentlyCreated: 1,
                neverConnected: 1,
                totalDecks: 0,
                tier0: 1,
                tier1: 0,
                tier2: 0,
                tier3: 0,
              },
              countries: [],
              localizationSummary: {
                all: { totalUsers: 1, countries: [], continents: [], languages: [] },
                active: { totalUsers: 0, countries: [], continents: [], languages: [] },
              },
            })),
          },
        },
        { provide: MessagesApi, useValue: messagesApi },
        { provide: AuthStore, useValue: { user: signal({ id: 'admin-user', roles: [ROLE_ADMIN] }) } },
        {
          provide: ReportsApi,
          useValue: {
            listReports: vi.fn().mockReturnValue(of({ reports: [], page: 1, limit: 30, total: 0, totalPages: 1 })),
            getSummary: vi.fn().mockReturnValue(of({ pendingReviewCount: 0 })),
          },
        },
        {
          provide: ModerationSummaryStore,
          useValue: {
            pendingReviewCount,
            badgeLabel: pendingReviewBadgeLabel,
            refresh: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the selected admin section component from the aside menu', async () => {
    const fixture = TestBed.createComponent(AdminPageComponent);
    fixture.detectChanges();

    clickMenuButton(fixture.nativeElement, 'Users');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Admin User');
    expect(fixture.nativeElement.textContent).not.toContain('Analytics');

    clickMenuButton(fixture.nativeElement, 'Reports');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.admin-report-queue')).not.toBeNull();
    clickMenuButton(fixture.nativeElement, 'Notifications');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Recipient');
    expect(fixture.nativeElement.textContent).toContain('Subject');
  });

  it('opens notifications with the selected user when send message is clicked from users', async () => {
    const fixture = TestBed.createComponent(AdminPageComponent);
    fixture.detectChanges();

    clickMenuButton(fixture.nativeElement, 'Users');
    fixture.detectChanges();

    const sendButton = fixture.nativeElement.querySelector('button[aria-label="Send message to Admin User"]') as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();
    sendButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const recipientLabel = fixture.nativeElement.querySelector('.format-select-trigger-label') as HTMLElement | null;
    expect(fixture.nativeElement.textContent).toContain('Notifications');
    expect(recipientLabel?.textContent?.trim()).toBe('Admin User');

    setInputValue(fixture.nativeElement, 'input[formControlName="subject"]', 'Notice');
    setInputValue(fixture.nativeElement, 'textarea[formControlName="body"]', 'Hello');
    fixture.detectChanges();
    submitButton(fixture.nativeElement)?.click();

    expect(messagesApi.sendAdminMessage).toHaveBeenCalledWith({
      recipientId: 'user-1',
      subject: 'Notice',
      body: 'Hello',
      delivery: 'internal',
    });
  });

  it('opens notifications with the selected report participant when Reports requests a message', async () => {
    const fixture = TestBed.createComponent(AdminPageComponent);
    fixture.detectChanges();

    fixture.componentInstance.selectSection('reports');
    fixture.detectChanges();

    const reportsPanel = fixture.debugElement.query(By.directive(AdminReportsPanelComponent));
    expect(reportsPanel).not.toBeNull();
    (reportsPanel.componentInstance as AdminReportsPanelComponent).sendMessageRequested.emit({
      id: 'user-1',
      name: 'Admin User',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const recipientLabel = fixture.nativeElement.querySelector('.format-select-trigger-label') as HTMLElement | null;
    expect(fixture.nativeElement.textContent).toContain('Notifications');
    expect(recipientLabel?.textContent?.trim()).toBe('Admin User');
  });

  it('keeps the Reports badge synchronized with the shared pending-review summary', () => {
    pendingReviewCount.set(120);
    pendingReviewBadgeLabel.set('99+');
    const fixture = TestBed.createComponent(AdminPageComponent);
    fixture.detectChanges();

    const reportsButton = menuButton(fixture.nativeElement, 'Reports');
    const badge = reportsButton?.querySelector('.admin-nav-item__badge') as HTMLElement | null;
    const description = fixture.nativeElement.querySelector('#admin-reports-pending-count') as HTMLElement | null;

    expect(badge?.textContent?.trim()).toBe('99+');
    expect(reportsButton?.getAttribute('aria-describedby')).toBe('admin-reports-pending-count');
    expect(description?.textContent?.trim()).toBe('120 reports awaiting review');

    pendingReviewCount.set(2);
    pendingReviewBadgeLabel.set('2');
    fixture.detectChanges();

    expect((reportsButton?.querySelector('.admin-nav-item__badge') as HTMLElement | null)?.textContent?.trim()).toBe('2');
    expect(description?.textContent?.trim()).toBe('2 reports awaiting review');
  });
});

function clickMenuButton(nativeElement: HTMLElement, label: string): void {
  const button = menuButton(nativeElement, label);

  expect(button).toBeTruthy();
  button?.click();
}

function menuButton(nativeElement: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(nativeElement.querySelectorAll('.admin-nav-item') as NodeListOf<HTMLButtonElement>)
    .find((candidate) => candidate.textContent?.includes(label));
}

function setInputValue(nativeElement: HTMLElement, selector: string, value: string): void {
  const input = nativeElement.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(input).toBeTruthy();
  if (!input) {
    return;
  }

  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function submitButton(nativeElement: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
    .find((candidate) => candidate.textContent?.includes('Send'));
}
