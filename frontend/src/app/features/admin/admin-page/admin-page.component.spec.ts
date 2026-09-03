import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Bell, ChevronDown, ChevronRight, Eye, Flag, Hammer, LucideAngularModule, MoveDown, MoveUp, RefreshCcw, Send, ShieldCheck, Trash2, Upload, Users } from 'lucide-angular';
import { MessagesApi } from '../../../core/api/messages.api';
import { ROLE_USER } from '../../../core/auth/user-roles';
import { AdminUsersApi } from '../data-access/admin-users.api';
import { AdminPageComponent } from './admin-page.component';

describe('AdminPageComponent', () => {
  let messagesApi: { readonly sendAdminMessage: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    messagesApi = { sendAdminMessage: vi.fn().mockReturnValue(of({ sent: 1 })) };

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
    expect(fixture.nativeElement.textContent).toContain('No user reports yet.');
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

    const recipientInput = fixture.nativeElement.querySelector('input[name="recipient"]') as HTMLInputElement | null;
    expect(fixture.nativeElement.textContent).toContain('Notifications');
    expect(recipientInput?.value).toBe('Admin User');

    setInputValue(fixture.nativeElement, 'input[formControlName="subject"]', 'Notice');
    setInputValue(fixture.nativeElement, 'textarea[formControlName="body"]', 'Hello');
    fixture.detectChanges();
    submitButton(fixture.nativeElement)?.click();

    expect(messagesApi.sendAdminMessage).toHaveBeenCalledWith({
      recipientId: 'user-1',
      subject: 'Notice',
      body: 'Hello',
    });
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
