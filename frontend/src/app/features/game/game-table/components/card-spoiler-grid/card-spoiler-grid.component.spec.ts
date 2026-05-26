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

  it('renders draw labels, shows drag feedback and emits a swapped card list', async () => {
    await TestBed.configureTestingModule({
      imports: [CardSpoilerGridComponent],
    }).compileComponents();
    const fixture = createFixture([
      card('card-1', 'Top Card'),
      card('card-2', 'Second Card'),
      card('card-3', 'Third Card'),
    ]);
    fixture.componentRef.setInput('allowReorder', true);
    fixture.componentRef.setInput('orderLabels', ['PROXIMO ROBO', 'SEGUNDO ROBO', 'TERCER ROBO']);
    const reordered = vi.fn();
    fixture.componentInstance.cardsReordered.subscribe(reordered);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-card-instance-id]');
    expect(buttons[0]?.querySelector('.draw-order-label')?.textContent?.trim()).toBe('PROXIMO ROBO');

    const firstButton = buttons[0] as HTMLButtonElement;
    const thirdButton = buttons[2] as HTMLButtonElement;
    setCardRect(firstButton);
    setCardRect(thirdButton);

    firstButton.dispatchEvent(new MouseEvent('dragstart', { bubbles: true, clientX: 16 }));
    fixture.detectChanges();
    const draggingButton = host.querySelector<HTMLButtonElement>('[data-card-instance-id="card-1"]');
    expect(draggingButton?.classList).toContain('dragging');
    expect(draggingButton?.querySelector('.zone-art')?.classList).toContain('empty');
    expect(draggingButton?.querySelector('.draw-order-label')?.textContent?.trim()).toBe('PROXIMO ROBO');

    thirdButton.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 84 }));
    fixture.detectChanges();
    const dropTargetButton = host.querySelector<HTMLButtonElement>('[data-card-instance-id="card-3"]');
    expect(dropTargetButton?.classList).toContain('drop-target');
    expect(dropTargetButton?.classList).not.toContain('drop-after');
    expect(dropTargetButton?.classList).not.toContain('drop-before');

    thirdButton.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 84 }));

    expect(reordered).toHaveBeenCalledWith([
      expect.objectContaining({ instanceId: 'card-3' }),
      expect.objectContaining({ instanceId: 'card-2' }),
      expect.objectContaining({ instanceId: 'card-1' }),
    ]);
  });

  it('renders fixed empty reorder slots without making them drop targets', async () => {
    await TestBed.configureTestingModule({
      imports: [CardSpoilerGridComponent],
    }).compileComponents();
    const fixture = createFixture([
      card('card-1', 'Top Card'),
      card('card-2', 'Second Card'),
    ]);
    fixture.componentRef.setInput('allowReorder', true);
    fixture.componentRef.setInput('orderLabels', ['PROXIMO ROBO', 'SEGUNDO ROBO', 'TERCER ROBO']);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const slots = host.querySelectorAll<HTMLElement>('.card-spoiler');
    const cardButtons = host.querySelectorAll<HTMLButtonElement>('[data-card-instance-id]');
    const emptySlot = host.querySelector<HTMLElement>('.empty-slot');

    expect(slots.length).toBe(3);
    expect(cardButtons.length).toBe(2);
    expect(emptySlot?.querySelector('.draw-order-label')?.textContent?.trim()).toBe('TERCER ROBO');
    expect(emptySlot?.querySelector('.zone-art')?.classList).toContain('empty');
    expect(emptySlot?.getAttribute('draggable')).toBeNull();
  });

  it('does not emit selection when left-click selection is disabled', async () => {
    await TestBed.configureTestingModule({
      imports: [CardSpoilerGridComponent],
    }).compileComponents();
    const fixture = createFixture();
    fixture.componentRef.setInput('allowSelection', false);
    const selected = vi.fn();
    const menuOpened = vi.fn();
    fixture.componentInstance.cardSelected.subscribe(selected);
    fixture.componentInstance.cardMenuOpened.subscribe(menuOpened);
    fixture.detectChanges();

    const cardButton = fixture.nativeElement.querySelector('[data-card-instance-id="card-1"]') as HTMLButtonElement;
    cardButton.click();
    cardButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(selected).not.toHaveBeenCalled();
    expect(menuOpened).toHaveBeenCalledWith(expect.objectContaining({
      card: expect.objectContaining({ instanceId: 'card-1' }),
    }));
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

function setCardRect(currentTarget: HTMLElement): void {
  currentTarget.getBoundingClientRect = () => ({
    bottom: 140,
    height: 140,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}
