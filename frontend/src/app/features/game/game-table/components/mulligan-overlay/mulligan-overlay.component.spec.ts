import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CheckCircle2, ChevronDown, ChevronUp, LucideAngularModule, X } from 'lucide-angular';
import { GameCardInstance, GamePlayerMulliganState, MulliganRule } from '../../../../../core/models/game.model';
import { MulliganOverlayComponent } from './mulligan-overlay.component';

describe('MulliganOverlayComponent', () => {
  let fixture: ComponentFixture<MulliganOverlayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MulliganOverlayComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ CheckCircle2, ChevronDown, ChevronUp, X })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MulliganOverlayComponent);
    fixture.componentRef.setInput('cardImage', (card: GameCardInstance) => card.imageUris?.['normal'] ?? null);
    fixture.componentRef.setInput('currentPlayerId', 'player-1');
    fixture.componentRef.setInput('config', { rule: 'LONDON', firstMulliganFree: true });
    fixture.componentRef.setInput('hand', [card('card-1', 'Sol Ring'), card('card-2', 'Island'), card('card-3', 'Plains')]);
    fixture.componentRef.setInput('publicPlayers', [
      {
        playerId: 'player-2',
        displayName: 'Opponent',
        handCount: 7,
        mulligansTaken: 0,
        effectiveMulligans: 0,
        status: 'DECIDING',
        ready: false,
      },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the overlay in MULLIGAN phase', () => {
    setMulligan('LONDON', { bottomSelectionCount: 0 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="mulligan-overlay"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Mulligan');
  });

  it('hides the overlay in PLAYING phase', () => {
    setMulligan('LONDON', { bottomSelectionCount: 0 });
    fixture.componentRef.setInput('gamePhase', 'PLAYING');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="mulligan-overlay"]')).toBeNull();
  });

  it('shows bottom selection for London when bottomSelectionCount is greater than zero', () => {
    setMulligan('LONDON', { bottomSelectionCount: 1 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="mulligan-bottom-selection"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('The chosen order');
    expect(fixture.nativeElement.textContent).toContain('Desktop: right click to put a card on the bottom.');
    expect(fixture.nativeElement.textContent).toContain('Mobile/tablet: use the');
  });

  it('selects a bottom card with desktop contextmenu', () => {
    setMulligan('LONDON', { bottomSelectionCount: 1 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    selectCard('card-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('1 / 1 selected');
    expect(bottomPills().length).toBe(1);
    expect(bottomPills()[0].textContent).toContain('Sol Ring');
  });

  it('selects a bottom card with the mobile/tablet action button', () => {
    setMulligan('LONDON', { bottomSelectionCount: 1 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    selectCardWithButton('card-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('1 / 1 selected');
    expect(bottomPills().length).toBe(1);
    expect(bottomActionButton('card-1').textContent).toContain('Remove from bottom');
  });

  it('deselects a bottom card when removing its pill', () => {
    setMulligan('LONDON', { bottomSelectionCount: 1 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    selectCardWithButton('card-1');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[aria-label="Remove"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('0 / 1 selected');
    expect(bottomPills().length).toBe(0);
    expect(bottomActionButton('card-1').textContent).toContain('Put on bottom');
  });

  it('allows ordering London bottom pills and sends the visible order on accept', () => {
    const keepSpy = vi.fn();
    fixture.componentInstance.keep.subscribe(keepSpy);
    setMulligan('LONDON', { bottomSelectionCount: 2 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    selectCard('card-1');
    selectCard('card-2');
    fixture.detectChanges();

    (bottomPills()[0].querySelector('[aria-label="Move down"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    acceptButton().click();

    expect(keepSpy).toHaveBeenCalledWith(['card-2', 'card-1']);
  });

  it('shows random server-side order for Generous and does not render reorder buttons', () => {
    setMulligan('GENEROUS', { drawCount: 10, bottomSelectionCount: 3, bottomOrderMode: 'RANDOM_SERVER_SIDE' });
    fixture.componentRef.setInput('config', { rule: 'GENEROUS', firstMulliganFree: true });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    selectCard('card-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The final order');
    expect(fixture.nativeElement.querySelector('[aria-label="Subir"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label="Move down"]')).toBeNull();
  });

  it('shows ten opening cards for Generous and requires three selected bottom cards', () => {
    setMulligan('GENEROUS', { drawCount: 10, bottomSelectionCount: 3, bottomOrderMode: 'RANDOM_SERVER_SIDE' });
    fixture.componentRef.setInput('config', { rule: 'GENEROUS', firstMulliganFree: true });
    fixture.componentRef.setInput('hand', Array.from({ length: 10 }, (_, index) => card(`card-${index + 1}`, `Card ${index + 1}`)));
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.mulligan-card').length).toBe(10);
    expect(fixture.nativeElement.textContent).toContain('Choose 3');
    expect(acceptButton().disabled).toBe(true);

    selectCard('card-1');
    selectCard('card-2');
    fixture.detectChanges();
    expect(acceptButton().disabled).toBe(true);

    selectCard('card-3');
    fixture.detectChanges();
    expect(acceptButton().disabled).toBe(false);
  });

  it('shows Scry 1 for Vancouver while SCRYING', () => {
    setMulligan('VANCOUVER', {
      bottomSelectionCount: 0,
      needsScryAfterKeep: true,
      status: 'SCRYING',
      scryCard: card('scry-1', 'Brainstorm'),
    });
    fixture.componentRef.setInput('config', { rule: 'VANCOUVER', firstMulliganFree: false });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="mulligan-scry-panel"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Scry 1');
    expect(fixture.nativeElement.textContent).toContain('Keep on top');
    expect(fixture.nativeElement.textContent).toContain('Put on bottom');
  });

  it('does not show Scry for Paris', () => {
    setMulligan('PARIS', { bottomSelectionCount: 0, needsScryAfterKeep: false });
    fixture.componentRef.setInput('config', { rule: 'PARIS', firstMulliganFree: true });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="mulligan-scry-panel"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Scry 1');
  });

  it('shows waiting state and hides player actions when READY', () => {
    setMulligan('LONDON', { status: 'READY', ready: true });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="mulligan-ready-panel"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Waiting');
    expect(fixture.nativeElement.querySelector('[data-testid="mulligan-take"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mulligan-keep"]')).toBeNull();
  });

  it('stops overlay clicks from reaching the table behind it', () => {
    const clickSpy = vi.fn();
    setMulligan('LONDON', { bottomSelectionCount: 0 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();
    fixture.nativeElement.addEventListener('click', clickSpy);

    fixture.nativeElement.querySelector('[data-testid="mulligan-overlay"]').click();

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('keeps accept disabled until the required number of bottom cards is selected', () => {
    setMulligan('LONDON', { bottomSelectionCount: 2 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    expect(acceptButton().disabled).toBe(true);

    selectCard('card-1');
    fixture.detectChanges();
    expect(acceptButton().disabled).toBe(true);

    selectCard('card-2');
    fixture.detectChanges();
    expect(acceptButton().disabled).toBe(false);
  });

  it('enables keep after take when the private hand is ready and no bottom cards are required', () => {
    setMulligan('LONDON', {
      bottomSelectionCount: 0,
      needsBottomSelection: false,
      status: 'DECIDING',
      ready: false,
    });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.componentRef.setInput('pending', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.mulligan-card').length).toBe(3);
    expect(fixture.nativeElement.textContent).not.toContain('Unknown Card');
    expect(acceptButton().disabled).toBe(false);
  });

  it('keeps keep disabled while the mulligan action is still pending', () => {
    setMulligan('LONDON', { bottomSelectionCount: 0 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.componentRef.setInput('pending', true);
    fixture.detectChanges();

    expect(acceptButton().disabled).toBe(true);
  });

  it('does not emit keep until the player accepts the selected bottom cards', () => {
    const keepSpy = vi.fn();
    fixture.componentInstance.keep.subscribe(keepSpy);
    setMulligan('LONDON', { bottomSelectionCount: 1 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    selectCardWithButton('card-1');
    fixture.detectChanges();

    expect(keepSpy).not.toHaveBeenCalled();

    acceptButton().click();

    expect(keepSpy).toHaveBeenCalledWith(['card-1']);
  });

  it('distinguishes duplicated cards by instanceId when selecting bottom cards', () => {
    const keepSpy = vi.fn();
    fixture.componentInstance.keep.subscribe(keepSpy);
    fixture.componentRef.setInput('hand', [
      card('copy-a', 'Brainstorm'),
      card('copy-b', 'Brainstorm'),
      card('card-3', 'Island'),
    ]);
    setMulligan('LONDON', { bottomSelectionCount: 2 });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');
    fixture.detectChanges();

    selectCardWithButton('copy-a');
    selectCardWithButton('copy-b');
    fixture.detectChanges();
    acceptButton().click();

    expect(keepSpy).toHaveBeenCalledWith(['copy-a', 'copy-b']);
  });

  it('mounts and destroys without errors when reduced motion is enabled', () => {
    vi.stubGlobal('matchMedia', matchMediaMock(true));
    setMulligan('GENEROUS', { drawCount: 10, bottomSelectionCount: 3, bottomOrderMode: 'RANDOM_SERVER_SIDE' });
    fixture.componentRef.setInput('config', { rule: 'GENEROUS', firstMulliganFree: true });
    fixture.componentRef.setInput('gamePhase', 'MULLIGAN');

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(fixture.nativeElement.querySelector('[data-testid="mulligan-overlay"]')).not.toBeNull();
    expect(() => fixture.destroy()).not.toThrow();
  });

  function setMulligan(rule: MulliganRule, patch: Partial<GamePlayerMulliganState>): void {
    fixture.componentRef.setInput('currentMulligan', {
      rule,
      mulligansTaken: 0,
      effectiveMulligans: 0,
      drawCount: rule === 'GENEROUS' ? 10 : 7,
      bottomSelectionCount: 0,
      finalHandSize: 7,
      needsBottomSelection: false,
      bottomOrderMode: rule === 'LONDON' ? 'PLAYER_CHOSEN_ORDER' : rule === 'GENEROUS' ? 'RANDOM_SERVER_SIDE' : 'NONE',
      needsScryAfterKeep: false,
      canTakeAnotherMulligan: true,
      status: 'DECIDING',
      ready: false,
      ...patch,
    });
  }

  function selectCard(instanceId: string): void {
    const target = fixture.nativeElement.querySelector(
      `.mulligan-card[data-card-instance-id="${instanceId}"] [data-testid="game-card"]`,
    ) as HTMLElement;

    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
  }

  function selectCardWithButton(instanceId: string): void {
    bottomActionButton(instanceId).click();
  }

  function bottomActionButton(instanceId: string): HTMLButtonElement {
    return fixture.nativeElement.querySelector(
      `.mulligan-card[data-card-instance-id="${instanceId}"] .bottom-card-action`,
    ) as HTMLButtonElement;
  }

  function bottomPills(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid="mulligan-bottom-pill"]'));
  }

  function acceptButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="mulligan-keep"]') as HTMLButtonElement;
  }
});

function card(instanceId: string, name: string): GameCardInstance {
  return {
    instanceId,
    ownerId: 'player-1',
    controllerId: 'player-1',
    name,
    imageUris: { normal: `https://cards.test/${instanceId}.jpg` },
    tapped: false,
    counters: {},
  };
}

function matchMediaMock(matches: boolean): (query: string) => MediaQueryList {
  return (query: string): MediaQueryList => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList);
}
