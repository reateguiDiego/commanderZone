import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { PasswordResetPageComponent } from './password-reset-page.component';

describe('PasswordResetPageComponent', () => {
  let fixture: ComponentFixture<PasswordResetPageComponent>;
  let authApi: {
    requestPasswordReset: ReturnType<typeof vi.fn>;
    confirmPasswordReset: ReturnType<typeof vi.fn>;
  };
  let authStore: {
    loginWithToken: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authApi = {
      requestPasswordReset: vi.fn().mockReturnValue(of({ accepted: true })),
      confirmPasswordReset: vi.fn().mockReturnValue(of({ updated: true, token: 'jwt-token' })),
    };
    authStore = {
      loginWithToken: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [PasswordResetPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({
                token: 'reset-token',
              }),
            },
          },
        },
        { provide: AuthApi, useValue: authApi },
        { provide: AuthStore, useValue: authStore },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PasswordResetPageComponent);
  });

  it('requests reset email when address is valid', async () => {
    const component = fixture.componentInstance;
    component.resetForm.controls.email.setValue('player@example.test');

    await component.requestResetEmail();

    expect(authApi.requestPasswordReset).toHaveBeenCalledWith('player@example.test');
    expect(component.requestSuccess()).toBe(true);
  });

  it('updates password and auto-logins when reset payload is valid', async () => {
    const component = fixture.componentInstance;
    component.resetForm.setValue({
      email: 'player@example.test',
      newPassword: 'Password456',
      confirmPassword: 'Password456',
    });

    await component.submitReset();

    expect(authApi.confirmPasswordReset).toHaveBeenCalledWith({
      email: 'player@example.test',
      token: 'reset-token',
      newPassword: 'Password456',
    });
    expect(authStore.loginWithToken).toHaveBeenCalledWith('jwt-token');
    expect(component.resetSuccess()).toBe(true);
  });

  it('shows reset error when confirm endpoint fails', async () => {
    authApi.confirmPasswordReset.mockReturnValue(throwError(() => new Error('bad token')));
    const component = fixture.componentInstance;
    component.resetForm.setValue({
      email: 'player@example.test',
      newPassword: 'Password456',
      confirmPassword: 'Password456',
    });

    await component.submitReset();

    expect(component.resetError()).toContain('No se pudo actualizar');
  });
});
