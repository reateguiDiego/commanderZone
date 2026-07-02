import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Bell, Flag, Hammer, LucideAngularModule, MoveDown, MoveUp, Send, ShieldCheck, Upload, Users } from 'lucide-angular';
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
        importProvidersFrom(LucideAngularModule.pick({ Bell, Flag, Hammer, MoveDown, MoveUp, Send, ShieldCheck, Upload, Users })),
        {
          provide: AdminUsersApi,
          useValue: {
            listUsers: vi.fn().mockReturnValue(of({
              users: [{
                id: 'user-1',
                displayName: 'Admin User',
                email: 'admin@example.test',
                roles: [ROLE_USER],
                authorizationRole: ROLE_USER,
                premiumTier: 'none',
                presenceStatus: 'offline',
                isOnline: false,
                activeRoomsCount: 0,
                activeSessionsCount: 0,
                lastConnectedAt: null,
                createdAt: '2026-07-01T00:00:00+00:00',
              }],
            })),
          },
        },
        { provide: MessagesApi, useValue: messagesApi },
      ],
    }).compileComponents();
  });

  it('renders the admin entry page with users as the default section', () => {
    const fixture = TestBed.createComponent(AdminPageComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Admin');
    expect(fixture.nativeElement.querySelector('.admin-content')?.classList.contains('admin-content--top')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Admin User');
    expect(fixture.nativeElement.textContent).toContain('Users');
    expect(fixture.nativeElement.textContent).toContain('Reports');
    expect(fixture.nativeElement.textContent).toContain('Notifications');
    expect(fixture.nativeElement.textContent).not.toContain('Analytics');
    expect(fixture.nativeElement.querySelector('lucide-icon[name="shield-check"]')).not.toBeNull();
    expect(menuButton(fixture.nativeElement, 'Users')?.querySelector('lucide-icon')).not.toBeNull();
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
    expect(fixture.nativeElement.querySelector('.admin-content')?.classList.contains('admin-content--top')).toBe(true);

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
