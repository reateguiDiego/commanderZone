import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance } from '../../../../core/models/game.model';
import { GameCardViewComponent } from './game-card-view.component';

describe('GameCardViewComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits before lifting a hovered hand card', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    vi.advanceTimersByTime(99);
    fixture.detectChanges();

    expect(cardElement.classList.contains('hover-lifted')).toBe(false);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(cardElement.classList.contains('hover-lifted')).toBe(true);
  });

  it('cancels hand card lifting when hover ends first', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard();

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(50);
    cardElement.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(50);
    fixture.detectChanges();

    expect(cardElement.classList.contains('hover-lifted')).toBe(false);
  });

  it('blocks hand card hover interactions until the hand is revealed', async () => {
    vi.useFakeTimers();
    const { fixture, cardElement } = await renderHandCard(false);
    const previewShown = vi.fn();
    fixture.componentInstance.cardMouseEntered.subscribe(previewShown);

    cardElement.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(100);
    fixture.detectChanges();

    expect(previewShown).not.toHaveBeenCalled();
    expect(cardElement.classList.contains('hover-lifted')).toBe(false);

    fixture.componentRef.setInput('hoverInteractionsEnabled', true);
    fixture.detectChanges();
    vi.advanceTimersByTime(99);
    fixture.detectChanges();

    expect(previewShown).toHaveBeenCalledOnce();
    expect(cardElement.classList.contains('hover-lifted')).toBe(false);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(cardElement.classList.contains('hover-lifted')).toBe(true);
  });

  it('emits pointerdown so containers can start their card drag flow', async () => {
    const { fixture, cardElement } = await renderHandCard();
    const pointerDown = vi.fn();
    fixture.componentInstance.cardPointerDown.subscribe(pointerDown);

    cardElement.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
    }));

    expect(pointerDown).toHaveBeenCalledWith({
      event: expect.any(PointerEvent),
      card: fixture.componentInstance.card(),
    });
  });
});

async function renderHandCard(
  hoverInteractionsEnabled = true,
): Promise<{ fixture: ComponentFixture<GameCardViewComponent>; cardElement: HTMLButtonElement }> {
  await TestBed.configureTestingModule({
    imports: [GameCardViewComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(GameCardViewComponent);
  fixture.componentRef.setInput('mode', 'hand');
  fixture.componentRef.setInput('card', gameCard());
  fixture.componentRef.setInput('playerId', 'player-1');
  fixture.componentRef.setInput('zone', 'hand');
  fixture.componentRef.setInput('hoverInteractionsEnabled', hoverInteractionsEnabled);
  fixture.detectChanges();

  return {
    fixture,
    cardElement: fixture.nativeElement.querySelector('[data-testid="game-card"]'),
  };
}

function gameCard(): GameCardInstance {
  return {
    instanceId: 'card-1',
    name: 'Arcane Signet',
    tapped: false,
  };
}
