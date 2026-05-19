import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { CardSpoilerGridComponent } from './card-spoiler-grid.component';

describe('CardSpoilerGridComponent', () => {
  it('renders card spoilers and emits card interactions', async () => {
    await TestBed.configureTestingModule({
      imports: [CardSpoilerGridComponent],
    }).compileComponents();
    const fixture = createFixture();
    const selected = vi.fn();
    const doubleClicked = vi.fn();
    const menuOpened = vi.fn();
    fixture.componentInstance.cardSelected.subscribe(selected);
    fixture.componentInstance.cardDoubleClicked.subscribe(doubleClicked);
    fixture.componentInstance.cardMenuOpened.subscribe(menuOpened);
    fixture.detectChanges();

    const cardButton = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLButtonElement;
    cardButton.click();
    cardButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    cardButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(cardButton.classList).toContain('active');
    expect(cardButton.querySelector('img')?.getAttribute('src')).toBe('/card.jpg');
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'card-1' }));
    expect(doubleClicked).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'card-1' }));
    expect(menuOpened).toHaveBeenCalledWith(expect.objectContaining({
      card: expect.objectContaining({ instanceId: 'card-1' }),
    }));
  });

  it('renders draw labels and emits a reordered card list', async () => {
    await TestBed.configureTestingModule({
      imports: [CardSpoilerGridComponent],
    }).compileComponents();
    const fixture = createFixture([
      card('card-1', 'Top Card'),
      card('card-2', 'Second Card'),
    ]);
    fixture.componentRef.setInput('allowReorder', true);
    fixture.componentRef.setInput('orderLabels', ['Proximo robo', 'Segundo robo']);
    const reordered = vi.fn();
    fixture.componentInstance.cardsReordered.subscribe(reordered);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-card-instance-id]');
    expect(buttons[0]?.querySelector('.draw-order-label')?.textContent?.trim()).toBe('Proximo robo');

    fixture.componentInstance.dragStart(dragEvent(), card('card-1', 'Top Card'));
    fixture.componentInstance.dropCard(dragEvent(), card('card-2', 'Second Card'));

    expect(reordered).toHaveBeenCalledWith([
      expect.objectContaining({ instanceId: 'card-2' }),
      expect.objectContaining({ instanceId: 'card-1' }),
    ]);
  });
});

function createFixture(cards: GameCardInstance[] = [card('card-1', 'Arcane Signet')]): ComponentFixture<CardSpoilerGridComponent> {
  const fixture = TestBed.createComponent(CardSpoilerGridComponent);
  fixture.componentRef.setInput('cards', cards);
  fixture.componentRef.setInput('selectedCardId', 'card-1');
  fixture.componentRef.setInput('loading', false);
  fixture.componentRef.setInput('cardImage', () => '/card.jpg');

  return fixture;
}

function card(instanceId: string, name: string): GameCardInstance {
  return {
    instanceId,
    name,
    tapped: false,
  };
}

function dragEvent(): DragEvent {
  return {
    preventDefault: vi.fn(),
    currentTarget: document.createElement('button'),
    dataTransfer: {
      setData: vi.fn(),
      setDragImage: vi.fn(),
    },
  } as unknown as DragEvent;
}
