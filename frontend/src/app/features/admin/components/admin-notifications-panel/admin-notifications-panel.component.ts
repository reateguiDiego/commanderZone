import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { MessagesApi } from '../../../../core/api/messages.api';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { MessageBodyComponent } from '../../../../shared/ui/message-body/message-body.component';
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
  imports: [ReactiveFormsModule, LucideAngularModule, CzButtonDirective, MessageBodyComponent],
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

  readonly preselectedRecipient = input<RecipientOption | null>(null);
  readonly users = signal<readonly AdminUser[]>([]);
  readonly recipientsOpen = signal(false);
  readonly recipientQuery = signal('Todos');
  readonly selectedRecipient = signal<RecipientOption>({ id: ALL_RECIPIENT_ID, name: 'Todos' });
  readonly recipientControl = this.formBuilder.nonNullable.control('Todos');
  readonly loadingUsers = signal(false);
  readonly sending = signal(false);
  readonly sentMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly bodyPreview = signal('');
  readonly recipientOptions = computed<readonly RecipientOption[]>(() => [
    { id: ALL_RECIPIENT_ID, name: 'Todos' },
    ...this.users().map((user) => ({ id: user.id, name: user.displayName })),
  ]);
  readonly filteredRecipients = computed(() => {
    const query = this.recipientQuery().trim().toLowerCase();
    if (query === '' || query === 'todos') {
      return this.recipientOptions();
    }

    return this.recipientOptions().filter((option) => option.name.toLowerCase().includes(query));
  });

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
      this.errorMessage.set(this.resolveError(error, 'Could not load users.'));
    } finally {
      this.loadingUsers.set(false);
    }
  }

  updateRecipientQuery(value: string): void {
    this.recipientQuery.set(value);
    this.recipientsOpen.set(true);
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
      this.errorMessage.set('Please choose an image file.');
      return;
    }

    try {
      const imageDataUrl = await this.compressedImageDataUrl(file);
      if (imageDataUrl.length > MAX_UPLOADED_IMAGE_DATA_URL_LENGTH) {
        this.errorMessage.set('Uploaded image is too large for a message. Use a smaller image.');
        return;
      }

      this.insertTextAtCursor(`![](${imageDataUrl})\n`);
      this.errorMessage.set(null);
    } catch {
      this.errorMessage.set('Could not read the uploaded image.');
    }
  }

  syncBodyPreview(): void {
    this.bodyPreview.set(this.form.controls.body.value);
  }

  selectRecipient(option: RecipientOption): void {
    this.selectedRecipient.set(option);
    this.recipientQuery.set(option.name);
    this.recipientControl.setValue(option.name, { emitEvent: false });
    this.recipientsOpen.set(false);
  }

  openRecipients(): void {
    this.recipientsOpen.set(true);
  }

  closeRecipients(): void {
    queueMicrotask(() => {
      const selected = this.selectedRecipient();
      this.recipientQuery.set(selected.name);
      this.recipientControl.setValue(selected.name, { emitEvent: false });
      this.recipientsOpen.set(false);
    });
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
        recipientId: this.selectedRecipient().id,
        subject: this.form.controls.subject.value.trim(),
        body: this.form.controls.body.value.trim(),
      }));
      this.sentMessage.set(`Message sent to ${response.sent} user(s).`);
      this.form.reset({ subject: '', body: '' });
      this.bodyPreview.set('');
    } catch (error: unknown) {
      this.errorMessage.set(this.resolveError(error, 'Could not send message.'));
    } finally {
      this.sending.set(false);
    }
  }

  canSubmit(): boolean {
    return this.form.valid && !this.sending() && this.selectedRecipient().id.trim() !== '';
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

  private resolveError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }

    return fallback;
  }

  private messageSnippet(snippet: MessageSnippet): string {
    switch (snippet) {
      case 'heading':
        return '## Title\n';
      case 'image':
        return '![Image description](https://example.com/image.png)\n';
      case 'link':
        return '[Link text](https://example.com)\n';
      case 'list':
        return '- List item\n';
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
      this.errorMessage.set(`Message is too long. Maximum length is ${MAX_BODY_LENGTH} characters.`);
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

  private applyPreselectedRecipient(recipient: RecipientOption | null, options: readonly RecipientOption[]): void {
    if (!recipient || recipient.id.trim() === '' || recipient.name.trim() === '') {
      return;
    }

    const option = options.find((candidate) => candidate.id === recipient.id) ?? recipient;
    if (this.selectedRecipient().id === option.id && this.recipientQuery() === option.name) {
      return;
    }

    this.selectRecipient(option);
  }
}
