import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatMessage } from '../../../../../core/models/game.model';
import {
  GameChatMessageComponent,
  GameChatReactionToggle,
} from './game-chat-message.component';

describe('GameChatMessageComponent', () => {
  let fixture: ComponentFixture<GameChatMessageComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [GameChatMessageComponent] });
    fixture = TestBed.createComponent(GameChatMessageComponent);
    fixture.componentRef.setInput('activityEntryId', 'activity-chat-1');
    fixture.componentRef.setInput('isHighlighted', false);
    fixture.componentRef.setInput('isEvaporating', false);
    fixture.componentRef.setInput('playerColor', (playerId: string | null | undefined) =>
      playerId === 'target-player' ? 'var(--cz-secondary)' : 'var(--cz-primary)',
    );
    fixture.componentRef.setInput('logTime', () => '12:00');
    fixture.componentRef.setInput('canReact', () => true);
    fixture.componentRef.setInput('reactionOptions', [
      { type: 'like', label: 'game.reactions.like', emoji: '👍' },
    ]);
    fixture.componentRef.setInput('hasOwnReaction', () => false);
    fixture.componentRef.setInput('reactionCount', () => 0);
    fixture.componentRef.setInput('reactionUsers', () => '');
    fixture.componentRef.setInput('hasAnyReaction', () => false);
    fixture.componentRef.setInput('shouldShowReactionUsers', () => false);
  });

  it('keeps the connector uncoloured and colours both usernames independently', () => {
    fixture.componentRef.setInput('message', chatMessage());
    fixture.detectChanges();

    const entry = fixture.nativeElement.querySelector('[data-testid="chat-message"]') as HTMLElement;
    const prefix = entry.querySelector('.chat-message-target-prefix') as HTMLElement;
    const author = entry.querySelector('.chat-author-name') as HTMLElement;
    const target = entry.querySelector('.chat-target-name') as HTMLElement;

    expect(entry.dataset['activityEntryId']).toBe('activity-chat-1');
    expect(prefix.textContent?.trim()).toBe('to');
    expect(prefix.style.color).toBe('');
    expect(entry.querySelector('.chat-message-target-gap')).not.toBeNull();
    expect(author.style.getPropertyValue('--chat-author-color')).toBe('var(--cz-primary)');
    expect(target.style.getPropertyValue('--chat-target-color')).toBe('var(--cz-secondary)');
  });

  it('dismisses the reaction overlay until the pointer enters the message again', () => {
    const message = chatMessage();
    const emitted: GameChatReactionToggle[] = [];
    fixture.componentRef.setInput('message', message);
    fixture.componentInstance.reactionToggled.subscribe((value) => {
      emitted.push(value);
    });
    fixture.detectChanges();

    const entry = fixture.nativeElement.querySelector('[data-testid="chat-message"]') as HTMLElement;
    entry.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="chat-reaction"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(emitted[0]?.message).toBe(message);
    expect(emitted[0]?.reaction).toBe('like');
    expect(entry.classList).toContain('reaction-overlay-dismissed');

    entry.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(entry.classList).not.toContain('reaction-overlay-dismissed');
    expect(entry.querySelector('.chat-reaction-overlay')).not.toBeNull();
  });

  it('renders the users tooltip as a fixed overlay while hovering a reaction count', () => {
    fixture.componentRef.setInput('message', chatMessage());
    fixture.componentRef.setInput('reactionCount', () => 1);
    fixture.componentRef.setInput('reactionUsers', () => 'Player Three');
    fixture.componentRef.setInput('hasAnyReaction', () => true);
    fixture.componentRef.setInput('shouldShowReactionUsers', () => true);
    fixture.detectChanges();

    const entry = fixture.nativeElement.querySelector('[data-testid="chat-message"]') as HTMLElement;
    const reactionPill = entry.querySelector('.chat-reaction-pill') as HTMLElement;
    reactionPill.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(entry.querySelector('.chat-reaction-overlay')).toBeNull();
    expect(entry.querySelector('.chat-reaction-users')?.textContent).toContain('Player Three');

    reactionPill.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(entry.querySelector('.chat-reaction-overlay')).not.toBeNull();
    expect(entry.querySelector('.chat-reaction-users')).toBeNull();
  });
});

function chatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'chat-1',
    userId: 'author-player',
    displayName: 'Author',
    targetPlayerId: 'target-player',
    targetDisplayName: 'Recipient',
    message: 'Hello',
    createdAt: '2026-09-09T12:00:00Z',
    ...overrides,
  };
}
