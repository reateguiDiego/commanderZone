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

  it('emits pointerdown even before the card hover is activated', async () => {
    const { fixture, cardElement } = await renderHandCard();
    const pointerDown = vi.fn();
    fixture.componentInstance.cardPointerDown.subscribe(pointerDown);

    cardElement.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
    }));

    expect(pointerDown).toHaveBeenCalledOnce();
  });

  it('applies drop feedback classes without removing existing selected state', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('selected', true);
    fixture.componentRef.setInput('dropSettling', true);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('selected');
    expect(cardElement.classList).toContain('drop-settling');
  });

  it('applies the stat drop class independently from normal drop settling', async () => {
    const { fixture, cardElement } = await renderHandCard();

    fixture.componentRef.setInput('statDropSettling', true);
    fixture.detectChanges();

    expect(cardElement.classList).toContain('stat-drop-settling');
    expect(cardElement.classList).not.toContain('drop-settling');
  });

  it('renders a planeswalker loyalty counter when loyalty is present', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('loyaltyValue', 3);
    fixture.detectChanges();

    const loyaltyCounter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement | null;
    expect(loyaltyCounter).not.toBeNull();
    expect(loyaltyCounter?.textContent?.trim()).toBe('3');
    expect(fixture.nativeElement.querySelector('.power-toughness-overlay')).toBeNull();
  });

  it('passes battlefield entry settling to the loyalty counter', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('loyaltyValue', 3);
    fixture.componentRef.setInput('statDropSettling', true);
    fixture.detectChanges();

    const loyaltyCounter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement;
    expect(loyaltyCounter.classList).toContain('entry-settling');
  });


  it('emits loyalty changes from the loyalty counter', async () => {
    const { fixture } = await renderHandCard();
    const loyaltyChanged = vi.fn();
    fixture.componentInstance.loyaltyChanged.subscribe(loyaltyChanged);

    fixture.componentRef.setInput('loyaltyValue', 3);
    fixture.detectChanges();

    const loyaltyCounter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement;
    loyaltyCounter.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    loyaltyCounter.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 2 }));

    expect(loyaltyChanged).toHaveBeenNthCalledWith(1, {
      event: expect.any(Event),
      card: fixture.componentInstance.card(),
      delta: 1,
    });
    expect(loyaltyChanged).toHaveBeenNthCalledWith(2, {
      event: expect.any(Event),
      card: fixture.componentInstance.card(),
      delta: -1,
    });
  });

  it('does not emit duplicate loyalty changes from click or contextmenu fallbacks', async () => {
    const { fixture } = await renderHandCard();
    const loyaltyChanged = vi.fn();
    fixture.componentInstance.loyaltyChanged.subscribe(loyaltyChanged);

    fixture.componentRef.setInput('loyaltyValue', 3);
    fixture.detectChanges();

    const loyaltyCounter = fixture.nativeElement.querySelector('.loyalty-counter') as HTMLElement;
    loyaltyCounter.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    loyaltyCounter.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));

    expect(loyaltyChanged).not.toHaveBeenCalled();
  });

  it('marks a power increase with the gold stat pulse', async () => {
    vi.useFakeTimers();
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('showPowerToughness', true);
    fixture.componentRef.setInput('powerValue', 2);
    fixture.componentRef.setInput('toughnessValue', 2);
    fixture.detectChanges();

    fixture.componentRef.setInput('powerValue', 3);
    fixture.detectChanges();

    const [powerElement, toughnessElement] = statElements(fixture);
    expect(powerElement.classList).toContain('stat-pulse-increase');
    expect(powerElement.classList).not.toContain('stat-pulse-decrease');
    expect(toughnessElement.classList).not.toContain('stat-pulse-increase');

    vi.advanceTimersByTime(900);
    fixture.detectChanges();

    expect(powerElement.classList).not.toContain('stat-pulse-increase');
  });

  it('keeps the stat pulse alive while repeated changes keep arriving', async () => {
    vi.useFakeTimers();
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('showPowerToughness', true);
    fixture.componentRef.setInput('powerValue', 2);
    fixture.componentRef.setInput('toughnessValue', 2);
    fixture.detectChanges();

    fixture.componentRef.setInput('powerValue', 3);
    fixture.detectChanges();
    vi.advanceTimersByTime(300);
    fixture.componentRef.setInput('powerValue', 4);
    fixture.detectChanges();
    vi.advanceTimersByTime(899);
    fixture.detectChanges();

    const [powerElement] = statElements(fixture);
    expect(powerElement.classList).toContain('stat-pulse-increase');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(powerElement.classList).not.toContain('stat-pulse-increase');
  });

  it('marks a toughness decrease with the red stat pulse', async () => {
    const { fixture } = await renderHandCard();

    fixture.componentRef.setInput('showPowerToughness', true);
    fixture.componentRef.setInput('powerValue', 2);
    fixture.componentRef.setInput('toughnessValue', 3);
    fixture.detectChanges();

    fixture.componentRef.setInput('toughnessValue', 2);
    fixture.detectChanges();

    const [_powerElement, toughnessElement] = statElements(fixture);
    expect(toughnessElement.classList).toContain('stat-pulse-decrease');
    expect(toughnessElement.classList).not.toContain('stat-pulse-increase');
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

function statElements(fixture: ComponentFixture<GameCardViewComponent>): [HTMLElement, HTMLElement] {
  const elements = Array.from(fixture.nativeElement.querySelectorAll('.power-toughness-overlay span')) as HTMLElement[];
  expect(elements.length).toBe(2);

  return [elements[0]!, elements[1]!];
}
