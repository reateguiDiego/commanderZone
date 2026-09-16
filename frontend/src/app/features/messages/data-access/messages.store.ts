import { FreshResource } from '../../../core/api/fresh-resource';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { MessagesApi } from '../../../core/api/messages.api';
import { runtimeTranslationFallback } from '../../../core/localization/runtime-translate.pipe';
import { UserMessage } from '../../../core/models/message.model';

@Injectable({ providedIn: 'root' })
export class MessagesStore {
  private readonly api = inject(MessagesApi);
  private readonly translate = inject(NgxTranslateService, { optional: true });
  private readonly messagesState = signal<readonly UserMessage[]>([]);
  private readonly unreadCountState = signal(0);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly body = new FreshResource();
  private readonly summary = new FreshResource();
  readonly state = this.body.state.asReadonly();
  readonly loadedAt = this.body.loadedAt.asReadonly();
  readonly summaryState = this.summary.state.asReadonly();
  readonly totalCount = signal(0);

  private userId: string | null | undefined;

  setUser(userId: string | null): void {
    if (this.userId === userId) return;
    this.userId = userId;
    this.body.reset();
    this.summary.reset();
    this.messagesState.set([]);
    this.unreadCountState.set(0);
    this.totalCount.set(0);
    this.selectedMessageId.set(null);
    this.loadingState.set(false);
    this.resetTransientState();
  }

  readonly selectedMessageId = signal<string | null>(null);
  readonly messages = this.messagesState.asReadonly();
  readonly unreadCount = this.unreadCountState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly selectedMessage = computed<UserMessage | null>(() => {
    const selectedId = this.selectedMessageId();

    return selectedId === null
      ? null
      : this.messagesState().find((message) => message.id === selectedId) ?? null;
  });

  ensureLoaded(): Promise<void> { return this.load(); }

  async ensureSummaryLoaded(): Promise<void> {
    this.errorState.set(null);
    try {
      await this.summary.load(() => firstValueFrom(this.api.summary()), (response) => {
        this.unreadCountState.set(response.unreadCount);
        this.totalCount.set(response.totalCount);
      });
    } catch (error: unknown) {
      this.errorState.set(this.errorMessage(error, 'navigation.messages.messagesDropdown.couldNotLoadMessages'));
    }
  }

  handleRealtimeEvent(): void {
    this.body.invalidate();
    this.summary.invalidate();
  }

  async load(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      await this.body.load(() => firstValueFrom(this.api.list()), (response) => {
        this.messagesState.set(response.data);
        this.unreadCountState.set(response.unreadCount);
        if (this.summary.loadedAt() === null) this.totalCount.set(response.data.length);
      });
    } catch (error: unknown) {
      this.errorState.set(this.errorMessage(error, 'navigation.messages.messagesDropdown.couldNotLoadMessages'));
    } finally {
      this.loadingState.set(false);
    }
  }

  async selectMessage(messageId: string): Promise<void> {
    this.selectedMessageId.set(messageId);
    await this.markMessageRead(messageId);
  }

  private async markMessageRead(messageId: string): Promise<void> {
    const message = this.messagesState().find((candidate) => candidate.id === messageId);
    if (!message || message.readAt !== null) {
      return;
    }

    try {
      const response = await firstValueFrom(this.api.markRead(messageId));
      this.body.invalidatePendingRead();
      this.summary.invalidate();
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
