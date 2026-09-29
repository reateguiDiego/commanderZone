import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom, timer } from 'rxjs';
import { canAccessModeration } from '../../../core/auth/user-roles';
import { User } from '../../../core/models/user.model';
import { MercureService } from '../../../core/realtime/mercure.service';
import { ReportsApi } from './reports.api';

@Injectable({ providedIn: 'root' })
export class ModerationSummaryStore {
  private readonly api = inject(ReportsApi);
  private readonly mercure = inject(MercureService);
  private readonly viewerIdState = signal<string | null>(null);
  private readonly pendingReviewCountState = signal(0);
  private readonly loadingState = signal(false);
  private streamSubscription: Subscription | null = null;
  private pollingSubscription: Subscription | null = null;
  private loadSequence = 0;

  readonly pendingReviewCount = this.pendingReviewCountState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly shouldDisplay = computed(() => this.viewerIdState() !== null);
  readonly badgeLabel = computed(() => this.pendingReviewCountState() > 99 ? '99+' : String(this.pendingReviewCountState()));

  syncViewer(user: User | null | undefined): void {
    const viewerId = canAccessModeration(user) ? user?.id ?? null : null;
    if (viewerId === this.viewerIdState()) {
      return;
    }

    this.stopStream();
    this.viewerIdState.set(viewerId);
    this.pendingReviewCountState.set(0);
    if (!viewerId) {
      return;
    }

    void this.refresh();
    this.pollingSubscription = timer(60_000, 60_000).subscribe(() => void this.refresh());
    this.streamSubscription = this.mercure.moderationSummaryEvents().subscribe({
      next: () => void this.refresh(),
      error: () => {
        this.streamSubscription = null;
      },
    });
  }

  reset(): void {
    this.stopStream();
    this.viewerIdState.set(null);
    this.pendingReviewCountState.set(0);
    this.loadingState.set(false);
  }

  async refresh(): Promise<void> {
    if (!this.viewerIdState()) {
      return;
    }

    const requestSequence = ++this.loadSequence;
    this.loadingState.set(true);
    try {
      const summary = await firstValueFrom(this.api.getSummary());
      if (requestSequence === this.loadSequence) {
        this.pendingReviewCountState.set(Math.max(0, summary.pendingReviewCount));
      }
    } catch {
      // The previous count is less surprising than replacing it with zero on a transient failure.
    } finally {
      if (requestSequence === this.loadSequence) {
        this.loadingState.set(false);
      }
    }
  }

  private stopStream(): void {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = null;
  }
}
