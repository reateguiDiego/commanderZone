import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Ban, Library, LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../core/models/game.model';
import { OpponentMiniBoardComponent } from './opponent-mini-board.component';
import { PlayerView } from '../game-table.store';

describe('OpponentMiniBoardComponent', () => {
  let fixture: ComponentFixture<OpponentMiniBoardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpponentMiniBoardComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Ban, Library })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OpponentMiniBoardComponent);
    fixture.componentRef.setInput('player', playerView());
    fixture.componentRef.setInput('colorAccent', () => '#d7b46a');
    fixture.componentRef.setInput('deckLabel', (player: PlayerView | null) => player?.state.user.displayName ?? '');
    fixture.componentRef.setInput('backgroundImage', () => '/assets/images/backgrounds/back_5.png');
    fixture.componentRef.setInput('battlefieldSize', { width: 900, height: 520 });
    fixture.componentRef.setInput('zoneCount', (player: PlayerView, zone: keyof PlayerView['state']['zones']) => player.state.zones[zone].length);
    fixture.componentRef.setInput('cardPosition', () => ({ x: 0, y: 0 }));
    fixture.componentRef.setInput('cardImage', () => null);
    fixture.componentRef.setInput('isPlayerDropHighlighted', () => false);
  });

  it('renders the targeting pill between player label and life', () => {
    fixture.componentRef.setInput('targetingPill', {
      direction: 'incoming',
      text: 'Objetivo de Opponent',
      title: 'Una de tus cartas es objetivo de Opponent.',
    });
    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('.player-thumb-header') as HTMLElement;
    const children = Array.from(header.children).map((child) => (child as HTMLElement).dataset['testid'] ?? child.className);
    const pill = fixture.nativeElement.querySelector('[data-testid="opponent-targeting-pill"]') as HTMLElement;

    expect(children).toEqual(['opponent-deck-name', 'opponent-targeting-pill', 'opponent-life']);
    expect(pill.textContent?.trim()).toBe('Objetivo de Opponent');
    expect(pill.classList.contains('opponent-targeting-pill-incoming')).toBe(true);
  });

  it('renders the mini battlefield when no cards target cards are present', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-opponent-cards-target')).toBeNull();
  });

  it('replaces the mini battlefield with cards target when arrows involve this player', () => {
    fixture.componentRef.setInput('cardsTargetCards', [{ card: cardInstance('card-1', 'Target'), role: 'target' }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-opponent-cards-target')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="opponent-cards-target-card"]').length).toBe(1);
  });
});

function playerView(): PlayerView {
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
