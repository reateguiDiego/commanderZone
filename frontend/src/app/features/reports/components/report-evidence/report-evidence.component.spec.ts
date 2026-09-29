import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { EMPTY } from 'rxjs';
import { ReportEvidence } from '../../data-access/reports.models';
import { ReportEvidenceComponent } from './report-evidence.component';

describe('ReportEvidenceComponent', () => {
  let fixture: ComponentFixture<ReportEvidenceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportEvidenceComponent],
      providers: [
        {
          provide: NgxTranslateService,
          useValue: {
            instant: vi.fn((key: string, params?: Record<string, unknown>) => {
              const translations: Readonly<Record<string, string>> = {
                'reports.moderation.evidence.profileSnapshot': 'Profile snapshot',
                'reports.moderation.evidence.gameSnapshot': 'Game snapshot',
                'reports.moderation.evidence.capturedAt': `Captured ${params?.['date'] ?? ''}`,
                'reports.moderation.evidence.avatarAlt': `Avatar of ${params?.['name'] ?? ''}`,
                'reports.moderation.evidence.folders': 'Folders',
                'reports.moderation.evidence.ownedRooms': 'Owned rooms',
                'reports.moderation.evidence.noFolders': 'No folders captured.',
                'reports.moderation.evidence.noDecks': 'No decks captured.',
                'reports.moderation.evidence.noOwnedRooms': 'No owned rooms captured.',
                'reports.moderation.evidence.noChat': 'No chat evidence was captured.',
                'reports.moderation.evidence.gameLog': 'Game log',
                'reports.moderation.evidence.noGameLog': 'No game log evidence was captured.',
                'reports.moderation.evidence.awaiting': 'Evidence is not available for this report.',
                'shared.text.decks': 'Decks',
                'game.gameTable.chat': 'Chat',
              };

              return translations[key] ?? key;
            }),
            onLangChange: EMPTY,
            onTranslationChange: EMPTY,
            onFallbackLangChange: EMPTY,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportEvidenceComponent);
  });

  it('renders readable profile and game evidence without JSON blocks', () => {
    fixture.componentRef.setInput('evidence', evidenceWithSnapshots());
    fixture.componentRef.setInput('dateTimeFormat', 'dd/MM/yyyy HH:mm');
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.querySelector('pre')).toBeNull();
    expect(nativeElement.querySelector('.report-evidence__avatar')?.getAttribute('alt')).toBe(
      'Avatar of Reported player',
    );
    expect(nativeElement.textContent).toContain('Reported player');
    expect(nativeElement.textContent).toContain('@reported-player');
    expect(nativeElement.textContent).toContain('Archive folder');
    expect(nativeElement.textContent).toContain('Mono Blue');
    expect(nativeElement.textContent).toContain('Friday Commander');
    expect(nativeElement.textContent).toContain('09:15 · Chat user · Stop this.');
    expect(nativeElement.textContent).toContain('09:15:01 · Chat user · Played Counterspell');
    expect(nativeElement.textContent).toContain('09:15:02 · Turn started');
    expect(nativeElement.querySelectorAll('.app-pretty-scroll')).toHaveLength(3);
    for (const capturedAt of nativeElement.querySelectorAll('.report-evidence__captured-at')) {
      expect(capturedAt.textContent).toMatch(/\d{2}:\d{2}/);
      expect(capturedAt.textContent).not.toMatch(/\b(?:am|pm)\b/i);
    }
  });

  it('renders user-provided evidence as text instead of HTML', () => {
    const evidence = evidenceWithSnapshots();
    const game = evidence.game;
    if (!game) {
      throw new Error('Expected game evidence for this test.');
    }

    fixture.componentRef.setInput('evidence', {
      ...evidence,
      game: {
        ...game,
        chat: [{ time: '09:15', actorDisplayName: 'Chat user', body: '<img src=x>' }],
      },
    });
    fixture.componentRef.setInput('dateTimeFormat', 'dd/MM/yyyy HH:mm');
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('.report-evidence__stream-entry img')).toBeNull();
    expect(nativeElement.textContent).toContain('<img src=x>');
  });

  it('shows the awaiting state only when neither snapshot is available', () => {
    fixture.componentRef.setInput('evidence', {
      reportedUserSnapshot: null,
      game: null,
    });
    fixture.componentRef.setInput('dateTimeFormat', 'dd/MM/yyyy HH:mm');
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;

    expect(nativeElement.textContent).toContain('Evidence is not available for this report.');
    expect(nativeElement.querySelector('.report-evidence')).toBeNull();
  });

  it('renders the empty states for captured collections and streams', () => {
    fixture.componentRef.setInput('evidence', {
      reportedUserSnapshot: {
        capturedAt: '2026-09-29T10:01:00Z',
        user: { displayName: 'Reported player', publicHandle: null },
        folders: [],
        decks: [],
        ownedRooms: [],
      },
      game: {
        capturedAt: '2026-09-29T10:01:00Z',
        chat: [],
        gameLog: [],
      },
    });
    fixture.componentRef.setInput('dateTimeFormat', 'dd/MM/yyyy HH:mm');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('No folders captured.');
    expect(text).toContain('No decks captured.');
    expect(text).toContain('No owned rooms captured.');
    expect(text).toContain('No chat evidence was captured.');
    expect(text).toContain('No game log evidence was captured.');
  });
});

function evidenceWithSnapshots(): ReportEvidence {
  return {
    reportedUserSnapshot: {
      capturedAt: '2026-09-29T10:01:00Z',
      user: {
        displayName: 'Reported player',
        publicHandle: 'reported-player',
        avatar: {
          type: 'upload',
          imageData: 'data:image/png;base64,iVBORw0KGgo=',
        },
      },
      folders: [{ name: 'Archive folder' }],
      decks: [{ name: 'Mono Blue' }],
      ownedRooms: [{ name: 'Friday Commander' }],
    },
    game: {
      capturedAt: '2026-09-29T10:01:00Z',
      chat: [{ time: '09:15', actorDisplayName: 'Chat user', body: 'Stop this.' }],
      gameLog: [
        { time: '09:15:01', actorDisplayName: 'Chat user', action: 'Played Counterspell' },
        { time: '09:15:02', actorDisplayName: null, action: 'Turn started' },
      ],
    },
  };
}
