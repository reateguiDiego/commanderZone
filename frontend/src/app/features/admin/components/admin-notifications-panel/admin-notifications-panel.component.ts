import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { MessagesApi } from '../../../../core/api/messages.api';
import { TranslationService } from '../../../../core/localization/translation.service';
import { RuntimeTranslatePipe, runtimeTranslationFallback } from '../../../../core/localization/runtime-translate.pipe';
import { FormatSelectComponent, FormatSelectOption } from '../../../../shared/components/format-select/format-select.component';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { MessageBodyComponent } from '../../../../shared/ui/message-body/message-body.component';
import { ToggleComponent } from '../../../../shared/ui/toggle/toggle.component';
import { AdminUsersApi } from '../../data-access/admin-users.api';
import { AdminUser } from '../../data-access/admin-users.models';

interface RecipientOption {
  readonly id: string;
  readonly name: string;
}

const ALL_RECIPIENT_ID = 'all';
const MAX_SUBJECT_LENGTH = 30;
const MAX_BODY_LENGTH = 200000;
const MAX_UPLOADED_IMAGE_DATA_URL_LENGTH = 160000;
type MessageSnippet = 'heading' | 'image' | 'link' | 'list' | 'separator';

@Component({
  selector: 'app-admin-notifications-panel',
  imports: [ReactiveFormsModule, LucideAngularModule, RuntimeTranslatePipe, FormatSelectComponent, CzButtonDirective, MessageBodyComponent, ToggleComponent],
  templateUrl: './admin-notifications-panel.component.html',
  styleUrl: './admin-notifications-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminNotificationsPanelComponent {
  private readonly bodyTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('bodyTextarea');
  private readonly imageUploadInput = viewChild<ElementRef<HTMLInputElement>>('imageUploadInput');
  private readonly adminUsersApi = inject(AdminUsersApi);
  private readonly formBuilder = inject(FormBuilder);
  private readonly messagesApi = inject(MessagesApi);
  private readonly translation = inject(TranslationService);

  readonly preselectedRecipient = input<RecipientOption | null>(null);
  readonly users = signal<readonly AdminUser[]>([]);
  readonly selectedRecipientId = signal(ALL_RECIPIENT_ID);
  readonly sendEmail = signal(false);
  readonly loadingUsers = signal(false);
  readonly sending = signal(false);
  readonly sentMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly bodyPreview = signal('');
  readonly recipientOptions = computed<readonly FormatSelectOption[]>(() => [
    { id: ALL_RECIPIENT_ID, labelKey: 'admin.notifications.allUsers' },
    ...this.users().map((user) => ({ id: user.id, name: user.displayName, searchText: user.email })),
  ]);

  readonly form = this.formBuilder.nonNullable.group({
    subject: ['', [Validators.required, Validators.maxLength(MAX_SUBJECT_LENGTH)]],
    body: ['', [Validators.required, Validators.maxLength(MAX_BODY_LENGTH)]],
  });

  constructor() {
    effect(() => this.applyPreselectedRecipient(this.preselectedRecipient(), this.recipientOptions()));
    void this.loadUsers();
  }

  async loadUsers(): Promise<void> {
    this.loadingUsers.set(true);
    this.errorMessage.set(null);

    try {
      const response = await firstValueFrom(this.adminUsersApi.listUsers());
      this.users.set(response.users);
    } catch (error: unknown) {
      this.errorMessage.set(this.resolveError(error, 'admin.notifications.errors.loadUsers'));
    } finally {
      this.loadingUsers.set(false);
    }
  }

  insertMessageSnippet(snippet: MessageSnippet): void {
    this.insertTextAtCursor(this.messageSnippet(snippet));
  }

  openImageUpload(): void {
    this.imageUploadInput()?.nativeElement.click();
  }

  async uploadImage(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.errorMessage.set(this.translateText('admin.notifications.errors.invalidImageType'));
      return;
    }

    try {
      const imageDataUrl = await this.compressedImageDataUrl(file);
      if (imageDataUrl.length > MAX_UPLOADED_IMAGE_DATA_URL_LENGTH) {
        this.errorMessage.set(this.translateText('admin.notifications.errors.imageTooLarge'));
        return;
      }

      this.insertTextAtCursor(`![](${imageDataUrl})\n`);
      this.errorMessage.set(null);
    } catch {
      this.errorMessage.set(this.translateText('admin.notifications.errors.readImage'));
    }
  }

  syncBodyPreview(): void {
    this.bodyPreview.set(this.form.controls.body.value);
  }

  selectRecipient(recipientId: string): void {
    if (this.recipientOptions().some((option) => option.id === recipientId)) {
      this.selectedRecipientId.set(recipientId);
    }
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      this.form.markAllAsTouched();
      return;
    }

    this.sending.set(true);
    this.sentMessage.set(null);
    this.errorMessage.set(null);

    try {
      const response = await firstValueFrom(this.messagesApi.sendAdminMessage({
        recipientId: this.selectedRecipientId(),
        subject: this.form.controls.subject.value.trim(),
        body: this.form.controls.body.value.trim(),
        sendEmail: this.sendEmail(),
      }));
      this.sentMessage.set(this.translateText('admin.notifications.messageSent', { count: response.sent }));
      this.form.reset({ subject: '', body: '' });
      this.bodyPreview.set('');
    } catch (error: unknown) {
      this.errorMessage.set(this.resolveError(error, 'admin.notifications.errors.sendMessage'));
    } finally {
      this.sending.set(false);
    }
  }

  canSubmit(): boolean {
    return this.form.valid && !this.sending() && this.selectedRecipientId().trim() !== '';
  }

  fieldInvalid(field: 'body' | 'subject'): boolean {
    const control = this.form.controls[field];

    return control.invalid && (control.dirty || control.touched);
  }

  fieldLength(field: 'body' | 'subject'): number {
    return this.form.controls[field].value.length;
  }

  fieldLimit(field: 'body' | 'subject'): number {
    return field === 'subject' ? MAX_SUBJECT_LENGTH : MAX_BODY_LENGTH;
  }

  private resolveError(error: unknown, fallbackKey: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }

    return this.translateText(fallbackKey);
  }

  private messageSnippet(snippet: MessageSnippet): string {
    switch (snippet) {
      case 'heading':
        return `## ${this.translateText('shared.text.title')}\n`;
      case 'image':
        return `![${this.translateText('admin.notifications.snippets.imageDescription')}](https://example.com/image.png)\n`;
      case 'link':
        return `[${this.translateText('admin.notifications.snippets.linkText')}](https://example.com)\n`;
      case 'list':
        return `- ${this.translateText('admin.notifications.snippets.listItem')}\n`;
      case 'separator':
        return '---\n';
    }
  }

  private insertTextAtCursor(insertion: string): void {
    const textarea = this.bodyTextarea()?.nativeElement;
    const control = this.form.controls.body;
    const currentBody = control.value;
    const selectionStart = textarea?.selectionStart ?? currentBody.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const prefix = selectionStart > 0 && currentBody.charAt(selectionStart - 1) !== '\n' ? '\n' : '';
    const suffix = selectionEnd < currentBody.length && currentBody.charAt(selectionEnd) !== '\n' ? '\n' : '';
    const nextBody = [
      currentBody.slice(0, selectionStart),
      prefix,
      insertion,
      suffix,
      currentBody.slice(selectionEnd),
    ].join('');

    if (nextBody.length > MAX_BODY_LENGTH) {
      this.errorMessage.set(this.translateText('admin.notifications.errors.messageTooLong', { count: MAX_BODY_LENGTH }));
      return;
    }

    control.setValue(nextBody);
    control.markAsDirty();
    this.bodyPreview.set(nextBody);

    queueMicrotask(() => {
      if (!textarea) {
        return;
      }

      const cursorPosition = selectionStart + prefix.length + insertion.length;
      textarea.focus();
      textarea.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  private compressedImageDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const maxSize = 720;
        const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Canvas is not available.'));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.72));
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Image could not be loaded.'));
      };

      image.src = objectUrl;
    });
  }

  private applyPreselectedRecipient(recipient: RecipientOption | null, options: readonly FormatSelectOption[]): void {
    if (!recipient || recipient.id.trim() === '' || recipient.name.trim() === '') {
      return;
    }

    const option = options.find((candidate) => candidate.id === recipient.id) ?? recipient;
    if (this.selectedRecipientId() === option.id) {
      return;
    }

    this.selectRecipient(option.id);
  }

  private translateText(key: string, params?: Record<string, unknown>): string {
    const translated = this.translation.instant(key, params);

    return typeof translated === 'string' && translated !== key
      ? translated
      : runtimeTranslationFallback(key, params);
  }
}
