import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatMessage } from '../../../../../core/models/game.model';
import { GameActivityTimelineItem } from '../../utils/game-activity-timeline';
import { GameActivityPanelComponent } from './game-activity-panel.component';

type ChatActivityTimelineItem = Extract<GameActivityTimelineItem, { readonly kind: 'chat' }>;

describe('GameActivityPanelComponent', () => {
  let fixture: ComponentFixture<GameActivityPanelComponent>;
  let activity: ChatActivityTimelineItem;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [GameActivityPanelComponent] });
    fixture = TestBed.createComponent(GameActivityPanelComponent);
    activity = chatActivity();
    fixture.componentRef.setInput('items', [activity]);
    fixture.componentRef.setInput('highlightedLogEntryIds', []);
    fixture.componentRef.setInput('fadingLogEntryIds', []);
    fixture.componentRef.setInput('isChatMessageHighlighted', () => false);
    fixture.componentRef.setInput('isChatMessageEvaporating', () => false);
    fixture.componentRef.setInput('playerColor', () => 'var(--cz-primary)');
    fixture.componentRef.setInput('logTime', () => '12:00');
    fixture.componentRef.setInput('canReactToChatMessage', () => true);
    fixture.componentRef.setInput('reactionOptions', [
      { type: 'like', label: 'game.reactions.like', emoji: '👍' },
    ]);
    fixture.componentRef.setInput('hasOwnChatReaction', () => false);
    fixture.componentRef.setInput('chatReactionCount', () => 1);
    fixture.componentRef.setInput('chatReactionUsers', () => 'Player Three');
    fixture.componentRef.setInput('hasAnyChatReaction', () => true);
    fixture.componentRef.setInput('shouldShowChatReactionUsers', () => true);
  });

  it('renders and emits reactions for chat entries without adding controls to log entries', () => {
    const emitted = [] as Array<{ readonly message: ChatMessage; readonly reaction: string }>;
    fixture.componentInstance.reactionToggled.subscribe((value) => {
      emitted.push(value);
    });
    fixture.detectChanges();

    const activityFeed = fixture.nativeElement.querySelector(
      '[data-testid="game-activity-feed"]',
    ) as HTMLElement;
    expect(activityFeed.querySelector('app-game-chat-message')).not.toBeNull();

    const chatMessage = activityFeed.querySelector('[data-testid="chat-message"]') as HTMLElement;
    chatMessage.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(chatMessage.querySelectorAll('[data-testid="chat-reaction"]')).toHaveLength(1);
    expect(chatMessage.querySelector('.chat-reaction-summary')?.textContent).toContain('1');
    (chatMessage.querySelector('.chat-reaction-pill') as HTMLElement).dispatchEvent(
      new MouseEvent('mouseenter'),
    );
    fixture.detectChanges();
    expect(chatMessage.querySelector('.chat-reaction-users')?.textContent).toContain('Player Three');
    (chatMessage.querySelector('.chat-reaction-pill') as HTMLElement).dispatchEvent(
      new MouseEvent('mouseleave'),
    );
    fixture.detectChanges();

    (chatMessage.querySelector('[data-testid="chat-reaction"]') as HTMLButtonElement).click();

    expect(emitted[0]?.message).toBe(activity.message);
    expect(emitted[0]?.reaction).toBe('like');
  });
});

function chatActivity(): ChatActivityTimelineItem {
  return {
    id: 'chat-1',
    kind: 'chat',
    createdAt: '2026-09-09T12:00:00Z',
    sourceIndex: 0,
    message: {
      id: 'chat-1',
      userId: 'player-2',
      displayName: 'Opponent',
      message: 'React to me',
      createdAt: '2026-09-09T12:00:00Z',
    },
  };
}
