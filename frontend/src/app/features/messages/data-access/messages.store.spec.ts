import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MessagesApi } from '../../../core/api/messages.api';
import { UserMessage } from '../../../core/models/message.model';
import { MessagesStore } from './messages.store';

describe('MessagesStore', () => {
  let api: {
    readonly list: ReturnType<typeof vi.fn>;
    readonly markRead: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      list: vi.fn(),
      markRead: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        MessagesStore,
        { provide: MessagesApi, useValue: api },
      ],
    });
  });

  it('marks the initially opened unread message as read when messages load', async () => {
    const unreadMessage = message({ id: 'message-1', readAt: null });
    const readMessage = { ...unreadMessage, readAt: '2026-07-02T10:00:00+00:00' };
    api.list.mockReturnValue(of({ data: [unreadMessage], unreadCount: 1 }));
    api.markRead.mockReturnValue(of({ message: readMessage, unreadCount: 0 }));
    const store = TestBed.inject(MessagesStore);

    await store.ensureLoaded();

    expect(store.selectedMessage()?.id).toBe('message-1');
    expect(api.markRead).toHaveBeenCalledWith('message-1');
    expect(store.selectedMessage()?.readAt).toBe(readMessage.readAt);
    expect(store.unreadCount()).toBe(0);
  });

  it('does not mark the initially opened message again when it is already read', async () => {
    api.list.mockReturnValue(of({ data: [message({ id: 'message-1', readAt: '2026-07-02T10:00:00+00:00' })], unreadCount: 0 }));
    api.markRead.mockReturnValue(of({ message: message({ id: 'message-1' }), unreadCount: 0 }));
    const store = TestBed.inject(MessagesStore);

    await store.ensureLoaded();

    expect(api.markRead).not.toHaveBeenCalled();
    expect(store.unreadCount()).toBe(0);
  });
});

function message(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    id: 'message-1',
    sender: {
      id: 'sender-1',
      displayName: 'Sender',
    },
    subject: 'Subject',
    body: 'Body',
    createdAt: '2026-07-02T09:00:00+00:00',
    readAt: null,
    ...overrides,
  };
}
