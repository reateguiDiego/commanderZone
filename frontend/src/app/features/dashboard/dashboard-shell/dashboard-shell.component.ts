import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, filter } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { MercureService } from '../../../core/realtime/mercure.service';
import { FriendsDropdownComponent } from '../../friends/friends-dropdown/friends-dropdown.component';
import { FriendsStore } from '../../friends/data-access/friends.store';

@Component({
  selector: 'app-dashboard-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideAngularModule,
    FriendsDropdownComponent,
  ],
  templateUrl: './dashboard-shell.component.html',
  styleUrl: './dashboard-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FriendsStore],
})
export class DashboardShellComponent implements OnDestroy {
  readonly auth = inject(AuthStore);
  readonly friends = inject(FriendsStore);
  private readonly mercure = inject(MercureService);
  private readonly router = inject(Router);
  readonly friendsOpen = signal(false);
  readonly roomFocus = signal(this.isTableAssistantRoomUrl(this.router.url));
  private roomInviteSubscription?: Subscription;

  constructor() {
    void this.friends.load();
    this.startRoomInviteSync();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        this.roomFocus.set(this.isTableAssistantRoomUrl(event.urlAfterRedirects));
        void this.friends.load();
        this.startRoomInviteSync();
      });
  }

  @HostListener('document:click', ['$event'])
  closeFriendsOnOutsideClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('.friends-dropdown')) {
      return;
    }

    this.closeFriends();
  }

  toggleFriends(event: MouseEvent): void {
    event.stopPropagation();

    if (this.friendsOpen()) {
      this.closeFriends();
      return;
    }

    this.friendsOpen.set(true);
    void this.friends.load();
  }

  closeFriends(): void {
    if (!this.friendsOpen()) {
      return;
    }

    this.friendsOpen.set(false);
    this.friends.resetTransientState();
  }

  @HostListener('window:pagehide')
  @HostListener('window:beforeunload')
  markOfflineBeforeUnload(): void {
    this.auth.markOfflineOnUnload();
  }

  async logout(): Promise<void> {
    this.stopRoomInviteSync();
    await this.auth.logout();
    await this.router.navigate(['/auth/login']);
  }

  ngOnDestroy(): void {
    this.stopRoomInviteSync();
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
        void this.friends.load();
      },
      error: () => {
        // Fallback remains periodic loads on navigation/open dropdown.
      },
    });
  }

  private isTableAssistantRoomUrl(url: string): boolean {
    const path = url.split(/[?#]/)[0];
    return /^\/table-assistant\/[^/]+$/.test(path);
  }
}
