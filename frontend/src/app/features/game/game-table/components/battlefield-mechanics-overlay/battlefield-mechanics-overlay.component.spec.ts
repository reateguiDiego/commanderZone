import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, Minus, Plus, RotateCcw, X } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { BattlefieldMechanicsOverlayComponent } from './battlefield-mechanics-overlay.component';

describe('BattlefieldMechanicsOverlayComponent', () => {
  let fixture: ComponentFixture<BattlefieldMechanicsOverlayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BattlefieldMechanicsOverlayComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Minus, Plus, RotateCcw, X })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BattlefieldMechanicsOverlayComponent);
    fixture.componentRef.setInput('playerId', 'user-1');
    fixture.componentRef.setInput('image', (card: GameCardInstance) => card.imageUris?.['normal'] ?? null);
  });

  it('does not render a surface when there are no mechanic cards', () => {
    fixture.componentRef.setInput('cards', []);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="battlefield-mechanics-overlay"]')).toBeNull();
  });

  it('requests left-opening context menus for mechanic overlay cards', () => {
    const card = mechanicCard('monarch:1', 'Monarch');
    const opened = vi.fn();
    fixture.componentInstance.cardMenuOpened.subscribe(opened);

    fixture.componentInstance.openBattlefieldCardMenu(new MouseEvent('contextmenu'), card);
    fixture.componentInstance.openMiniCardMenu(new MouseEvent('contextmenu'), card);

    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ card, forceOpenLeft: true }));
    expect(opened).toHaveBeenCalledTimes(2);
  });
});

function mechanicCard(instanceId: string, name: string): GameCardInstance {
  return {
    instanceId,
    ownerId: 'user-1',
    controllerId: 'user-1',
    name,
    typeLine: 'Card',
    layout: 'token',
    imageUris: { normal: `/cards/${instanceId}.jpg` },
    tapped: false,
    counters: {},
    zone: 'battlefield',
  };
}
