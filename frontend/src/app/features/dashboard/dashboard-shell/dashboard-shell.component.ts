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
  readonly friendsOpen = signal(false);
  private readonly router = inject(Router);

  constructor() {
    void this.friends.load();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
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
}
