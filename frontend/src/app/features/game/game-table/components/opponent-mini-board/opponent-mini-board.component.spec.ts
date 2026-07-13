import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Ban, Circle, Crown, Flag, Library, LucideAngularModule, Sparkles } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { OpponentMiniBoardComponent } from './opponent-mini-board.component';
import { PlayerView } from '../../game-table.store';

describe('OpponentMiniBoardComponent', () => {
  let fixture: ComponentFixture<OpponentMiniBoardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpponentMiniBoardComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Ban, Circle, Crown, Flag, Library, Sparkles })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OpponentMiniBoardComponent);
    fixture.componentRef.setInput('player', playerView());
    fixture.componentRef.setInput('colorAccent', () => '#d7b46a');
    fixture.componentRef.setInput('deckLabel', (player: PlayerView | null) => player?.state.user.displayName ?? '');
    fixture.componentRef.setInput('backgroundImage', () => '/assets/images/backgrounds/sunrise/bg-5.webp');
    fixture.componentRef.setInput('battlefieldSize', { width: 900, height: 520 });
    fixture.componentRef.setInput('zoneCount', (player: PlayerView, zone: keyof PlayerView['state']['zones']) => player.state.zones[zone].length);
    fixture.componentRef.setInput('cardPosition', () => ({ x: 0, y: 0 }));
    fixture.componentRef.setInput('cardImage', () => null);
    fixture.componentRef.setInput('isPlayerDropHighlighted', () => false);
  });

  it('does not render the mechanics strip when no mechanics are active', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="special-entity-strip"]')).toBeNull();
  });

  it('renders the mini battlefield when no cards target cards are present', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-opponent-cards-target')).toBeNull();
  });

  it('passes mechanic cards to the mini battlefield overlay', () => {
    fixture.componentRef.setInput('mechanicCards', [cardInstance('monarch-card', 'The Monarch')]);
    fixture.detectChanges();

    const miniBattlefield = fixture.nativeElement.querySelector('app-opponent-mini-battlefield') as HTMLElement;

    expect(miniBattlefield.querySelector('[data-testid="battlefield-mechanics-overlay"]')).not.toBeNull();
    expect(miniBattlefield.querySelector('[data-testid="battlefield-mechanics-mini-card"][data-card-instance-id="monarch-card"]')).not.toBeNull();
  });

  it('replaces the mini battlefield with a defeated board when opponent life is zero or lower', () => {
		fixture.componentRef.setInput('player', playerView({ life: 0, status: 'defeated' }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="opponent-defeated-board"]')).not.toBeNull();
  });

  it('replaces the mini battlefield with a defeated board when opponent has lethal commander damage', () => {
		fixture.componentRef.setInput('player', playerView({ commanderDamage: { 'user-1': 21 }, status: 'defeated' }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="opponent-defeated-board"]')).not.toBeNull();
  });

  it('keeps the defeated board instead of cards target when opponent life is zero or lower', () => {
		fixture.componentRef.setInput('player', playerView({ life: -3, status: 'defeated' }));
    fixture.componentRef.setInput('cardsTargetCards', [{ card: cardInstance('card-1', 'Target'), role: 'target' }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-opponent-cards-target')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="opponent-defeated-board"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="opponent-mini-battlefield-skull"]')).not.toBeNull();
  });

  it('replaces the mini battlefield with cards target when arrows involve this player', () => {
    fixture.componentRef.setInput('cardsTargetCards', [{ card: cardInstance('card-1', 'Target'), role: 'target' }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-opponent-cards-target')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="opponent-cards-target-card"]').length).toBe(1);
  });
});

function playerView(overrides: Partial<PlayerView['state']> = {}): PlayerView {
  return {
    id: 'user-2',
    state: {
      user: { id: 'user-2', email: 'opponent@test', displayName: 'Opponent', roles: [] },
      status: 'active',
      life: 39,
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
      commanderDamage: {},
      counters: {},
      ...overrides,
    },
  };
}
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
