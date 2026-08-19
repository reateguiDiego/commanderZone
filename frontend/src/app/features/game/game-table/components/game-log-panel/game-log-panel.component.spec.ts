import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GameLogEntryView } from '../../state/chat/game-table-chat-log.state';
import { GameLogPanelComponent } from './game-log-panel.component';

describe('GameLogPanelComponent', () => {
  let fixture: ComponentFixture<GameLogPanelComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [GameLogPanelComponent] });
    fixture = TestBed.createComponent(GameLogPanelComponent);
    fixture.componentRef.setInput('highlightedEntryIds', []);
    fixture.componentRef.setInput('fadingEntryIds', []);
    fixture.componentRef.setInput('logTime', () => '12:00');
    fixture.componentRef.setInput('playerColor', (playerId: string) => playerId === 'player-1' ? '#123456' : '');
  });

  it('renders the semantic subject separately from its fragment', () => {
    fixture.componentRef.setInput('entries', [entry({
      subject: { playerId: 'player-1', displayName: 'Alice' },
      messagePrefix: 'changed Bruno\'s life from 40 to 37.',
    })]);
    fixture.detectChanges();

    const logEntry = fixture.nativeElement.querySelector('[data-testid="game-log-entry"]') as HTMLElement;

    expect(logEntry.classList).toContain('with-subject');
    expect(logEntry.querySelector('strong')?.textContent).toBe('Alice');
    expect(logEntry.querySelector('strong')?.style.getPropertyValue('--log-author-color')).toBe('#123456');
    expect(logEntry.querySelector(':scope > span')?.textContent).toContain("changed Bruno's life from 40 to 37.");
  });

  it('does not reserve a subject column for a legacy full message', () => {
    fixture.componentRef.setInput('entries', [entry({
      subject: null,
      messagePrefix: 'Legacy draw message.',
    })]);
    fixture.detectChanges();

    const logEntry = fixture.nativeElement.querySelector('[data-testid="game-log-entry"]') as HTMLElement;

    expect(logEntry.classList).not.toContain('with-subject');
    expect(logEntry.querySelector('strong')).toBeNull();
    expect(logEntry.textContent).toContain('Legacy draw message.');
  });
});

function entry(overrides: Partial<GameLogEntryView>): GameLogEntryView {
  return {
    id: 'entry-1',
    type: 'life.changed',
    message: '',
    createdAt: '2026-08-19T12:00:00Z',
    actorId: 'player-1',
    displayName: 'Alice',
    subject: { playerId: 'player-1', displayName: 'Alice' },
    card: null,
    cardList: [],
    cardListPrefix: '',
    cardListSuffix: '',
    cardListLabel: '',
    messagePrefix: '',
    messageSuffix: '',
    appearance: 'default',
    ...overrides,
  };
}
