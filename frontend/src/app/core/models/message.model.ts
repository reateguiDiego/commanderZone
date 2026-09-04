import { UserAvatar, UserDisplayNameStyle } from './user.model';

export interface MessageSender {
  readonly id: string;
  readonly displayName: string;
  readonly displayNameStyle?: UserDisplayNameStyle;
  readonly avatar?: UserAvatar;
}

export interface UserMessage {
  readonly id: string;
  readonly sender: MessageSender;
  readonly subject: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface MessagesResponse {
  readonly data: readonly UserMessage[];
  readonly unreadCount: number;
}

export interface MessageResponse {
  readonly message: UserMessage;
  readonly unreadCount: number;
}

export type AdminMessageDelivery = 'internal' | 'email' | 'both';

export interface AdminMessageSendPayload {
  readonly recipientId: string;
  readonly subject: string;
  readonly body: string;
  readonly delivery: AdminMessageDelivery;
}

export interface AdminMessageSendResponse {
  readonly sent: number;
}
