import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { canAccessAdmin as userCanAccessAdmin } from '../../../core/auth/user-roles';
import { MercureService } from '../../../core/realtime/mercure.service';
import { PageHeaderStore } from '../../../core/ui/page-header.store';
import { FriendsStore } from '../../friends/data-access/friends.store';
import { MessagesStore } from '../../messages/data-access/messages.store';
import { RuntimeTranslatePipe, runtimeTranslationFallback } from '../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { DashboardHeaderComponent } from './components/dashboard-header/dashboard-header.component';
import { DashboardPageContextComponent } from './components/dashboard-page-context/dashboard-page-context.component';

@Component({
  selector: 'app-dashboard-shell',
  imports: [RouterOutlet, DashboardHeaderComponent, DashboardPageContextComponent, CzButtonDirective, RuntimeTranslatePipe],
  templateUrl: './dashboard-shell.component.html',
  styleUrl: './dashboard-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardShellComponent implements OnDestroy {
  readonly auth = inject(AuthStore);
  readonly friends = inject(FriendsStore);
  readonly messages = inject(MessagesStore);
  readonly pageHeader = inject(PageHeaderStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly mercure = inject(MercureService);
  private readonly router = inject(Router);
  readonly friendsOpen = signal(false);
  readonly messagesOpen = signal(false);
  readonly roomFocus = signal(this.isTableAssistantRoomUrl(this.router.url));
  readonly userLabel = computed(() => this.auth.displayName() ?? this.auth.user()?.email ?? runtimeTranslationFallback('shared.text.player'));
  readonly canAccessAdmin = computed(() => userCanAccessAdmin(this.auth.user()));
  private roomInviteSubscription?: Subscription;
  private messageSubscription?: Subscription;
  private friendSubscription?: Subscription;
  private headerUserId: string | null | undefined;

  constructor() {
    const closeFriendsOnOutsidePointer = (event: PointerEvent) => this.closeFriendsOnOutsidePointer(event.target);
    this.document.addEventListener('pointerdown', closeFriendsOnOutsidePointer, true);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('pointerdown', closeFriendsOnOutsidePointer, true);
    });

    this.syncAuthenticatedHeaderState();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        this.roomFocus.set(this.isTableAssistantRoomUrl(event.urlAfterRedirects));
        this.closeFriends();
        this.closeMessages();
        this.syncAuthenticatedHeaderState();
      });
  }

  private closeFriendsOnOutsidePointer(target: EventTarget | null): void {
    if (target instanceof Element && (target.closest('.friends-dropdown') || target.closest('.messages-dropdown'))) {
      return;
    }

    this.closeFriends();
    this.closeMessages();
  }

  toggleFriends(event: MouseEvent): void {
    event.stopPropagation();

    if (this.friendsOpen()) {
      this.closeFriends();
      return;
    }

    this.closeMessages();
    this.friendsOpen.set(true);
    void this.friends.ensureSummaryLoaded();
    void this.friends.ensureLoaded();
  }

  toggleMessages(event: MouseEvent): void {
    event.stopPropagation();

    if (this.messagesOpen()) {
      this.closeMessages();
      return;
    }

    this.closeFriends();
    this.messagesOpen.set(true);
    void this.messages.ensureSummaryLoaded();
    void this.messages.ensureLoaded();
  }

  closeFriends(): void {
    if (!this.friendsOpen()) {
      return;
    }

    this.friendsOpen.set(false);
    this.friends.resetTransientState();
  }

  closeMessages(): void {
    if (!this.messagesOpen()) {
      return;
    }

    this.messagesOpen.set(false);
    this.messages.resetTransientState();
  }

  @HostListener('window:pagehide')
  @HostListener('window:beforeunload')
  markOfflineBeforeUnload(): void {
    this.auth.markOfflineOnUnload();
  }

  async logout(): Promise<void> {
    this.stopRoomInviteSync();
    this.stopFriendSync();
    await this.auth.logout();
    this.friends.setUser(null);
    this.messages.setUser(null);
    await this.router.navigate(['/auth/login']);
  }

  async stopImpersonation(): Promise<void> {
    await this.auth.stopImpersonation();
    await this.router.navigate(['/admin']);
  }

  ngOnDestroy(): void {
    this.stopRoomInviteSync();
    this.stopFriendSync();
  }

  private stopRoomInviteSync(): void {
    this.roomInviteSubscription?.unsubscribe();
    this.roomInviteSubscription = undefined;
  }

  private startRoomInviteSync(): void {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return;
    }
    if (this.roomInviteSubscription) {
      return;
    }

    this.roomInviteSubscription = this.mercure.roomInviteEvents(userId).subscribe({
      next: () => {
        this.friends.handleRoomInviteEvent();
        void this.friends.ensureSummaryLoaded();
        if (this.friendsOpen()) void this.friends.ensureLoaded();
      },
      error: () => {
        // Fallback remains periodic loads on navigation/open dropdown.
      },
    });
  }

  private stopFriendSync(): void {
    this.messageSubscription?.unsubscribe();
    this.messageSubscription = undefined;
    this.friendSubscription?.unsubscribe();
    this.friendSubscription = undefined;
  }

  private syncAuthenticatedHeaderState(): void {
    const userId = this.auth.isAuthenticated() ? this.auth.user()?.id ?? null : null;
    if (this.headerUserId !== userId) {
      this.stopRoomInviteSync();
      this.stopFriendSync();
      this.headerUserId = userId;
    }
    this.friends.setUser(userId);
    this.messages.setUser(userId);
    if (!this.auth.isAuthenticated()) {
      this.closeFriends();
      this.closeMessages();
      this.stopRoomInviteSync();
      this.stopFriendSync();
      return;
    }

    void this.friends.ensureSummaryLoaded();
    void this.messages.ensureSummaryLoaded();
    this.startRoomInviteSync();
    this.startFriendSync();
    this.startMessageSync();
  }

  private startFriendSync(): void {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return;
    }
    if (this.friendSubscription) {
      return;
    }

    this.friendSubscription = this.mercure.friendEvents(userId).subscribe({
      next: (event) => {
        this.friends.handleRealtimeEvent(event);
        void this.friends.ensureSummaryLoaded();
        if (this.friendsOpen()) void this.friends.ensureLoaded();
      },
      error: () => {
        // User-triggered actions and the initial load remain the fallback.
      },
    });
  }

  private startMessageSync(): void {
    const userId = this.auth.user()?.id;
    if (!userId || this.messageSubscription) return;
    this.messageSubscription = this.mercure.messageEvents(userId).subscribe({
      next: () => {
        this.messages.handleRealtimeEvent();
        void this.messages.ensureSummaryLoaded();
        if (this.messagesOpen()) void this.messages.ensureLoaded();
      },
      error: () => { this.messageSubscription = undefined; },
    });
  }

  private isTableAssistantRoomUrl(url: string): boolean {
    const path = url.split(/[?#]/)[0];
    return /^\/table-assistant\/[^/]+$/.test(path);
  }

}
