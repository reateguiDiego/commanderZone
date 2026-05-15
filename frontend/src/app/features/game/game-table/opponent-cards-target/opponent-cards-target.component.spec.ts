import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance } from '../../../../core/models/game.model';
import { OpponentCardsTargetComponent } from './opponent-cards-target.component';

describe('OpponentCardsTargetComponent', () => {
  let fixture: ComponentFixture<OpponentCardsTargetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpponentCardsTargetComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OpponentCardsTargetComponent);
    fixture.componentRef.setInput('playerId', 'user-2');
    fixture.componentRef.setInput('battlefieldSize', { width: 900, height: 520 });
    fixture.componentRef.setInput('cardPosition', () => ({ x: 450, y: 260 }));
    fixture.componentRef.setInput('cardImage', () => null);
  });

  it('renders target cards with cards-target anchors and keeps mini-battlefield fallbacks', () => {
    fixture.componentRef.setInput('cards', [
      { card: cardInstance('card-1', 'Source'), role: 'source' },
      { card: cardInstance('card-2', 'Target'), role: 'target' },
    ]);
    fixture.detectChanges();

    const cards = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="opponent-cards-target-card"]')) as HTMLElement[];
    const anchors = Array.from(fixture.nativeElement.querySelectorAll('.cards-target-arrow-anchor')) as HTMLElement[];
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.cards-target-role') as NodeListOf<HTMLElement>).map((label) =>
      label.textContent?.trim(),
    );

    expect(cards.length).toBe(2);
    expect(cards[0]?.dataset['arrowCardPlayerId']).toBe('user-2');
    expect(cards[0]?.dataset['arrowCardInstanceId']).toBe('card-1');
    expect(cards[0]?.dataset['arrowCardSurface']).toBe('cards-target');
    expect(anchors.length).toBe(2);
    expect(anchors[0]?.dataset['arrowCardPlayerId']).toBe('user-2');
    expect(anchors[0]?.dataset['arrowCardInstanceId']).toBe('card-1');
    expect(anchors[0]?.dataset['arrowCardSurface']).toBe('mini-battlefield');
    expect(labels).toEqual(['Origen', 'Objetivo']);
  });

  it('emits card clicks for battlefield targeting', () => {
    const card = cardInstance('card-1', 'Target');
    const emitted: { playerId: string; card: GameCardInstance }[] = [];
    fixture.componentRef.setInput('cards', [{ card, role: 'both' }]);
    fixture.componentInstance.battlefieldCardClicked.subscribe((event) => emitted.push({ playerId: event.playerId, card: event.card }));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="opponent-cards-target-card"]') as HTMLElement).click();

    expect(emitted).toEqual([{ playerId: 'user-2', card }]);
  });
});

function cardInstance(instanceId: string, name: string): GameCardInstance {
  return {
    instanceId,
    ownerId: 'user-2',
    controllerId: 'user-2',
    scryfallId: instanceId,
    name,
    imageUris: {},
    cardFaces: [],
    typeLine: 'Creature',
    manaCost: null,
    oracleText: '',
    colorIdentity: [],
    power: null,
    toughness: null,
    loyalty: null,
    defaultPower: null,
    defaultToughness: null,
    defaultLoyalty: null,
    tapped: false,
    faceDown: false,
    revealedTo: [],
    position: { x: 0, y: 0 },
    rotation: 0,
    counters: {},
    zone: 'battlefield',
    isToken: false,
    isCommander: false,
  };
}
