import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from './api.config';
import { FriendsStore } from '../../features/friends/data-access/friends.store';
import { MessagesStore } from '../../features/messages/data-access/messages.store';

describe('Header resources HTTP integration', () => {
  it('loads summaries only, deduplicates HTTP, then refetches only the invalidated resource', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), FriendsStore, MessagesStore] });
    const http = TestBed.inject(HttpTestingController);
    const friends = TestBed.inject(FriendsStore);
    const messages = TestBed.inject(MessagesStore);
    const pending = [friends.ensureSummaryLoaded(), friends.ensureSummaryLoaded(), messages.ensureSummaryLoaded(), messages.ensureSummaryLoaded()];
    await Promise.resolve();
    http.expectOne(API_BASE_URL + '/friends/summary').flush({ onlineFriendsCount: 2, incomingRequestsCount: 1, roomInvitesCount: 3 });
    http.expectOne(API_BASE_URL + '/messages/summary').flush({ totalCount: 80, unreadCount: 4 });
    await Promise.all(pending);
    expect(friends.pendingNotificationsCount()).toBe(4);
    expect(messages.totalCount()).toBe(80);
    http.verify();
    await Promise.all([friends.ensureSummaryLoaded(), messages.ensureSummaryLoaded()]);
    http.verify();
    messages.handleRealtimeEvent();
    const retry = messages.ensureSummaryLoaded();
    await Promise.resolve();
    http.expectOne(API_BASE_URL + '/messages/summary').flush('offline', { status: 503, statusText: 'Unavailable' });
    await retry;
    expect(messages.summaryState()).toBe('stale');
    const recovered = messages.ensureSummaryLoaded();
    await Promise.resolve();
    http.expectOne(API_BASE_URL + '/messages/summary').flush({ totalCount: 81, unreadCount: 5 });
    await recovered;
    expect(messages.unreadCount()).toBe(5);
    http.verify();
  });
});
