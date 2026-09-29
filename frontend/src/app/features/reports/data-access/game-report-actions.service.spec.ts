import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { ROLE_OWNER } from '../../../core/auth/user-roles';
import { GameReportActionsService } from './game-report-actions.service';
import { ReportStore } from './report.store';

describe('GameReportActionsService', () => {
  const open = vi.fn();

  beforeEach(() => {
    open.mockReset();
    TestBed.configureTestingModule({
      providers: [
        GameReportActionsService,
        { provide: AuthStore, useValue: { user: signal({ id: 'current-user' }) } },
        { provide: ReportStore, useValue: { open } },
      ],
    });
  });

  it('only exposes a persisted chat message report for another non-owner player', () => {
    const service = TestBed.inject(GameReportActionsService);
    const players = [
      player('current-player', 'current-user', 'Current player', []),
      player('other-player', 'other-user', 'Other player', []),
      player('owner-player', 'owner-user', 'Owner player', [ROLE_OWNER]),
    ];

    expect(service.canReportChatMessage({ id: undefined, userId: 'other-user', displayName: 'Other player', message: 'x', createdAt: '' }, players)).toBe(false);
    expect(service.canReportChatMessage({ id: 'message-self', userId: 'current-user', displayName: 'Current player', message: 'x', createdAt: '' }, players)).toBe(false);
    expect(service.canReportChatMessage({ id: 'message-owner', userId: 'owner-user', displayName: 'Owner player', message: 'x', createdAt: '' }, players)).toBe(false);
    expect(service.canReportChatMessage({ id: 'message-other', userId: 'other-user', displayName: 'Other player', message: 'x', createdAt: '' }, players)).toBe(true);
  });

  it('opens a typed chat-message report without leaking game-table HTTP concerns', () => {
    const service = TestBed.inject(GameReportActionsService);
    const players = [player('other-player', 'other-user', 'Other player', [])];

    service.openChatMessageReport('game-1', {
      id: 'message-1',
      userId: 'other-user',
      displayName: 'Other player',
      message: 'offensive message',
      createdAt: '2026-09-29T10:00:00Z',
    }, players);

    expect(open).toHaveBeenCalledWith({
      source: 'chat_message',
      gameId: 'game-1',
      messageId: 'message-1',
      targetDisplayName: 'Other player',
    });
  });
});

function player(id: string, userId: string, displayName: string, roles: readonly string[]) {
  return {
    id,
    state: {
      user: { id: userId, displayName, roles },
    },
  };
}
