import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { ContactApi } from '../../../core/api/contact.api';
import { AuthStore } from '../../../core/auth/auth.store';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { TranslationService } from '../../../core/localization/translation.service';
import { LocaleCode, SUPPORTED_LOCALE_CODES } from '../../../core/localization/locale-config';
import { SeoService } from '../../../core/seo/seo.service';
import { PUBLIC_CONTACT_EMAIL, PUBLIC_CONTACT_PATH } from '../../../core/contact/contact.config';
import { ApiError } from '../../../core/models/api-responses.model';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CONTACT_PAGE_ATTRIBUTE = 'data-cz-contact-page';
const CONTACT_PAGE_SELECTOR = [
  `meta[${CONTACT_PAGE_ATTRIBUTE}="true"]`,
  `link[${CONTACT_PAGE_ATTRIBUTE}="true"]`,
].join(',');
const CONTACT_PAGE_PATH = PUBLIC_CONTACT_PATH;
const CONTACT_PAGE_CANONICAL = `https://www.commanderzone.com${CONTACT_PAGE_PATH}`;
const FALLBACK_LOCALE: LocaleCode = 'en';
const MAX_NAME_LENGTH = 30;
const MAX_SUBJECT_LENGTH = 30;
const MAX_MESSAGE_LENGTH = 500;
const FIELD_LIMITS = {
  name: MAX_NAME_LENGTH,
  email: null,
  subject: MAX_SUBJECT_LENGTH,
  message: MAX_MESSAGE_LENGTH,
} as const;

@Component({
  selector: 'app-contact-page',
  imports: [RuntimeTranslatePipe, ReactiveFormsModule, RouterLink, LucideAngularModule, CzButtonDirective],
  templateUrl: './contact-page.component.html',
  styleUrl: './contact-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactPageComponent {
  readonly auth = inject(AuthStore);
  private readonly contactApi = inject(ContactApi);
  private readonly document = inject(DOCUMENT);
  private readonly formBuilder = inject(FormBuilder);
  private readonly meta = inject(Meta);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly seo = inject(SeoService);
  private readonly title = inject(Title);
  private readonly translation = inject(TranslationService);

  readonly submitting = signal(false);
  readonly submitted = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly activeLocale = signal<LocaleCode>(FALLBACK_LOCALE);
  readonly inboxAddress = PUBLIC_CONTACT_EMAIL;
  readonly exitHref = () => this.auth.isAuthenticated() ? '/dashboard' : '/';
  readonly exitLabelKey = () => this.auth.isAuthenticated() ? 'contactPage.nav.loggedOutCta' : 'contactPage.nav.anonymousCta';

  readonly contactForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(MAX_NAME_LENGTH)]],
    email: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    subject: ['', [Validators.required, Validators.maxLength(MAX_SUBJECT_LENGTH)]],
    message: ['', [Validators.required, Validators.maxLength(MAX_MESSAGE_LENGTH)]],
  });

  constructor() {
    effect(() => {
      const locale = this.activeLocale();
      void firstValueFrom(this.translation.useLocale(locale))
        .then(() => this.applyMetadata())
        .catch(() => this.applyMetadata());
    });

    this.activeLocale.set(this.detectBrowserLocale());
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      this.contactForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.submitted.set(false);
    this.errorMessage.set(null);

    try {
      const payload = this.contactForm.getRawValue();
      const response = await firstValueFrom(this.contactApi.send(payload));
      this.submitted.set(response.accepted);
      this.contactForm.reset({
        name: '',
        email: '',
        subject: '',
        message: '',
      });
    } catch (error: unknown) {
      this.errorMessage.set(this.resolveSubmitError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  fieldInvalid(field: 'name' | 'email' | 'subject' | 'message'): boolean {
    const control = this.contactForm.controls[field];
    return control.invalid && (control.dirty || control.touched);
  }

  fieldLength(field: 'name' | 'email' | 'subject' | 'message'): number {
    return this.contactForm.controls[field].value.length;
  }

  fieldLimit(field: 'name' | 'email' | 'subject' | 'message'): number | null {
    return FIELD_LIMITS[field];
  }

  canSubmit(): boolean {
    return this.contactForm.valid && !this.submitting();
  }

  private detectBrowserLocale(): LocaleCode {
    if (!isPlatformBrowser(this.platformId)) {
      return FALLBACK_LOCALE;
    }

    const navigatorLanguages = this.document.defaultView?.navigator.languages
      ?? [this.document.defaultView?.navigator.language].filter((language): language is string => typeof language === 'string');

    for (const candidate of navigatorLanguages) {
      const normalized = normalizeBrowserLocale(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return FALLBACK_LOCALE;
  }

  private applyMetadata(): void {
    this.seo.clearSeoRouteMetadata();
    this.clearMetadata();
    this.document.documentElement.lang = this.activeLocale();
    this.document.documentElement.dir = 'ltr';
    this.title.setTitle(this.translation.instant('contactPage.meta.title') as string);
    this.meta.updateTag({
      name: 'description',
      content: this.translation.instant('contactPage.meta.description') as string,
      [CONTACT_PAGE_ATTRIBUTE]: 'true',
    });

    const canonical = this.document.createElement('link');
    canonical.setAttribute(CONTACT_PAGE_ATTRIBUTE, 'true');
    canonical.setAttribute('rel', 'canonical');
    canonical.setAttribute('href', CONTACT_PAGE_CANONICAL);
    this.document.head.appendChild(canonical);
  }

  private clearMetadata(): void {
    this.document.head.querySelectorAll(CONTACT_PAGE_SELECTOR).forEach((element) => element.remove());
  }

  private resolveSubmitError(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 429) {
      const retryAfterSeconds = this.readRetryAfterSeconds(error);
      const retryAfterMinutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));

      return this.translation.instant('contactPage.form.submitRateLimitError', {
        email: this.inboxAddress,
        retryAfterMinutes,
      }) as string;
    }

    return this.translation.instant('contactPage.form.submitError', {
      email: this.inboxAddress,
    }) as string;
  }

  private readRetryAfterSeconds(error: HttpErrorResponse): number {
    const payload = error.error as ApiError | null;
    const retryAfterSeconds = typeof payload?.retryAfterSeconds === 'number'
      ? payload.retryAfterSeconds
      : Number(error.headers.get('Retry-After') ?? 0);

    return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds
      : 60;
  }

  ngOnDestroy(): void {
    this.clearMetadata();
  }
}

function normalizeBrowserLocale(locale: string | null | undefined): LocaleCode | null {
  if (!locale) {
    return null;
  }

  const normalized = locale.trim().toLowerCase();
  if (normalized === '') {
    return null;
  }

  if (normalized === 'zh' || normalized.startsWith('zh-cn') || normalized.startsWith('zh-sg') || normalized.startsWith('zh-hans')) {
    return 'zh-hans';
  }

  const directMatch = SUPPORTED_LOCALE_CODES.find((supportedLocale) => supportedLocale === normalized);
  if (directMatch) {
    return directMatch;
  }

  const baseLanguage = normalized.split(/[-_]/)[0];
  const baseMatch = SUPPORTED_LOCALE_CODES.find((supportedLocale) => supportedLocale === baseLanguage);
  return baseMatch ?? null;
}
