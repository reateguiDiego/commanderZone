import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { MessagesApi } from '../../../core/api/messages.api';
import { runtimeTranslationFallback } from '../../../core/localization/runtime-translate.pipe';
import { UserMessage } from '../../../core/models/message.model';

@Injectable()
export class MessagesStore {
  private readonly api = inject(MessagesApi);
  private readonly translate = inject(NgxTranslateService, { optional: true });
  private readonly messagesState = signal<readonly UserMessage[]>([]);
  private readonly unreadCountState = signal(0);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private loaded = false;

  readonly selectedMessageId = signal<string | null>(null);
  readonly messages = this.messagesState.asReadonly();
  readonly unreadCount = this.unreadCountState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly selectedMessage = computed<UserMessage | null>(() => {
    const selectedId = this.selectedMessageId();

    return this.messagesState().find((message) => message.id === selectedId) ?? this.messagesState()[0] ?? null;
  });

  async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await this.load();
  }

  async load(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const response = await firstValueFrom(this.api.list());
      this.messagesState.set(response.data);
      this.unreadCountState.set(response.unreadCount);
      this.loaded = true;
      if (!this.selectedMessageId() && response.data.length > 0) {
        this.selectedMessageId.set(response.data[0].id);
      }
    } catch (error: unknown) {
      this.errorState.set(this.errorMessage(error, 'navigation.messages.messagesDropdown.couldNotLoadMessages'));
    } finally {
      this.loadingState.set(false);
    }
  }

  async selectMessage(messageId: string): Promise<void> {
    this.selectedMessageId.set(messageId);
    const message = this.messagesState().find((candidate) => candidate.id === messageId);
    if (!message || message.readAt !== null) {
      return;
    }

    try {
      const response = await firstValueFrom(this.api.markRead(messageId));
      this.unreadCountState.set(response.unreadCount);
      this.messagesState.update((messages) =>
        messages.map((current) => current.id === response.message.id ? response.message : current),
      );
    } catch (error: unknown) {
      this.errorState.set(this.errorMessage(error, 'navigation.messages.messagesDropdown.couldNotMarkMessageRead'));
    }
  }

  resetTransientState(): void {
    this.errorState.set(null);
  }

  private errorMessage(error: unknown, fallbackKey: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }

    return this.text(fallbackKey);
  }

  private text(key: string): string {
    const translated = this.translate?.instant(key);
    return typeof translated === 'string' && translated !== key
      ? translated
      : runtimeTranslationFallback(key);
  }
}
