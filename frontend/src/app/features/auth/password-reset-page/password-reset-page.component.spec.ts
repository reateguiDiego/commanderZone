import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthApi } from '../../../core/api/auth.api';
import { PasswordResetPageComponent } from './password-reset-page.component';

describe('PasswordResetPageComponent', () => {
  let fixture: ComponentFixture<PasswordResetPageComponent>;
  let authApi: {
    confirmPasswordReset: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authApi = {
      confirmPasswordReset: vi.fn().mockReturnValue(of({ updated: true })),
    };

    await TestBed.configureTestingModule({
      imports: [PasswordResetPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthApi, useValue: authApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PasswordResetPageComponent);
  });

  it('updates password when token and new password are valid', async () => {
    const component = fixture.componentInstance;
    component.resetForm.setValue({
      email: 'player@example.test',
      newPassword: 'password456',
      confirmPassword: 'password456',
    });

    await component.submitReset();

    expect(authApi.confirmPasswordReset).toHaveBeenCalledWith({
      email: 'player@example.test',
      newPassword: 'password456',
    });
    expect(component.resetSuccess()).toBe(true);
  });

  it('shows reset error when confirm endpoint fails', async () => {
    authApi.confirmPasswordReset.mockReturnValue(throwError(() => new Error('bad token')));
    const component = fixture.componentInstance;
    component.resetForm.setValue({
      email: 'player@example.test',
      newPassword: 'password456',
      confirmPassword: 'password456',
    });

    await component.submitReset();

    expect(component.resetError()).toContain('No se pudo actualizar');
  });
});
