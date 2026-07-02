import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, Upload } from 'lucide-angular';
import { of } from 'rxjs';
import { MessagesApi } from '../../../../core/api/messages.api';
import { ROLE_USER } from '../../../../core/auth/user-roles';
import { AdminUsersApi } from '../../data-access/admin-users.api';
import { AdminUser } from '../../data-access/admin-users.models';
import { AdminNotificationsPanelComponent } from './admin-notifications-panel.component';

describe('AdminNotificationsPanelComponent', () => {
  let fixture: ComponentFixture<AdminNotificationsPanelComponent>;
  let messagesApi: { readonly sendAdminMessage: ReturnType<typeof vi.fn> };

  const user: AdminUser = {
    id: 'user-1',
    displayName: 'CommanderZone',
    email: 'cz@test.com',
    roles: [ROLE_USER],
    authorizationRole: ROLE_USER,
    premiumTier: 'none',
    lastConnectedAt: null,
    presenceStatus: 'offline',
    isOnline: false,
    activeRoomsCount: 0,
    activeSessionsCount: 0,
    createdAt: '2026-07-01T10:00:00+00:00',
  };

  beforeEach(async () => {
    messagesApi = {
      sendAdminMessage: vi.fn().mockReturnValue(of({ sent: 1 })),
    };

    await TestBed.configureTestingModule({
      imports: [AdminNotificationsPanelComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Upload })),
        { provide: AdminUsersApi, useValue: { listUsers: vi.fn().mockReturnValue(of({ users: [user] })) } },
        { provide: MessagesApi, useValue: messagesApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminNotificationsPanelComponent);
    fixture.detectChanges();
  });

  it('renders all and user recipients in the autocomplete', () => {
    const input = fixture.nativeElement.querySelector('input[name="recipient"]') as HTMLInputElement;
    input.dispatchEvent(new Event('focus'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Todos');
    expect(fixture.nativeElement.textContent).toContain('CommanderZone');
  });

  it('filters recipients by typed text', () => {
    const input = fixture.nativeElement.querySelector('input[name="recipient"]') as HTMLInputElement;
    input.value = 'commander';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('CommanderZone');
    expect(fixture.nativeElement.textContent).not.toContain('No users found.');
  });

  it('preselects a recipient from the provided username', () => {
    fixture.componentRef.setInput('preselectedRecipient', { id: 'user-1', name: 'CommanderZone' });
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[name="recipient"]') as HTMLInputElement;
    expect(input.value).toBe('CommanderZone');
  });

  it('inserts plain-text formatting snippets and renders them in the preview', () => {
    clickButton(fixture, 'Title');
    clickButton(fixture, 'List');
    clickButton(fixture, 'Link');
    clickButton(fixture, 'Separator');
    clickButton(fixture, 'Image URL');

    const textarea = fixture.nativeElement.querySelector('textarea[formControlName="body"]') as HTMLTextAreaElement;
    expect(textarea.value).toContain('## Title');
    expect(textarea.value).toContain('- List item');
    expect(textarea.value).toContain('[Link text](https://example.com)');
    expect(textarea.value).toContain('![Image description](https://example.com/image.png)');
    expect(textarea.value).toContain('---');
    expect(fixture.nativeElement.querySelector('.message-preview h4')?.textContent).toContain('Title');
    expect(fixture.nativeElement.querySelector('.message-preview li')?.textContent).toContain('List item');
    expect(fixture.nativeElement.querySelector('.message-preview a')?.getAttribute('href')).toBe('https://example.com');
    expect(fixture.nativeElement.querySelector('.message-preview img')?.getAttribute('src')).toBe('https://example.com/image.png');
    expect(fixture.nativeElement.querySelector('.message-preview hr')).not.toBeNull();
  });

  it('limits the subject input to 30 characters', () => {
    const subjectInput = fixture.nativeElement.querySelector('input[formControlName="subject"]') as HTMLInputElement;

    expect(subjectInput.maxLength).toBe(30);
  });

  it('sends the selected recipient subject and body', () => {
    selectRecipient(fixture, 'CommanderZone');
    setInputValue(fixture, 'input[formControlName="subject"]', 'Server notice');
    setInputValue(fixture, 'textarea[formControlName="body"]', 'Maintenance tonight.');

    const submit = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Send')) as HTMLButtonElement;
    submit.click();
    fixture.detectChanges();

    expect(messagesApi.sendAdminMessage).toHaveBeenCalledWith({
      recipientId: 'user-1',
      subject: 'Server notice',
      body: 'Maintenance tonight.',
    });
  });
});

function clickButton(fixture: ComponentFixture<AdminNotificationsPanelComponent>, text: string): void {
  const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(text)) as HTMLButtonElement | undefined;
  button?.click();
  fixture.detectChanges();
}

function selectRecipient(fixture: ComponentFixture<AdminNotificationsPanelComponent>, name: string): void {
  const input = fixture.nativeElement.querySelector('input[name="recipient"]') as HTMLInputElement;
  input.dispatchEvent(new Event('focus'));
  fixture.detectChanges();

  const option = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.recipient-option'))
    .find((candidate) => candidate.textContent?.includes(name)) as HTMLButtonElement;
  option.click();
  fixture.detectChanges();
}

function setInputValue(fixture: ComponentFixture<AdminNotificationsPanelComponent>, selector: string, value: string): void {
  const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}
