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

    const battlefield = fixture.nativeElement.querySelector('[data-testid="opponent-mini-battlefield"]') as HTMLElement;
    vi.spyOn(battlefield, 'getBoundingClientRect').mockReturnValue(domRect({ left: 10, top: 20, width: 240, height: 172 }));
    const [layout] = fixture.componentInstance.cardLayouts();
    battlefield.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 10 + layout!.left + layout!.width / 2,
      clientY: 20 + layout!.top + layout!.height / 2,
      bubbles: true,
    }));
    battlefield.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

    expect(previewShown).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-2',
      zone: 'battlefield',
      card: expect.objectContaining({ instanceId: 'card-1' }),
      sourceRect: expect.objectContaining({ left: 10 + layout!.left, top: 20 + layout!.top }),
    }));
    expect(previewHidden).toHaveBeenCalledOnce();
  });

  it('uses mini battlefield hit-testing so partially overlapped cards can request preview', () => {
    const previewShown = vi.fn();
    fixture.componentRef.setInput('cards', [
      { ...card('upper-card'), position: { x: 0, y: 0 } },
      { ...card('lower-card'), position: { x: 10, y: 25 } },
    ]);
    fixture.componentInstance.cardPreviewShown.subscribe(previewShown);
    fixture.detectChanges();

    const battlefield = fixture.nativeElement.querySelector('[data-testid="opponent-mini-battlefield"]') as HTMLElement;
    vi.spyOn(battlefield, 'getBoundingClientRect').mockReturnValue(domRect({ left: 0, top: 0, width: 240, height: 172 }));
    const lowerLayout = fixture.componentInstance.cardLayouts().find((layout) => layout.instanceId === 'lower-card')!;
    battlefield.dispatchEvent(new PointerEvent('pointermove', {
      clientX: lowerLayout.left + lowerLayout.width / 2,
      clientY: lowerLayout.top + lowerLayout.height / 2,
      bubbles: true,
    }));

    expect(previewShown).toHaveBeenCalledWith(expect.objectContaining({
      card: expect.objectContaining({ instanceId: 'lower-card' }),
    }));
  });

  it('emits battlefield card clicks with opponent context', () => {
    const clicked = vi.fn();
    fixture.componentInstance.battlefieldCardClicked.subscribe(clicked);
    fixture.detectChanges();

    const renderedCard = fixture.nativeElement.querySelector('[data-testid="mini-battlefield-card"]') as HTMLElement;
    renderedCard.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clicked).toHaveBeenCalledWith(expect.objectContaining({
      playerId: 'player-2',
      card: expect.objectContaining({ instanceId: 'card-1' }),
    }));
  });
});

function domRect(rect: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect;
}

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
