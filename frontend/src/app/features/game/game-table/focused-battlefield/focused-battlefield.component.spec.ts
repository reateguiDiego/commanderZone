import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PlayerView } from '../game-table.store';
import { FocusedBattlefieldComponent } from './focused-battlefield.component';

describe('FocusedBattlefieldComponent', () => {
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
});

interface RenderFocusedBattlefieldOptions {
  alignmentGuideFor?: (playerId: string) => { y: number; referenceInstanceIds: readonly string[] } | null;
  isCardTransferPending?: (playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean;
}

async function renderFocusedBattlefield(options: RenderFocusedBattlefieldOptions = {}): Promise<{ fixture: ComponentFixture<FocusedBattlefieldComponent> }> {
  await TestBed.configureTestingModule({
    imports: [FocusedBattlefieldComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(FocusedBattlefieldComponent);
  fixture.componentRef.setInput('player', playerView());
  fixture.componentRef.setInput('isCurrentPlayer', (_playerId: string) => true);
  fixture.componentRef.setInput('isDropZoneHighlighted', (_playerId: string, _zone: GameZoneName) => false);
  fixture.componentRef.setInput('cardPosition', (_card: GameCardInstance) => null);
  fixture.componentRef.setInput('isSelected', (_instanceId: string) => false);
  fixture.componentRef.setInput('isDraggingCard', (_card: GameCardInstance) => false);
  fixture.componentRef.setInput('canDragBattlefieldCard', (_playerId: string, _card: GameCardInstance) => true);
  fixture.componentRef.setInput('isPendingBattlefieldTransfer', (_card: GameCardInstance) => false);
  fixture.componentRef.setInput('cardImage', (_card: GameCardInstance) => null);
  fixture.componentRef.setInput('shouldShowPowerToughness', (_card: GameCardInstance) => false);
  fixture.componentRef.setInput('cardPowerValue', (_card: GameCardInstance) => 0);
  fixture.componentRef.setInput('cardToughnessValue', (_card: GameCardInstance) => 0);
  fixture.componentRef.setInput('firstCounter', (_card: GameCardInstance) => null);
  fixture.componentRef.setInput('alignmentGuideFor', options.alignmentGuideFor ?? ((_playerId: string) => null));
  fixture.componentRef.setInput('isManaLaneHighlighted', (_playerId: string) => false);
  fixture.componentRef.setInput('isCardTransferPending', options.isCardTransferPending ?? ((_playerId: string, _zone: GameZoneName, _card: GameCardInstance) => false));
  fixture.detectChanges();

  return { fixture };
}

function cardElement(fixture: ComponentFixture<FocusedBattlefieldComponent>, instanceId: string): HTMLElement {
  return fixture.nativeElement.querySelector(`[data-card-instance-id="${instanceId}"]`);
}

function playerView(): PlayerView {
  return {
    id: 'player-1',
    state: {
      user: { id: 'player-1', email: 'user@test', displayName: 'User', roles: [] },
      status: 'active',
      life: 40,
      zones: {
        library: [],
        hand: [],
        battlefield: [
          { instanceId: 'card-1', name: 'Sol Ring', tapped: false },
          { instanceId: 'card-2', name: 'Arcane Signet', tapped: false },
          { instanceId: 'card-3', name: 'Cultivate', tapped: false },
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
