import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TabListComponent } from './tab-list.component';

describe('TabListComponent', () => {
  let fixture: ComponentFixture<TabListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabListComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TabListComponent);
    fixture.componentRef.setInput('items', [
      { id: 'general', label: 'General' },
      { id: 'game', label: 'Game', disabled: true },
    ]);
    fixture.componentRef.setInput('activeId', 'general');
  });

  it('renders tabs with the active state and tab semantics', () => {
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll(
      '.tab-list-button',
    ) as NodeListOf<HTMLButtonElement>;

    expect(fixture.nativeElement.querySelector('[role="tablist"]')).not.toBeNull();
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('aria-selected')).toBe('true');
    expect(buttons[1].getAttribute('aria-selected')).toBe('false');
  });

  it('emits selected tab ids and ignores disabled tabs', () => {
    const selectedSpy = vi.fn();
    fixture.componentInstance.tabSelected.subscribe(selectedSpy);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll(
      '.tab-list-button',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[0].click();
    buttons[1].click();

    expect(selectedSpy).toHaveBeenCalledTimes(1);
    expect(selectedSpy).toHaveBeenCalledWith('general');
  });

  it('projects optional test ids and item state classes', () => {
    fixture.componentRef.setInput('items', [
      { id: 'log', label: 'Log', testId: 'game-log-open' },
      {
        id: 'chat',
        label: 'Chat',
        testId: 'chat-open',
        classNames: ['has-unread'],
        attention: true,
      },
    ]);
    fixture.componentRef.setInput('activeId', 'chat');
    fixture.detectChanges();

    const chatButton = fixture.nativeElement.querySelector(
      '[data-testid="chat-open"]',
    ) as HTMLButtonElement;

    expect(fixture.nativeElement.querySelector('[data-testid="game-log-open"]')).not.toBeNull();
    expect(chatButton.classList).toContain('has-unread');
    expect(chatButton.classList).toContain('attention');
  });
});
