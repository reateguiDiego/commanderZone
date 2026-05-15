import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { EmailVerificationPageComponent } from './email-verification-page.component';

describe('EmailVerificationPageComponent', () => {
  let fixture: ComponentFixture<EmailVerificationPageComponent>;
  let authApi: {
    requestEmailVerification: ReturnType<typeof vi.fn>;
    confirmEmailVerification: ReturnType<typeof vi.fn>;
  };
  let authStore: {
    loginWithResolvedUser: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authApi = {
      requestEmailVerification: vi.fn().mockReturnValue(of({ accepted: true })),
      confirmEmailVerification: vi.fn().mockReturnValue(of({
        verified: true,
        token: 'jwt-token',
        user: { id: 'user-1', email: 'player@example.test', displayName: 'Player', roles: ['ROLE_USER'] },
      })),
    };
    authStore = {
      loginWithResolvedUser: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [EmailVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthApi, useValue: authApi },
        { provide: AuthStore, useValue: authStore },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailVerificationPageComponent);
  });

  it('confirms verification token when valid', async () => {
    const component = fixture.componentInstance;
    component.verificationForm.controls.token.setValue('verify-token');

    await component.confirmToken();

    expect(authApi.confirmEmailVerification).toHaveBeenCalledWith({ token: 'verify-token' });
    expect(authStore.loginWithResolvedUser).toHaveBeenCalledWith('jwt-token', {
      id: 'user-1',
      email: 'player@example.test',
      displayName: 'Player',
      roles: ['ROLE_USER'],
    });
    expect(component.verifySuccess()).toBe(true);
  });

  it('resends verification email when address is valid', async () => {
    const component = fixture.componentInstance;
    component.verificationForm.controls.email.setValue('player@example.test');

    await component.resendVerificationEmail();

    expect(authApi.requestEmailVerification).toHaveBeenCalledWith('player@example.test');
    expect(component.resendSuccess()).toBe(true);
  });

  it('shows verification error when token endpoint fails', async () => {
    authApi.confirmEmailVerification.mockReturnValue(throwError(() => new Error('bad token')));
    const component = fixture.componentInstance;
    component.verificationForm.controls.token.setValue('bad-token');

    await component.confirmToken();

    expect(component.verifyError()).toContain('No se pudo verificar');
  });
});

