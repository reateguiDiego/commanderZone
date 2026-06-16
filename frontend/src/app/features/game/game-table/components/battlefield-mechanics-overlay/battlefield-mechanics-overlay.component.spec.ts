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

  it('renders mechanic cards in the provided order with fixed overlay sizing', () => {
    fixture.componentRef.setInput('cards', [
      mechanicCard('day-night:1', 'Day'),
      mechanicCard('monarch:1', 'Monarch'),
      mechanicCard('initiative:1', 'The Initiative'),
    ]);
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('[data-testid="battlefield-mechanics-overlay"]') as HTMLElement | null;
    const cards = Array.from(fixture.nativeElement.querySelectorAll('[data-card-instance-id]')) as HTMLElement[];

    expect(overlay).not.toBeNull();
    expect(cards.map((card) => card.getAttribute('data-card-instance-id'))).toEqual([
      'day-night:1',
      'monarch:1',
      'initiative:1',
    ]);
    expect(cards[0]?.closest('app-game-card-view')?.getAttribute('style')).toContain('--game-card-view-width: var(--battlefield-mechanics-card-width)');
  });

  it('renders mini mechanic cards as small right-aligned mini cards', () => {
    fixture.componentRef.setInput('variant', 'mini');
    fixture.componentRef.setInput('miniViewportSize', { width: 500, height: 260 });
    fixture.componentRef.setInput('cards', [
      mechanicCard('day-night:1', 'Day'),
      mechanicCard('emblem:1', 'Emblem'),
    ]);
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('[data-testid="battlefield-mechanics-overlay"]') as HTMLElement | null;
    const cards = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="battlefield-mechanics-mini-card"]')) as HTMLElement[];

    expect(overlay?.dataset['variant']).toBe('mini');
    expect(cards.length).toBe(2);
    expect(cards[0]?.style.width).toBe('45px');
    expect(cards[0]?.style.height).toBe('63px');
    expect(cards[0]?.style.left).toBe('409px');
    expect(cards[1]?.style.left).toBe('455px');
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
