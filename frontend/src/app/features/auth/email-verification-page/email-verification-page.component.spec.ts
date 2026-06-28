import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { EmailVerificationPageComponent } from './email-verification-page.component';

describe('EmailVerificationPageComponent', () => {
  async function create(token: string | null, confirmFails = false): Promise<{
    fixture: ComponentFixture<EmailVerificationPageComponent>;
    authApi: { confirmEmailVerification: ReturnType<typeof vi.fn> };
    authStore: { loginWithResolvedUser: ReturnType<typeof vi.fn> };
    router: Router;
  }> {
    const authApi = {
      confirmEmailVerification: confirmFails
        ? vi.fn().mockReturnValue(throwError(() => new Error('bad token')))
        : vi.fn().mockReturnValue(of({
            verified: true,
            token: 'jwt-token',
            user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] },
          })),
    };
    const authStore = {
      loginWithResolvedUser: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [EmailVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthApi, useValue: authApi },
        { provide: AuthStore, useValue: authStore },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(token ? { token } : {}),
            },
          },
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(EmailVerificationPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    return { fixture, authApi, authStore, router };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('confirms the email token from the verification link automatically', async () => {
    const { authApi, authStore, router } = await create('verify-token');

    expect(authApi.confirmEmailVerification).toHaveBeenCalledWith({ token: 'verify-token' });
    expect(authStore.loginWithResolvedUser).toHaveBeenCalledWith('jwt-token', {
      id: 'user-1',
      email: 'player@example.test',
      displayName: 'Player',
      roles: ['ROLE_USER'],
    });
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('shows an error state when the verification link has no token', async () => {
    const { fixture, authApi } = await create(null);

    expect(authApi.confirmEmailVerification).not.toHaveBeenCalled();
    expect(fixture.componentInstance.status()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('Could not confirm your email');
  });

  it('shows an error state when the token cannot be confirmed', async () => {
    const { fixture, authStore } = await create('bad-token', true);

    expect(authStore.loginWithResolvedUser).not.toHaveBeenCalled();
    expect(fixture.componentInstance.status()).toBe('error');
  });
});
