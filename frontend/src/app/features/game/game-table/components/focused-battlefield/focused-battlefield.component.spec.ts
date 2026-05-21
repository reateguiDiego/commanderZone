import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { FocusedBattlefieldComponent } from './focused-battlefield.component';

describe('FocusedBattlefieldComponent', () => {
  it('exposes the player battlefield as a motion zone', async () => {
    const { fixture } = await renderFocusedBattlefield();

    const battlefield = fixture.nativeElement.querySelector('[data-testid="battlefield-zone"]') as HTMLElement;
    expect(battlefield.dataset['motionZone']).toBe('player-1:battlefield');
  });

  it('marks every card that acts as the active alignment reference', async () => {
    const { fixture } = await renderFocusedBattlefield({
      alignmentGuideFor: () => ({ y: 84, referenceInstanceIds: ['card-1', 'card-2'] }),
    });

    expect(cardElement(fixture, 'card-1').classList).toContain('alignment-reference');
    expect(cardElement(fixture, 'card-2').classList).toContain('alignment-reference');
    expect(cardElement(fixture, 'card-3').classList).not.toContain('alignment-reference');
  });

  it('hides a battlefield card while it is pending transfer to another zone', async () => {
    const { fixture } = await renderFocusedBattlefield({
      isCardTransferPending: (_playerId, _zone, card) => card.instanceId === 'card-1',
    });

    expect(cardElement(fixture, 'card-1').style.visibility).toBe('hidden');
    expect(cardElement(fixture, 'card-2').style.visibility).not.toBe('hidden');
  });

  it('emits a counter delete request from a zero marker', async () => {
    const { fixture } = await renderFocusedBattlefield({
      firstCounter: (card) => card.instanceId === 'card-1' ? { key: 'red', value: 0 } : null,
    });
    const opened = vi.fn();
    fixture.componentInstance.cardCounterDeleteRequested.subscribe(opened);

    const marker = cardElement(fixture, 'card-1').querySelector('.counter-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(opened).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-1',
      zone: 'battlefield',
      key: 'red',
    }));
  });

  it('allows selecting an opponent card while choosing an arrow target', async () => {
    const { fixture } = await renderFocusedBattlefield({
      isCurrentPlayer: (_playerId) => false,
      allowArrowTargetSelection: true,
    });
    const clicked = vi.fn();
    fixture.componentInstance.cardClicked.subscribe(clicked);

    cardElement(fixture, 'card-1').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clicked).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-1',
      card: expect.objectContaining({ instanceId: 'card-1' }),
    }));
  });

  it('keeps opponent battlefield clicks inert outside arrow targeting', async () => {
    const { fixture } = await renderFocusedBattlefield({
      isCurrentPlayer: (_playerId) => false,
    });
    const clicked = vi.fn();
    fixture.componentInstance.cardClicked.subscribe(clicked);

    cardElement(fixture, 'card-1').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clicked).not.toHaveBeenCalled();
  });

  it('lands creatures and planeswalkers from the nearest side while the board transitions', async () => {
    const { fixture } = await renderFocusedBattlefield();

    fixture.componentInstance.boardTransitioning.set(true);
    fixture.detectChanges();

    expect(cardElement(fixture, 'card-1').classList).toContain('focus-entry-left');
    expect(cardElement(fixture, 'card-2').classList).toContain('focus-entry-left');
    expect(cardElement(fixture, 'card-3').classList).not.toContain('focus-entry-left');
  });

  it('materializes non creature and non planeswalker cards during focus transitions', async () => {
    const { fixture } = await renderFocusedBattlefield();

    fixture.componentInstance.boardTransitioning.set(true);
    fixture.detectChanges();

    expect(cardElement(fixture, 'card-3').classList).toContain('focus-entry-fade');
  });

  it('does not mark focus entry classes while focus effects are disabled', async () => {
    const { fixture } = await renderFocusedBattlefield({ focusEffectsEnabled: false });

    fixture.componentInstance.boardTransitioning.set(true);
    fixture.detectChanges();

    expect(cardElement(fixture, 'card-1').classList).not.toContain('focus-entry-left');
    expect(cardElement(fixture, 'card-3').classList).not.toContain('focus-entry-fade');
  });

  it('renders land stack layers with the shared horizontal stack offset', async () => {
    const positions = new Map([
      ['land-top', { x: 100, y: 200 }],
      ['land-under', { x: 100, y: 186 }],
    ]);
    const { fixture } = await renderFocusedBattlefield({
      battlefieldCards: [
        { instanceId: 'land-top', name: 'Command Tower', typeLine: 'Land', tapped: false },
        { instanceId: 'land-under', name: 'Island', typeLine: 'Basic Land - Island', tapped: false },
      ],
      cardPosition: (card) => positions.get(card.instanceId) ?? null,
    });

    expect(cardElement(fixture, 'land-top').style.left).toBe('100px');
    expect(cardElement(fixture, 'land-under').style.left).toBe('110px');
    expect(cardElement(fixture, 'land-under').style.top).toBe('186px');
  });
});

interface RenderFocusedBattlefieldOptions {
  battlefieldCards?: GameCardInstance[];
  alignmentGuideFor?: (playerId: string) => { y: number; referenceInstanceIds: readonly string[] } | null;
  cardPosition?: (card: GameCardInstance) => { x: number; y: number } | null;
  isCurrentPlayer?: (playerId: string) => boolean;
  allowArrowTargetSelection?: boolean;
  isCardTransferPending?: (playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean;
  firstCounter?: (card: GameCardInstance) => { key: string; value: number } | null;
  focusEffectsEnabled?: boolean;
}

async function renderFocusedBattlefield(options: RenderFocusedBattlefieldOptions = {}): Promise<{ fixture: ComponentFixture<FocusedBattlefieldComponent> }> {
  await TestBed.configureTestingModule({
    imports: [FocusedBattlefieldComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(FocusedBattlefieldComponent);
  fixture.componentRef.setInput('player', playerView(options.battlefieldCards));
  fixture.componentRef.setInput('isCurrentPlayer', options.isCurrentPlayer ?? ((_playerId: string) => true));
  fixture.componentRef.setInput('allowArrowTargetSelection', options.allowArrowTargetSelection ?? false);
  fixture.componentRef.setInput('focusEffectsEnabled', options.focusEffectsEnabled ?? true);
  fixture.componentRef.setInput('isDropZoneHighlighted', (_playerId: string, _zone: GameZoneName) => false);
  fixture.componentRef.setInput('cardPosition', options.cardPosition ?? ((_card: GameCardInstance) => null));
  fixture.componentRef.setInput('isSelected', (_instanceId: string) => false);
  fixture.componentRef.setInput('isDraggingCard', (_card: GameCardInstance) => false);
  fixture.componentRef.setInput('canDragBattlefieldCard', (_playerId: string, _card: GameCardInstance) => true);
  fixture.componentRef.setInput('isPendingBattlefieldTransfer', (_card: GameCardInstance) => false);
  fixture.componentRef.setInput('cardImage', (_card: GameCardInstance) => null);
  fixture.componentRef.setInput('shouldShowPowerToughness', (_card: GameCardInstance) => false);
  fixture.componentRef.setInput('cardPowerValue', (_card: GameCardInstance) => 0);
  fixture.componentRef.setInput('cardToughnessValue', (_card: GameCardInstance) => 0);
  fixture.componentRef.setInput('firstCounter', options.firstCounter ?? ((_card: GameCardInstance) => null));
  fixture.componentRef.setInput('alignmentGuideFor', options.alignmentGuideFor ?? ((_playerId: string) => null));
  fixture.componentRef.setInput('isManaLaneHighlighted', (_playerId: string) => false);
  fixture.componentRef.setInput('isCardTransferPending', options.isCardTransferPending ?? ((_playerId: string, _zone: GameZoneName, _card: GameCardInstance) => false));
  fixture.detectChanges();

  return { fixture };
}

function cardElement(fixture: ComponentFixture<FocusedBattlefieldComponent>, instanceId: string): HTMLElement {
  return fixture.nativeElement.querySelector(`[data-card-instance-id="${instanceId}"]`);
}

function playerView(battlefieldCards?: GameCardInstance[]): PlayerView {
  return {
    id: 'player-1',
    state: {
      user: { id: 'player-1', email: 'user@test', displayName: 'User', roles: [] },
      status: 'active',
      life: 40,
      zones: {
        library: [],
        hand: [],
        battlefield: battlefieldCards ?? [
          { instanceId: 'card-1', name: 'Llanowar Elves', typeLine: 'Creature - Elf Druid', tapped: false },
          { instanceId: 'card-2', name: 'Liliana of the Veil', typeLine: 'Legendary Planeswalker - Liliana', tapped: false },
          { instanceId: 'card-3', name: 'Sol Ring', typeLine: 'Artifact', tapped: false },
        ],
        graveyard: [],
        exile: [],
        command: [],
      },
      zoneCounts: {
        library: 0,
        hand: 0,
        battlefield: 3,
        graveyard: 0,
        exile: 0,
        command: 0,
      },
      commanderDamage: {},
      counters: {},
    },
  };
}
