import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance } from '../../../../core/models/game.model';
import { OpponentMiniBattlefieldComponent } from './opponent-mini-battlefield.component';

describe('OpponentMiniBattlefieldComponent', () => {
  let fixture: ComponentFixture<OpponentMiniBattlefieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpponentMiniBattlefieldComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OpponentMiniBattlefieldComponent);
    fixture.componentRef.setInput('playerId', 'player-2');
    fixture.componentRef.setInput('cards', [card('card-1'), card('card-2')]);
    fixture.componentRef.setInput('cardPosition', (current: GameCardInstance) => current.position ?? null);
    fixture.componentRef.setInput('cardImage', () => null);
  });

  it('renders all cards received from the snapshot input', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-testid="mini-battlefield-card"]').length).toBe(2);
  });

  it('updates when battlefield cards change', () => {
    fixture.detectChanges();

    fixture.componentRef.setInput('cards', [card('card-1'), card('card-2'), card('card-3')]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-testid="mini-battlefield-card"]').length).toBe(3);
  });

  it('passes tapped and settling state to mini cards', () => {
    const tappedCard = { ...card('tapped-card'), tapped: true };
    fixture.componentRef.setInput('cards', [tappedCard]);
    fixture.componentRef.setInput('isCardDropSettling', (_playerId: string, _zone: string, current: GameCardInstance) =>
      current.instanceId === 'tapped-card'
    );
    fixture.detectChanges();

    const renderedCard = fixture.nativeElement.querySelector('[data-testid="mini-battlefield-card"]') as HTMLElement;
    expect(renderedCard.classList.contains('tapped')).toBe(true);
    expect(renderedCard.classList.contains('drop-settling')).toBe(true);
  });

  it('emits preview events with battlefield context', () => {
    const previewShown = vi.fn();
    const previewHidden = vi.fn();
    fixture.componentInstance.cardPreviewShown.subscribe(previewShown);
    fixture.componentInstance.cardPreviewHidden.subscribe(previewHidden);
    fixture.detectChanges();

    const renderedCard = fixture.nativeElement.querySelector('[data-testid="mini-battlefield-card"]') as HTMLElement;
    renderedCard.dispatchEvent(new MouseEvent('mouseenter'));
    renderedCard.dispatchEvent(new MouseEvent('mouseleave'));

    expect(previewShown).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-2',
      zone: 'battlefield',
      card: expect.objectContaining({ instanceId: 'card-1' }),
    }));
    expect(previewHidden).toHaveBeenCalledOnce();
  });
});

function card(instanceId: string): GameCardInstance {
  return {
    instanceId,
    ownerId: 'player-2',
    controllerId: 'player-2',
    name: instanceId,
    tapped: false,
    counters: {},
  };
}
