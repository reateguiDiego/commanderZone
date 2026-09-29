import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { ChevronDown, LucideAngularModule, ShieldAlert, Trash2, X } from 'lucide-angular';
import { EMPTY, of } from 'rxjs';
import { MessagesApi } from '../../../../core/api/messages.api';
import { ReportsApi } from '../../data-access/reports.api';
import { ModerationUserDrawerComponent } from './moderation-user-drawer.component';

describe('ModerationUserDrawerComponent', () => {
  let fixture: ComponentFixture<ModerationUserDrawerComponent>;
  let messagesApi: { readonly listAdminUserMessages: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    messagesApi = {
      listAdminUserMessages: vi.fn().mockReturnValue(of({
        messages: [
          {
            id: 'message-1',
            sender: { id: 'moderator-1', displayName: 'Moderator' },
            subject: 'Moderation update',
            body: 'Please keep the conversation respectful.',
            createdAt: '2026-09-29T10:15:00Z',
            readAt: null,
          },
        ],
      })),
    };

    await TestBed.configureTestingModule({
      imports: [ModerationUserDrawerComponent, LucideAngularModule.pick({ ChevronDown, ShieldAlert, Trash2, X })],
      providers: [
        {
          provide: ReportsApi,
          useValue: {
            getUserModeration: vi.fn().mockReturnValue(
              of({
                user: {
                  id: 'reported-user-1',
                  displayName: 'ReportedOne',
                  roles: ['ROLE_USER'],
                  reportsMadeCount: 1,
                  reportsReceivedCount: 2,
                  strikesCount: 1,
                },
                strikes: [
                  {
                    id: 'strike-1',
                    description: 'Repeated abusive messages.',
                    issuedAt: '2026-09-29T10:00:00Z',
                    issuedBy: {
                      id: 'moderator-1',
                      displayName: 'Moderator',
                    },
                  },
                ],
              }),
            ),
          },
        },
        { provide: MessagesApi, useValue: messagesApi },
        {
          provide: NgxTranslateService,
          useValue: {
            instant: vi.fn((key: string) => key),
            onLangChange: EMPTY,
            onTranslationChange: EMPTY,
            onFallbackLangChange: EMPTY,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ModerationUserDrawerComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('userId', 'reported-user-1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('formats strike timestamps in a readable 24-hour format', () => {
    const issuedAt = fixture.nativeElement
      .querySelector('.moderation-user-strike time')
      ?.textContent?.trim();

    expect(issuedAt).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(issuedAt).not.toMatch(/\b(?:am|pm)\b/i);
  });

  it('shows the moderator who created each strike', () => {
    expect(fixture.nativeElement.querySelector('.moderation-user-strike')?.textContent).toContain('Moderator');
  });

  it('uses an accessible trash icon button to delete a strike', () => {
    const deleteButton = fixture.nativeElement.querySelector(
      '.moderation-user-strike-delete button',
    ) as HTMLButtonElement | null;

    expect(deleteButton?.getAttribute('aria-label')).toBe('Delete strike');
    expect(deleteButton?.querySelector('lucide-icon[name="trash-2"]')).not.toBeNull();
  });

  it('uses the issuer fallback when the strike creator no longer exists', () => {
    fixture.componentInstance.strikes.set([
      {
        id: 'strike-without-issuer',
        description: 'Historical strike.',
        issuedAt: '2026-09-29T10:00:00Z',
        issuedBy: null,
      },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.moderation-user-strike')?.textContent).toContain('Creator unavailable');
  });

  it('loads messages only after the Messages tab is selected and expands their content on demand', async () => {
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];

    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(messagesApi.listAdminUserMessages).not.toHaveBeenCalled();

    tabs[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(messagesApi.listAdminUserMessages).toHaveBeenCalledWith('reported-user-1');
    const messageRow = fixture.nativeElement.querySelector(
      '.moderation-user-message-row',
    ) as HTMLButtonElement | null;

    expect(messageRow?.textContent).toContain('Moderation update');
    expect(messageRow?.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.moderation-user-message-details')).toBeNull();

    messageRow?.click();
    fixture.detectChanges();

    const messageDetails = fixture.nativeElement.querySelector('.moderation-user-message-details');
    expect(messageRow?.getAttribute('aria-expanded')).toBe('true');
    expect(messageDetails?.textContent).toContain('Moderator');
    expect(messageDetails?.textContent).toContain('Please keep the conversation respectful.');

    const sentAt = messageDetails?.querySelector('time')?.textContent?.trim();
    expect(sentAt).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);

    messageRow?.click();
    fixture.detectChanges();

    expect(messageRow?.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.moderation-user-message-details')).toBeNull();
  });
});
