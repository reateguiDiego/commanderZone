import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReportsApi } from './reports.api';
import { ReportStore } from './report.store';

describe('ReportStore', () => {
  let api: { readonly createReport: ReturnType<typeof vi.fn> };
  let store: ReportStore;

  beforeEach(() => {
    api = {
      createReport: vi.fn().mockReturnValue(of({
        report: {
          id: 'report-1',
          source: 'profile',
          category: 'harassment',
          status: 'collecting_evidence',
          createdAt: '2026-09-29T10:00:00Z',
        },
      })),
    };
    TestBed.configureTestingModule({
      providers: [ReportStore, { provide: ReportsApi, useValue: api }],
    });
    store = TestBed.inject(ReportStore);
  });

  it('sends only the strict profile payload selected in the report modal', async () => {
    store.open({ source: 'profile', reportedUserId: 'reported-user', targetDisplayName: 'Reported player' });

    await store.submit('harassment', '  Repeated insults.  ');

    expect(api.createReport).toHaveBeenCalledWith({
      source: 'profile',
      category: 'harassment',
      reportedUserId: 'reported-user',
      comment: 'Repeated insults.',
    });
    expect(store.submissionSucceeded()).toBe(true);
  });

  it('does not send other_problem without its mandatory comment', async () => {
    store.open({ source: 'game_player', gameId: 'game-1', reportedUserId: 'reported-user', targetDisplayName: 'Reported player' });

    await store.submit('other_problem', '   ');

    expect(api.createReport).not.toHaveBeenCalled();
    expect(store.submissionError()).toBe('reports.modal.commentRequired');
  });

  it('uses the persisted chat message ID and exposes a duplicate report error', async () => {
    api.createReport.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    store.open({ source: 'chat_message', gameId: 'game-1', messageId: 'message-1', targetDisplayName: 'Reported player' });

    await store.submit('public_offensive_content', '');

    expect(api.createReport).toHaveBeenCalledWith({
      source: 'chat_message',
      category: 'public_offensive_content',
      gameId: 'game-1',
      messageId: 'message-1',
    });
    expect(store.submissionError()).toBe('reports.errors.duplicate');
  });
});
