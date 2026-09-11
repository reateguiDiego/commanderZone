import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DecksApi } from './decks.api';

describe('DecksApi pagination', () => {
  it('keeps folder filtering and includes later pages in existing selectors', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    let result: unknown;
    TestBed.inject(DecksApi).list(null).subscribe(value => result = value);
    const first = http.expectOne(req => req.url.endsWith('/decks') && !req.params.has('cursor'));
    expect(first.request.params.get('folderId')).toBe('null');
    first.flush({ data: [{ id: 'first' }], nextCursor: 'next' });
    expect(result).toBeUndefined();
    const second = http.expectOne(req => req.params.get('cursor') === 'next');
    expect(second.request.params.get('folderId')).toBe('null');
    second.flush({ data: [{ id: 'second' }], nextCursor: null });
    expect(result).toEqual({ data: [{ id: 'first' }, { id: 'second' }] });
    http.verify();
  });
});
