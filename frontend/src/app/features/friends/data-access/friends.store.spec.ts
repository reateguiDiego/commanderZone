import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { FriendsApi } from '../../../core/api/friends.api';
import { RoomsApi } from '../../../core/api/rooms.api';
import { FriendsStore } from './friends.store';

describe('FriendsStore freshness', () => {
  let api: { list: ReturnType<typeof vi.fn>; incoming: ReturnType<typeof vi.fn>; outgoing: ReturnType<typeof vi.fn> };
  let rooms: { incomingInvites: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    api = { list: vi.fn(() => of({ data: [] })), incoming: vi.fn(() => of({ data: [] })), outgoing: vi.fn(() => of({ data: [] })) };
    rooms = { incomingInvites: vi.fn(() => of({ data: [] })) };
    TestBed.configureTestingModule({ providers: [FriendsStore, provideRouter([]), { provide: FriendsApi, useValue: api }, { provide: RoomsApi, useValue: rooms }] });
  });
  afterEach(() => vi.restoreAllMocks());

  it('deduplicates concurrent callers and refreshes only expired data', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const pending = new Subject<{ data: [] }>();
    api.list.mockReturnValue(pending);
    const store = TestBed.inject(FriendsStore);
    const loads = [store.load(), store.ensureLoaded(), store.load()];
    await Promise.resolve();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(store.resourceStates.friends.state()).toBe('loading');
    pending.next({ data: [] });
    await Promise.all(loads);
    await store.ensureLoaded();
    expect(api.list).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(61_000);
    api.list.mockReturnValue(of({ data: [] }));
    await store.ensureLoaded();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('invalidates only invitation data and retries a failed resource', async () => {
    const store = TestBed.inject(FriendsStore);
    await store.load();
    store.handleRoomInviteEvent();
    rooms.incomingInvites.mockReturnValueOnce(throwError(() => new Error('offline')));
    await store.load();
    expect(store.error()).toBeTruthy();
    expect(store.resourceStates.invites.state()).toBe('stale');
    await store.load();
    expect(rooms.incomingInvites).toHaveBeenCalledTimes(3);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.incoming).toHaveBeenCalledTimes(1);
    expect(api.outgoing).toHaveBeenCalledTimes(1);
    expect(store.error()).toBeNull();
  });

  it('patches presence without reloading the friends body or applying an unsafe counter delta', async () => {
    const friend = { id: 'friend', displayName: 'Friend', presence: 'offline' as const };
    api.list.mockReturnValue(of({ data: [{ id: 'relation', friend, requester: friend, recipient: friend, status: 'accepted', createdAt: '', updatedAt: '' }] }));
    const store = TestBed.inject(FriendsStore);
    await store.load();
    store.handleRealtimeEvent({ type: 'friend.presence.changed', user: { ...friend, presence: 'online' } });
    await store.load();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(store.rows()[0].presence).toBe('online');
    expect(store.resourceStates.summary.state()).toBe('stale');
  });

  it('friendship events do not invalidate invitations', async () => {
    const store = TestBed.inject(FriendsStore);
    await store.load();
    store.handleRealtimeEvent({ type: 'friend.list.changed', userId: 'friend' });
    expect(api.list).toHaveBeenCalledTimes(1);
    await store.load();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(rooms.incomingInvites).toHaveBeenCalledTimes(1);
  });
});
