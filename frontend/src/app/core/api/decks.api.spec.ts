import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DecksApi } from './decks.api';

describe('DecksApi pagination', () => {
  it('shares equivalent concurrent analysis requests and retries after an error', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const api = TestBed.inject(DecksApi);
    const received: unknown[] = [];
    api.getDeckAdvancedAnalysis('one').subscribe(value => received.push(value));
    api.getDeckAdvancedAnalysis('one').subscribe(value => received.push(value));
    http.expectOne(req => req.url.endsWith('/one/analysis/advanced')).flush({ deckId: 'one' });
    expect(received).toHaveLength(2);
    api.getDeckAdvancedAnalysis('one').subscribe({ error: () => {} });
    http.expectOne(req => req.url.endsWith('/one/analysis/advanced')).flush({}, { status: 503, statusText: 'Busy' });
    api.getDeckAdvancedAnalysis('one').subscribe();
    http.expectOne(req => req.url.endsWith('/one/analysis/advanced')).flush({ deckId: 'one' });
    http.verify();
  });

  it('keeps folder filtering without automatically requesting later pages', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    let result: unknown;
    TestBed.inject(DecksApi).list(null).subscribe(value => result = value);
    const first = http.expectOne(req => req.url.endsWith('/decks') && !req.params.has('cursor'));
    expect(first.request.params.get('folderId')).toBe('null');
    first.flush({ data: [{ id: 'first' }], nextCursor: 'next' });
    expect(result).toEqual({ data: [{ id: 'first' }], nextCursor: 'next' });
    http.expectNone(req => req.params.has('cursor'));
    TestBed.inject(DecksApi).list(null, false, { cursor: 'next' }).subscribe(value => result = value);
    const second = http.expectOne(req => req.params.get('cursor') === 'next');
    expect(second.request.params.get('folderId')).toBe('null');
    second.flush({ data: [{ id: 'second' }], nextCursor: null });
    expect(result).toEqual({ data: [{ id: 'second' }], nextCursor: null });
    http.verify();
  });
});
