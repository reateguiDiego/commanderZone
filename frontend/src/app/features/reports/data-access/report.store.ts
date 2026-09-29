import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  CreateReportRequest,
  ReportCategory,
  ReportDraft,
} from './reports.models';
import { ReportsApi } from './reports.api';

type ReportSubmissionStatus = 'idle' | 'submitting' | 'succeeded' | 'failed';

@Injectable({ providedIn: 'root' })
export class ReportStore {
  private readonly api = inject(ReportsApi);
  private readonly activeDraftState = signal<ReportDraft | null>(null);
  private readonly submissionStatusState = signal<ReportSubmissionStatus>('idle');
  private readonly submissionErrorState = signal<string | null>(null);

  readonly activeDraft = this.activeDraftState.asReadonly();
  readonly submissionStatus = this.submissionStatusState.asReadonly();
  readonly submissionError = this.submissionErrorState.asReadonly();
  readonly isOpen = computed(() => this.activeDraftState() !== null);
  readonly isSubmitting = computed(() => this.submissionStatusState() === 'submitting');
  readonly submissionSucceeded = computed(() => this.submissionStatusState() === 'succeeded');

  open(draft: ReportDraft): void {
    this.activeDraftState.set(draft);
    this.submissionStatusState.set('idle');
    this.submissionErrorState.set(null);
  }

  close(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.activeDraftState.set(null);
    this.submissionStatusState.set('idle');
    this.submissionErrorState.set(null);
  }

  async submit(category: ReportCategory, comment: string): Promise<void> {
    const draft = this.activeDraftState();
    if (!draft || this.isSubmitting()) {
      return;
    }

    const normalizedComment = comment.trim();
    if (category === 'other_problem' && normalizedComment === '') {
      this.submissionStatusState.set('failed');
      this.submissionErrorState.set('reports.modal.commentRequired');
      return;
    }

    this.submissionStatusState.set('submitting');
    this.submissionErrorState.set(null);

    try {
      await firstValueFrom(this.api.createReport(this.requestForDraft(draft, category, normalizedComment)));
      this.submissionStatusState.set('succeeded');
    } catch (error: unknown) {
      this.submissionStatusState.set('failed');
      this.submissionErrorState.set(this.errorKey(error));
    }
  }

  private requestForDraft(
    draft: ReportDraft,
    category: ReportCategory,
    comment: string,
  ): CreateReportRequest {
    const commentPayload = comment === '' ? {} : { comment };

    switch (draft.source) {
      case 'profile':
        return { source: draft.source, category, reportedUserId: draft.reportedUserId, ...commentPayload };
      case 'game_player':
        return {
          source: draft.source,
          category,
          gameId: draft.gameId,
          reportedUserId: draft.reportedUserId,
          ...commentPayload,
        };
      case 'chat_message':
        return {
          source: draft.source,
          category,
          gameId: draft.gameId,
          messageId: draft.messageId,
          ...commentPayload,
        };
    }
  }

  private errorKey(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'reports.errors.duplicate';
    }

    return 'reports.errors.submit';
  }
}
