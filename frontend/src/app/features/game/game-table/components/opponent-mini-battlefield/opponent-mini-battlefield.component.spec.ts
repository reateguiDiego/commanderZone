import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, RotateCw } from 'lucide-angular';
import { GameAttachment, GameCardInstance } from '../../../../../core/models/game.model';
import { OpponentMiniBattlefieldComponent } from './opponent-mini-battlefield.component';

describe('OpponentMiniBattlefieldComponent', () => {
  let fixture: ComponentFixture<OpponentMiniBattlefieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpponentMiniBattlefieldComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ RotateCw }))],
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

  it('renders mechanic cards in the top-right mini overlay without duplicating them in the normal layout', () => {
    const monarch = { ...card('monarch-card'), name: 'The Monarch', layout: 'monarch' };
    fixture.componentRef.setInput('cards', [card('normal-card'), monarch]);
    fixture.componentRef.setInput('mechanicCards', [monarch]);
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('[data-testid="battlefield-mechanics-overlay"]') as HTMLElement | null;

    expect(overlay).not.toBeNull();
    expect(overlay?.dataset['variant']).toBe('mini');
    expect(fixture.componentInstance.layoutCards().map((current) => current.instanceId)).toEqual(['normal-card']);
    expect(fixture.nativeElement.querySelector('[data-testid="mini-battlefield-card"][data-card-instance-id="normal-card"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="battlefield-mechanics-mini-card"][data-card-instance-id="monarch-card"]')).not.toBeNull();
  });

  it('exposes the opponent battlefield as a motion zone', () => {
    fixture.detectChanges();

    const battlefield = fixture.nativeElement.querySelector('[data-testid="opponent-mini-battlefield"]') as HTMLElement;
    expect(battlefield.dataset['motionZone']).toBe('player-2:battlefield');
  });

  it('updates when battlefield cards change', () => {
    fixture.detectChanges();

    fixture.componentRef.setInput('cards', [card('card-1'), card('card-2'), card('card-3')]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-testid="mini-battlefield-card"]').length).toBe(3);
  });

  it('renders an empty mini battlefield without a placeholder label', () => {
    fixture.componentRef.setInput('cards', []);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="mini-battlefield-card"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('No permanents');
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

  it('renders attached cards as a diagonal mini stack from the target card', () => {
    fixture.componentRef.setInput('cards', [
      { ...card('target'), position: { x: 100, y: 160 } },
      { ...card('equipment'), position: { x: 560, y: 330 } },
    ]);
    fixture.componentRef.setInput('attachments', [attachment('attachment-1', 'equipment', 'target')]);
    fixture.detectChanges();

    const targetLayout = fixture.componentInstance.cardLayouts().find((layout) => layout.instanceId === 'target')!;
    const equipmentLayout = fixture.componentInstance.cardLayouts().find((layout) => layout.instanceId === 'equipment')!;
    const targetElement = miniCardElement(fixture, 'target');
    const equipmentElement = miniCardElement(fixture, 'equipment');

    expect(equipmentLayout.left).toBeGreaterThan(targetLayout.left);
    expect(equipmentLayout.top).toBeLessThan(targetLayout.top);
    expect(equipmentLayout.left - targetLayout.left).toBeLessThanOrEqual(6);
    expect(targetLayout.top - equipmentLayout.top).toBeLessThanOrEqual(9);
    expect(targetElement.classList).toContain('attachment-stack-target');
    expect(equipmentElement.classList).toContain('attachment-stack-equipment');
  });

  it('adds a mini glow to the card currently feeding the hover preview', () => {
    fixture.detectChanges();

    const battlefield = fixture.nativeElement.querySelector('[data-testid="opponent-mini-battlefield"]') as HTMLElement;
    vi.spyOn(battlefield, 'getBoundingClientRect').mockReturnValue(domRect({ left: 0, top: 0, width: 240, height: 172 }));
    const targetLayout = fixture.componentInstance.cardLayouts().find((layout) => layout.instanceId === 'card-1')!;
    battlefield.dispatchEvent(new PointerEvent('pointermove', {
      clientX: targetLayout.left + targetLayout.width / 2,
      clientY: targetLayout.top + targetLayout.height / 2,
      bubbles: true,
    }));
    fixture.detectChanges();

    expect(miniCardElement(fixture, 'card-1').classList).toContain('mini-preview-active');
    expect(miniCardElement(fixture, 'card-2').classList).not.toContain('mini-preview-active');
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

  it('shows the face look button on mini double-faced cards and emits the alternate preview', () => {
    const previewShown = vi.fn();
    fixture.componentRef.setInput('cards', [{
      ...card('double-faced-card'),
      cardFaces: [
        cardFace('Birgi, God of Storytelling'),
        cardFace('Harnfel, Horn of Bounty'),
      ],
    }]);
    fixture.componentInstance.cardPreviewShown.subscribe(previewShown);
    fixture.detectChanges();

    const renderedCard = miniCardElement(fixture, 'double-faced-card');
    const toggle = renderedCard.querySelector('.double-face-toggle') as HTMLElement | null;

    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('title')).toBe('Look at other face');

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(previewShown).toHaveBeenNthCalledWith(1, expect.objectContaining({
      playerId: 'player-2',
      zone: 'battlefield',
      card: expect.objectContaining({ instanceId: 'double-faced-card', activeFaceIndex: 1 }),
    }));
    expect(previewShown).toHaveBeenNthCalledWith(2, expect.objectContaining({
      playerId: 'player-2',
      zone: 'battlefield',
      card: expect.objectContaining({ instanceId: 'double-faced-card', activeFaceIndex: 0 }),
    }));
  });
});

function miniCardElement(fixture: ComponentFixture<OpponentMiniBattlefieldComponent>, instanceId: string): HTMLElement {
  const element = fixture.nativeElement.querySelector(`[data-testid="mini-battlefield-card"][data-card-instance-id="${instanceId}"]`);
  expect(element).not.toBeNull();

  return element as HTMLElement;
}

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

function cardFace(name: string) {
  return {
    name,
    manaCost: null,
    typeLine: null,
    oracleText: null,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    imageUris: { normal: `/cards/${name}.jpg` },
  };
}

function attachment(id: string, equipmentInstanceId: string, attachedToInstanceId: string): GameAttachment {
  return {
    id,
    equipmentInstanceId,
    attachedToInstanceId,
    createdAt: '2026-05-29T00:00:00.000Z',
  };
}
