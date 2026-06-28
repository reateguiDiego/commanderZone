import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ContactApi } from '../../../core/api/contact.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { TranslationService } from '../../../core/localization/translation.service';
import { User } from '../../../core/models/user.model';
import { AppThemeService } from '../../../core/theme/app-theme.service';
import { ContactPageComponent } from './contact-page.component';

describe('ContactPageComponent', () => {
  let fixture: ComponentFixture<ContactPageComponent>;
  let contactApi: {
    send: ReturnType<typeof vi.fn>;
  };
  let translation: {
    useLocale: ReturnType<typeof vi.fn>;
    instant: ReturnType<typeof vi.fn>;
  };
  let auth: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    user: ReturnType<typeof vi.fn>;
    displayName: ReturnType<typeof vi.fn>;
  };
  const authenticatedUser: User = {
    id: 'user-1',
    email: 'alice@example.com',
    displayName: 'Alice',
    roles: ['ROLE_USER'],
    preferences: {
      cardLanguage: 'en',
      appLanguage: 'en',
      themeId: 'sunrise',
    },
  };

  beforeEach(async () => {
    contactApi = {
      send: vi.fn().mockReturnValue(of({ accepted: true })),
    };
    translation = {
      useLocale: vi.fn().mockReturnValue(of('en')),
      instant: vi.fn().mockImplementation((key: string, params?: Record<string, unknown>) => {
        if (key === 'contactPage.form.submitError') {
          return `Fallback ${params?.['email'] ?? ''}`;
        }

        if (key === 'contactPage.form.submitRateLimitError') {
          return `Rate limit ${params?.['retryAfterMinutes'] ?? ''} ${params?.['email'] ?? ''}`;
        }

        return key;
      }),
    };
    auth = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      user: vi.fn().mockReturnValue(null),
      displayName: vi.fn().mockReturnValue(null),
    };

    await TestBed.configureTestingModule({
      imports: [ContactPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthStore, useValue: auth },
        { provide: ContactApi, useValue: contactApi },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactPageComponent);
    fixture.detectChanges();
  });

  it('uses browser locale when supported', () => {
    expect(translation.useLocale).toHaveBeenCalledWith('en');
  });

  it('links the top-right exit button to home when there is no login', () => {
    const exitLink = fixture.nativeElement.querySelector('.contact-topbar a') as HTMLAnchorElement | null;

    expect(exitLink?.getAttribute('href')).toBe('/');
  });

  it('keeps name and email empty and editable without login', () => {
    const nameInput = fixture.nativeElement.querySelector('input[formControlName="name"]') as HTMLInputElement | null;
    const emailInput = fixture.nativeElement.querySelector('input[formControlName="email"]') as HTMLInputElement | null;

    expect(nameInput?.value).toBe('');
    expect(emailInput?.value).toBe('');
    expect(fixture.componentInstance.contactForm.controls.name.disabled).toBe(false);
    expect(fixture.componentInstance.contactForm.controls.email.disabled).toBe(false);
    expect(nameInput?.readOnly).toBe(false);
    expect(emailInput?.readOnly).toBe(false);
  });

  it('uses the default CZ logo when no alternate theme asset is needed', () => {
    const logo = fixture.nativeElement.querySelector('.contact-logo') as HTMLImageElement | null;

    expect(logo?.getAttribute('src')).toBe('/assets/icons/CZ/CZ_logo.webp');
  });

  it('uses the theme-specific CZ logo asset when the selected theme requires it', () => {
    TestBed.inject(AppThemeService).selectTheme('candy-summoners');
    fixture = TestBed.createComponent(ContactPageComponent);
    fixture.detectChanges();

    const logo = fixture.nativeElement.querySelector('.contact-logo') as HTMLImageElement | null;

    expect(logo?.getAttribute('src')).toBe('/assets/icons/CZ/CZ_logo_black.webp');
  });

  it('links the top-right exit button to dashboard when there is login', () => {
    auth.isAuthenticated.mockReturnValue(true);
    auth.user.mockReturnValue(authenticatedUser);
    auth.displayName.mockReturnValue('Alice');
    fixture = TestBed.createComponent(ContactPageComponent);
    fixture.detectChanges();

    const exitLink = fixture.nativeElement.querySelector('.contact-topbar a') as HTMLAnchorElement | null;

    expect(exitLink?.getAttribute('href')).toBe('/dashboard');
  });

  it('prefills name and email from the authenticated user in read-only mode', () => {
    auth.isAuthenticated.mockReturnValue(true);
    auth.user.mockReturnValue(authenticatedUser);
    auth.displayName.mockReturnValue('Alice');
    fixture = TestBed.createComponent(ContactPageComponent);
    fixture.detectChanges();

    const nameInput = fixture.nativeElement.querySelector('input[formControlName="name"]') as HTMLInputElement | null;
    const emailInput = fixture.nativeElement.querySelector('input[formControlName="email"]') as HTMLInputElement | null;

    expect(nameInput?.value).toBe('Alice');
    expect(emailInput?.value).toBe('alice@example.com');
    expect(fixture.componentInstance.contactForm.controls.name.disabled).toBe(false);
    expect(fixture.componentInstance.contactForm.controls.email.disabled).toBe(false);
    expect(nameInput?.readOnly).toBe(true);
    expect(emailInput?.readOnly).toBe(true);
  });

  it('submits the form when valid', async () => {
    fixture.componentInstance.contactForm.setValue({
      name: 'Alice',
      email: 'alice@example.com',
      subject: 'Help',
      message: 'Need support',
    });
    fixture.componentInstance.contactForm.updateValueAndValidity();

    expect(fixture.componentInstance.contactForm.valid).toBe(true);

    await fixture.componentInstance.submit();

    expect(contactApi.send).toHaveBeenCalledWith({
      name: 'Alice',
      email: 'alice@example.com',
      subject: 'Help',
      message: 'Need support',
    });
    expect(fixture.componentInstance.submitted()).toBe(true);
  });

  it('preserves authenticated readonly fields after a successful submit', async () => {
    auth.isAuthenticated.mockReturnValue(true);
    auth.user.mockReturnValue(authenticatedUser);
    auth.displayName.mockReturnValue('Alice');
    fixture = TestBed.createComponent(ContactPageComponent);
    fixture.detectChanges();

    fixture.componentInstance.contactForm.controls.subject.setValue('Help');
    fixture.componentInstance.contactForm.controls.message.setValue('Need support');
    fixture.componentInstance.contactForm.updateValueAndValidity();

    await fixture.componentInstance.submit();
    fixture.detectChanges();

    const payload = contactApi.send.mock.calls[0]?.[0] as Record<string, string>;
    const nameInput = fixture.nativeElement.querySelector('input[formControlName="name"]') as HTMLInputElement | null;
    const emailInput = fixture.nativeElement.querySelector('input[formControlName="email"]') as HTMLInputElement | null;

    expect(payload).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      subject: 'Help',
      message: 'Need support',
    });
    expect(nameInput?.value).toBe('Alice');
    expect(emailInput?.value).toBe('alice@example.com');
    expect(fixture.componentInstance.contactForm.controls.subject.value).toBe('');
    expect(fixture.componentInstance.contactForm.controls.message.value).toBe('');
    expect(fixture.componentInstance.contactForm.controls.name.disabled).toBe(false);
    expect(fixture.componentInstance.contactForm.controls.email.disabled).toBe(false);
    expect(nameInput?.readOnly).toBe(true);
    expect(emailInput?.readOnly).toBe(true);
  });

  it('shows live field limits for bounded contact fields', () => {
    fixture.componentInstance.contactForm.controls.name.setValue('Alice');
    fixture.componentInstance.contactForm.controls.subject.setValue('Help');
    fixture.componentInstance.contactForm.controls.message.setValue('Need support');
    fixture.detectChanges();

    const fieldLimits = Array.from(fixture.nativeElement.querySelectorAll('.field-limit') as NodeListOf<HTMLElement>)
      .map((element) => element.textContent?.trim());

    expect(fieldLimits).toEqual(['5/30', '4/30', '12/500']);
  });

  it('shows a visible error when the backend request fails', async () => {
    contactApi.send.mockReturnValue(throwError(() => new Error('smtp failed')));
    fixture.componentInstance.contactForm.setValue({
      name: 'Alice',
      email: 'alice@example.com',
      subject: 'Help',
      message: 'Need support',
    });
    fixture.componentInstance.contactForm.updateValueAndValidity();

    expect(fixture.componentInstance.contactForm.valid).toBe(true);

    await fixture.componentInstance.submit();

    expect(fixture.componentInstance.errorMessage() ?? '').toContain('info.dev.sunrise@gmail.com');
  });

  it('shows a specific rate-limit message for contact throttling', async () => {
    contactApi.send.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 429,
      error: {
        error: 'Too many contact requests. Please try again later.',
        retryAfterSeconds: 125,
      },
    })));
    fixture.componentInstance.contactForm.setValue({
      name: 'Alice',
      email: 'alice@example.com',
      subject: 'Help',
      message: 'Need support',
    });
    fixture.componentInstance.contactForm.updateValueAndValidity();

    await fixture.componentInstance.submit();

    expect(fixture.componentInstance.errorMessage()).toBe('Rate limit 3 info.dev.sunrise@gmail.com');
  });

  it('marks fields as touched instead of submitting invalid payloads', async () => {
    await fixture.componentInstance.submit();

    expect(contactApi.send).not.toHaveBeenCalled();
    expect(fixture.componentInstance.contactForm.controls.name.touched).toBe(true);
  });
});
