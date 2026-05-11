import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { EmailVerificationPageComponent } from './email-verification-page.component';

describe('EmailVerificationPageComponent', () => {
  let fixture: ComponentFixture<EmailVerificationPageComponent>;
  let authApi: {
    requestEmailVerification: ReturnType<typeof vi.fn>;
    confirmEmailVerification: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authApi = {
      requestEmailVerification: vi.fn().mockReturnValue(of({ accepted: true })),
      confirmEmailVerification: vi.fn().mockReturnValue(of({ verified: true, user: {} })),
    };

    await TestBed.configureTestingModule({
      imports: [EmailVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthApi, useValue: authApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailVerificationPageComponent);
  });

  it('confirms verification token when valid', async () => {
    const component = fixture.componentInstance;
    component.verificationForm.controls.token.setValue('verify-token');

    await component.confirmToken();

    expect(authApi.confirmEmailVerification).toHaveBeenCalledWith({ token: 'verify-token' });
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

