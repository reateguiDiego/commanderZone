import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { filter } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
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
export class DashboardShellComponent {
  readonly auth = inject(AuthStore);
  readonly friends = inject(FriendsStore);
  private readonly router = inject(Router);
  readonly friendsOpen = signal(false);
  readonly roomFocus = signal(this.isTableAssistantRoomUrl(this.router.url));

  constructor() {
    void this.friends.load();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        this.roomFocus.set(this.isTableAssistantRoomUrl(event.urlAfterRedirects));
        void this.friends.load();
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
    await this.auth.logout();
    await this.router.navigate(['/auth/login']);
  }

  private isTableAssistantRoomUrl(url: string): boolean {
    const path = url.split(/[?#]/)[0];
    return /^\/table-assistant\/[^/]+$/.test(path);
  }
}
