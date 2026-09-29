import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { ROLE_ADMIN, ROLE_SUPPORT } from '../../../core/auth/user-roles';
import { User } from '../../../core/models/user.model';
import { MercureService, ModerationSummaryRealtimeEvent } from '../../../core/realtime/mercure.service';
import { ReportsApi } from './reports.api';
import { ModerationSummaryStore } from './moderation-summary.store';

describe('ModerationSummaryStore', () => {
  let api: { readonly getSummary: ReturnType<typeof vi.fn> };
  let events: Subject<ModerationSummaryRealtimeEvent>;
  let store: ModerationSummaryStore;

  beforeEach(() => {
    events = new Subject<ModerationSummaryRealtimeEvent>();
    api = { getSummary: vi.fn().mockReturnValue(of({ pendingReviewCount: 3 })) };
    TestBed.configureTestingModule({
      providers: [
        ModerationSummaryStore,
        { provide: ReportsApi, useValue: api },
        { provide: MercureService, useValue: { moderationSummaryEvents: vi.fn().mockReturnValue(events) } },
        { provide: AuthStore, useValue: {} },
      ],
    });
    store = TestBed.inject(ModerationSummaryStore);
  });

  afterEach(() => store.reset());

  it('loads and invalidates only the lightweight summary for a moderator', async () => {
    store.syncViewer(user('moderator', ROLE_ADMIN));
    await vi.waitFor(() => expect(store.pendingReviewCount()).toBe(3));

    api.getSummary.mockReturnValue(of({ pendingReviewCount: 4 }));
    events.next({ type: 'moderation.reports.invalidated' });
    await vi.waitFor(() => expect(store.pendingReviewCount()).toBe(4));

    expect(api.getSummary).toHaveBeenCalledTimes(2);
  });

  it('does not connect support-only users to the moderation stream', () => {
    const mercure = TestBed.inject(MercureService) as unknown as { moderationSummaryEvents: ReturnType<typeof vi.fn> };
    store.syncViewer(user('support', ROLE_SUPPORT));

    expect(api.getSummary).not.toHaveBeenCalled();
    expect(mercure.moderationSummaryEvents).not.toHaveBeenCalled();
  });
});

function user(id: string, role: string): User {
  return { id, roles: [role] } as User;
}
