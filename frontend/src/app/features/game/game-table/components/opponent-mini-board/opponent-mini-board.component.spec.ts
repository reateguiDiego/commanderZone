import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Ban, Circle, Crown, Flag, Library, LucideAngularModule, Sparkles } from 'lucide-angular';
import { GameCardInstance, GameSpecialEntity } from '../../../../../core/models/game.model';
import { OpponentMiniBoardComponent } from './opponent-mini-board.component';
import { PlayerView } from '../../game-table.store';
import { GameTablePlayerSpecialEntitiesSummary } from '../../state/helpers/game-table-special-entities.state';

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

  it('shows active mechanics pills without the legacy mechanics button', () => {
    const monarch = helperEntity('monarch', 'user-2');
    const ring = helperEntity('the_ring', 'user-2', { level: 2 });
    const emblem = helperEntity('emblem', 'user-2');
    fixture.componentRef.setInput('specialEntitiesSummary', {
      playerId: 'user-2',
      monarch,
      initiative: null,
      citysBlessing: null,
      ring,
      dungeon: null,
      emblems: [emblem],
      displayEntities: [monarch, ring, emblem],
      hasAny: true,
    } satisfies GameTablePlayerSpecialEntitiesSummary);
    fixture.detectChanges();

    const strip = fixture.nativeElement.querySelector('[data-testid="special-entity-strip"]') as HTMLElement;

    expect(fixture.nativeElement.querySelector('[data-testid="opponent-mechanics-button"]')).toBeNull();
    expect(strip).not.toBeNull();
    expect(strip.dataset['variant']).toBe('compact');
    expect(strip.textContent).toContain('Monarch');
    expect(strip.textContent).toContain('The Ring');
    expect(strip.textContent).toContain('Emblem');
    expect(strip.querySelector('[aria-label="Monarch"]')).not.toBeNull();
    expect(strip.querySelector('[aria-label="The Ring - Level 2"]')).not.toBeNull();
    expect(strip.querySelector('[aria-label="Emblem"]')).not.toBeNull();
    expect(strip.querySelector('.ms-ability-role-royal')).not.toBeNull();
    expect(strip.querySelector('.ms-ability-the-ring-tempts-you')).not.toBeNull();
    expect(strip.querySelector('.ms-planeswalker')).not.toBeNull();
  });

  it('does not render the mechanics strip when no mechanics are active', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="special-entity-strip"]')).toBeNull();
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

    expect(children).toEqual(['opponent-deck-name', 'opponent-targeting-pill', 'opponent-life-group']);
    expect(pill.textContent?.trim()).toBe('Objetivo de Opponent');
    expect(pill.classList.contains('opponent-targeting-pill-incoming')).toBe(true);
  });

  it('marks the active turn opponent with a turn pill', () => {
    fixture.componentRef.setInput('isActiveTurnPlayer', true);
    fixture.detectChanges();

    const thumb = fixture.nativeElement.querySelector('[data-testid="opponent-mini-board"]') as HTMLElement;
    const turnPill = fixture.nativeElement.querySelector('[data-testid="opponent-turn-pill"]') as HTMLElement;

    expect(thumb.classList.contains('active-turn-player')).toBe(true);
    expect(turnPill.textContent?.trim()).toBe('Turno');
    expect(fixture.nativeElement.querySelector('[data-testid="opponent-life"]')?.textContent.trim()).toBe('39');
  });

  it('uses the player color identity as the thumb gradient', () => {
    fixture.componentRef.setInput('player', playerView({ colorIdentity: ['U', 'B', 'R'] }));
    fixture.detectChanges();

    const thumb = fixture.nativeElement.querySelector('[data-testid="opponent-mini-board"]') as HTMLElement;
    const gradient = thumb.style.getPropertyValue('--player-identity-gradient');

    expect(gradient).toContain('#36b8ff 0%');
    expect(gradient).toContain('#36b8ff 26.333%');
    expect(gradient).toContain('#000000 40.333%');
    expect(gradient).toContain('#000000 59.667%');
    expect(gradient).toContain('#ff5b36 73.667%');
    expect(gradient).toContain('#ff5b36 100%');
    expect(thumb.style.getPropertyValue('--player-identity-primary')).toBe('#36b8ff');
    expect(thumb.style.getPropertyValue('--player-identity-secondary')).toBe('#ff5b36');
  });

  it('gives each multicolor identity the same gradient presence', () => {
    fixture.componentRef.setInput('player', playerView({ colorIdentity: ['B', 'G'] }));
    fixture.detectChanges();

    const thumb = fixture.nativeElement.querySelector('[data-testid="opponent-mini-board"]') as HTMLElement;
    const gradient = thumb.style.getPropertyValue('--player-identity-gradient');

    expect(gradient).toContain('#000000 0%');
    expect(gradient).toContain('#000000 43%');
    expect(gradient).toContain('#4fd36b 57%');
    expect(gradient).toContain('#4fd36b 100%');
  });

  it('renders the mini battlefield when no cards target cards are present', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-opponent-cards-target')).toBeNull();
  });

  it('replaces the mini battlefield with a defeated board when opponent life is zero or lower', () => {
    fixture.componentRef.setInput('player', playerView({ life: 0 }));
    fixture.detectChanges();

    const board = fixture.nativeElement.querySelector('[data-testid="opponent-defeated-board"]') as HTMLElement;
    const skull = fixture.nativeElement.querySelector('[data-testid="opponent-mini-battlefield-skull"]') as HTMLImageElement;
    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).toBeNull();
    expect(board).not.toBeNull();
    expect(board.style.getPropertyValue('--opponent-defeated-background')).toContain('/assets/images/backgrounds/sunrise/bg-5.webp');
    expect(skull).not.toBeNull();
    expect(skull.getAttribute('src')).toBe('/assets/icons/gameplay/skull.png');
  });

  it('replaces the mini battlefield with a defeated board when opponent has lethal commander damage', () => {
    fixture.componentRef.setInput('player', playerView({ commanderDamage: { 'user-1': 21 } }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-opponent-mini-battlefield')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="opponent-defeated-board"]')).not.toBeNull();
  });

  it('keeps the defeated board instead of cards target when opponent life is zero or lower', () => {
    fixture.componentRef.setInput('player', playerView({ life: -3 }));
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

function helperEntity(
  template: GameSpecialEntity['template'],
  ownerPlayerId: string | null,
  state: Record<string, unknown> = {},
): GameSpecialEntity {
  return {
    id: `${template}-${ownerPlayerId ?? 'global'}`,
    template,
    scope: ownerPlayerId ? 'player' : 'global',
    ownerPlayerId,
    card: null,
    state,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
