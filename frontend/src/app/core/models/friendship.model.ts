export type FriendshipStatus = 'pending' | 'accepted' | 'declined' | 'blocked';

export interface FriendUser {
  id: string;
  displayName: string;
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
