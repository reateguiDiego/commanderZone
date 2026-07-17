import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, RotateCw, X } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { ActiveRevealPanelComponent } from './active-reveal-panel.component';

describe('ActiveRevealPanelComponent', () => {
  let fixture: ComponentFixture<ActiveRevealPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActiveRevealPanelComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ RotateCw, X }))],
    }).compileComponents();
  });

  afterEach(() => fixture?.destroy());

  it('is an accessible transient dialog with initial focus, keyboard navigation and body lock', async () => {
    fixture = createFixture({ cards: [card('one'), card('two')] });
    await settle();

    const host = fixture.nativeElement as HTMLElement;
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    const cards = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-card-instance-id]'));
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('active-reveal-title');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(cards[0]);

    cards[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cards[1]);
  });

  it('shows owner recipients and delegates revoke without implementing a second revoke path', () => {
    fixture = createFixture({ ownerMode: true, cards: [card('shared', ['player-2'])] });
    const revoke = vi.fn();
    fixture.componentInstance.revokeRequested.subscribe(revoke);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="active-reveal-recipients"]')?.textContent).toContain('Bob');
    (fixture.nativeElement.querySelector('.active-reveal-sharing button') as HTMLButtonElement).click();
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'shared' }));
  });

  it('never renders other recipients or mutating controls for a target viewer', () => {
    fixture = createFixture({ cards: [card('visible', ['player-2', 'secret-viewer'])] });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;

    expect(text).not.toContain('Hidden Recipient');
    expect(fixture.nativeElement.querySelector('[data-testid="active-reveal-recipients"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-view-x-selected]')).toBeNull();
  });

  it('supports local DFC preview and no-image fallback without changing card identity', () => {
    fixture = createFixture({ cards: [transformCard('dfc'), { ...card('no-image'), imageUris: {} }] });
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.double-face-toggle') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    toggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.cards().map((entry) => entry.instanceId)).toEqual(['dfc', 'no-image']);
    expect(fixture.nativeElement.querySelectorAll('.card-spoiler-fallback').length).toBe(1);
  });

  it('closes on Escape and traps Tab inside the dialog', () => {
    fixture = createFixture({ cards: [card('one')] });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect((fixture.nativeElement as HTMLElement).contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(closed).toHaveBeenCalledOnce();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
  }
});

function createFixture(options: { ownerMode?: boolean; cards: readonly GameCardInstance[] }): ComponentFixture<ActiveRevealPanelComponent> {
  const fixture = TestBed.createComponent(ActiveRevealPanelComponent);
  const owner = player('player-1', 'Alice');
  fixture.componentRef.setInput('owner', owner);
  fixture.componentRef.setInput('viewerPlayerId', options.ownerMode ? 'player-1' : 'player-2');
  fixture.componentRef.setInput('ownerMode', options.ownerMode ?? false);
  fixture.componentRef.setInput('cards', options.cards);
  fixture.componentRef.setInput('players', [owner, player('player-2', 'Bob'), player('secret-viewer', 'Hidden Recipient')]);
  fixture.componentRef.setInput('cardImage', (value: GameCardInstance) => value.cardFaces?.[value.activeFaceIndex ?? 0]?.imageUris.normal
    ?? value.imageUris?.['normal']
    ?? null);
  fixture.componentRef.setInput('responsiveState', 'normal');

  return fixture;
}

function player(id: string, displayName: string): PlayerView {
  return {
    id,
    state: {
      user: { id, email: `${id}@test`, displayName, roles: [] },
      status: 'active', life: 40, commanderDamage: {}, counters: {},
      zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
    },
  } as PlayerView;
}

function card(instanceId: string, revealedTo: readonly string[] = ['player-2']): GameCardInstance {
  return {
    instanceId, ownerId: 'player-1', controllerId: 'player-1', name: instanceId,
    zone: 'hand', tapped: false, hidden: false, revealedTo: [...revealedTo],
    imageUris: { normal: `/${instanceId}.jpg` },
  };
}

function transformCard(instanceId: string): GameCardInstance {
  return {
    ...card(instanceId),
    cardFaces: [
      { name: 'Front', manaCost: null, typeLine: 'Creature', oracleText: '', power: '1', toughness: '1', loyalty: null, colors: [], imageUris: { normal: '/front.jpg' } },
      { name: 'Back', manaCost: null, typeLine: 'Creature', oracleText: '', power: '2', toughness: '2', loyalty: null, colors: [], imageUris: { normal: '/back.jpg' } },
    ],
  };
}
