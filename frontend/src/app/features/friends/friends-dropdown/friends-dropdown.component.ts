import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { PlayerInfoComponent } from '../../../shared/ui/player-info/player-info.component';
import { FriendListRow } from '../data-access/friends.store';
import { FriendshipStatus } from '../../../core/models/friendship.model';
import { FriendsStore } from '../data-access/friends.store';

type FriendsDropdownTab = 'friends' | 'requests' | 'invitations' | 'search';

@Component({
  selector: 'app-friends-dropdown',
  imports: [RuntimeTranslatePipe, FormsModule, LucideAngularModule, PrettyScrollDirective, PlayerInfoComponent],
  templateUrl: './friends-dropdown.component.html',
  styleUrl: './friends-dropdown.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendsDropdownComponent {
  readonly store = inject(FriendsStore);
  private readonly onlineOpenOverride = signal<boolean | null>(null);
  private readonly disconnectedOpenOverride = signal<boolean | null>(null);
  private readonly incomingRequestsOpenOverride = signal<boolean | null>(null);
  private readonly sentRequestsOpenOverride = signal<boolean | null>(null);
  readonly activeTab = signal<FriendsDropdownTab>('friends');
  readonly friendsRows = computed(() => this.store.rows().filter((row) => row.kind === 'friend'));
  readonly onlineFriendsRows = computed(() =>
    this.friendsRows().filter((row) => row.presence === 'online' || row.presence === 'in_game'),
  );
  readonly disconnectedFriendsRows = computed(() =>
    this.friendsRows().filter((row) => row.presence !== 'online' && row.presence !== 'in_game'),
  );
  readonly incomingRequestRows = computed(() => this.store.rows().filter((row) => row.kind === 'incoming'));
  readonly sentRequestRows = computed(() => this.store.rows().filter((row) => row.kind === 'pending'));
  readonly requestRows = computed(() => [...this.incomingRequestRows(), ...this.sentRequestRows()]);
  readonly invitationRows = computed(() => this.store.rows().filter((row) => row.kind === 'room-invite'));
  readonly requestCount = computed(() => this.requestRows().length);
  readonly incomingRequestCount = computed(() => this.incomingRequestRows().length);
  readonly invitationCount = computed(() => this.invitationRows().length);
  readonly hasRequests = computed(() => this.requestCount() > 0);
  readonly hasIncomingRequests = computed(() => this.incomingRequestCount() > 0);
  readonly hasSentRequests = computed(() => this.sentRequestRows().length > 0);
  readonly hasInvitations = computed(() => this.invitationCount() > 0);
  readonly currentTab = computed<FriendsDropdownTab>(() => {
    const tab = this.activeTab();

    if (tab === 'requests' && !this.hasRequests()) {
      return 'friends';
    }

    if (tab === 'invitations' && !this.hasInvitations()) {
      return 'friends';
    }

    return tab;
  });
  readonly searchReady = computed(() => this.store.searchQuery().trim().length >= 2);
  readonly hasOnlineFriends = computed(() => this.onlineFriendsRows().length > 0);
  readonly hasDisconnectedFriends = computed(() => this.disconnectedFriendsRows().length > 0);
  readonly onlineOpen = computed(() => this.onlineOpenOverride() ?? this.hasOnlineFriends());
  readonly disconnectedOpen = computed(() => this.disconnectedOpenOverride() ?? this.defaultDisconnectedOpen());
  readonly incomingRequestsOpen = computed(() => this.incomingRequestsOpenOverride() ?? this.hasIncomingRequests());
  readonly sentRequestsOpen = computed(() => this.sentRequestsOpenOverride() ?? this.hasSentRequests());

  private readonly defaultDisconnectedOpen = computed(() => {
    if (!this.hasDisconnectedFriends()) {
      return false;
    }

    return this.onlineFriendsRows().length <= 10;
  });

  selectTab(tab: FriendsDropdownTab): void {
    this.activeTab.set(tab);
  }

  toggleOnline(): void {
    if (!this.hasOnlineFriends()) {
      return;
    }

    this.onlineOpenOverride.set(!this.onlineOpen());
  }

  toggleDisconnected(): void {
    if (!this.hasDisconnectedFriends()) {
      return;
    }

    this.disconnectedOpenOverride.set(!this.disconnectedOpen());
  }

  toggleIncomingRequests(): void {
    if (!this.hasIncomingRequests()) {
      return;
    }

    this.incomingRequestsOpenOverride.set(!this.incomingRequestsOpen());
  }

  toggleSentRequests(): void {
    if (!this.hasSentRequests()) {
      return;
    }

    this.sentRequestsOpenOverride.set(!this.sentRequestsOpen());
  }

  friendStatusKey(row: FriendListRow): string {
    if (row.presence === 'online') {
      return 'navigation.friends.friendsDropdown.onlineStatus';
    }

    if (row.presence === 'in_game') {
      return 'navigation.friends.friendsDropdown.inGameStatus';
    }

    return 'navigation.friends.friendsDropdown.offlineStatus';
  }

  friendshipStatusKey(status: FriendshipStatus | null | undefined): string {
    switch (status) {
      case 'pending':
        return 'navigation.friends.friendsDropdown.pendingStatus';
      case 'accepted':
        return 'navigation.friends.friendsDropdown.acceptedStatus';
      case 'blocked':
        return 'navigation.friends.friendsDropdown.blockedStatus';
      case 'declined':
        return 'navigation.friends.friendsDropdown.declinedStatus';
      default:
        return 'navigation.friends.friendsDropdown.sendFriendRequest';
    }
  }

  runPrimaryAction(row: FriendListRow): void {
    switch (row.kind) {
      case 'incoming':
        void this.store.acceptRequest(row.id);
        return;
      case 'room-invite':
        void this.store.acceptRoomInvite(row.id);
        return;
      case 'pending':
        void this.store.cancelRequest(row.id);
        return;
      case 'friend':
        void this.store.removeFriend(row.id);
        return;
    }
  }

  declineIncoming(row: FriendListRow): void {
    if (row.kind === 'incoming') {
      void this.store.declineRequest(row.id);
    }

    if (row.kind === 'room-invite') {
      void this.store.declineRoomInvite(row.id);
    }
  }
}
