import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ContactApi } from '../../../core/api/contact.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { TranslationService } from '../../../core/localization/translation.service';
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

  it('links the top-right exit button to dashboard when there is login', () => {
    auth.isAuthenticated.mockReturnValue(true);
    fixture = TestBed.createComponent(ContactPageComponent);
    fixture.detectChanges();

    const exitLink = fixture.nativeElement.querySelector('.contact-topbar a') as HTMLAnchorElement | null;

    expect(exitLink?.getAttribute('href')).toBe('/dashboard');
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
