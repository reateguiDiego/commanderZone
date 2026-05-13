import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { API_BASE_URL } from '../api/api.config';
import { authInterceptor } from './auth.interceptor';
import { AuthStore } from './auth.store';

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let tokenState: ReturnType<typeof signal<string | null>>;
  let clearSession: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tokenState = signal<string | null>('token-1');
    clearSession = vi.fn(() => tokenState.set(null));
    navigate = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: {
            token: tokenState.asReadonly(),
            clearSession,
          },
        },
        {
          provide: Router,
          useValue: {
            navigate,
          },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    http.verify();
  });

  it('adds bearer token to API requests', () => {
    client.get(`${API_BASE_URL}/me`).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/me`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    request.flush({ user: { id: 'u1' } });
  });

  it('clears session on 401 only when the failing request matches current token', () => {
    client.get(`${API_BASE_URL}/me`).subscribe({
      error: () => undefined,
    });

    const request = http.expectOne(`${API_BASE_URL}/me`);
    request.flush(
      { error: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' },
    );

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('does not clear a newer session when a stale 401 arrives', () => {
    client.get(`${API_BASE_URL}/me`).subscribe({
      error: () => undefined,
    });

    const request = http.expectOne(`${API_BASE_URL}/me`);
    tokenState.set('token-2');
    request.flush(
      { error: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' },
    );

    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(tokenState()).toBe('token-2');
  });

  it('does not attach auth headers to non-API requests', () => {
    client.get('https://example.com/ping').subscribe({
      error: () => undefined,
    });

    const request = http.expectOne('https://example.com/ping');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.error(new ProgressEvent('network-error'));
  });

  it('does not clear session on non-401 API errors', () => {
    const errors: HttpErrorResponse[] = [];
    client.get(`${API_BASE_URL}/me`).subscribe({
      error: (error) => errors.push(error),
    });

    const request = http.expectOne(`${API_BASE_URL}/me`);
    request.flush(
      { error: 'Server error' },
      { status: 500, statusText: 'Server Error' },
    );

    expect(errors).toHaveLength(1);
    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
