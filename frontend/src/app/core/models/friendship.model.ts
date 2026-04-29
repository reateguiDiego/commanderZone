export type FriendshipStatus = 'pending' | 'accepted' | 'declined' | 'blocked';
export type FriendPresence = 'online' | 'in_game' | 'offline';

export interface FriendUser {
  id: string;
  displayName: string;
  presence?: FriendPresence;
}

export interface Friendship {
  id: string;
  status: FriendshipStatus;
  requester: FriendUser;
  recipient: FriendUser;
  friend?: FriendUser;
  createdAt: string;
  updatedAt: string;
}

export interface FriendSearchResult {
  id: string;
  email: string;
  displayName: string;
  friendshipStatus: FriendshipStatus | null;
}
