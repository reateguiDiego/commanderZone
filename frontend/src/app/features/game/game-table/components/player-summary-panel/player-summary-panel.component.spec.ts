import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Biohazard, ChevronDown, LucideAngularModule, Plus, Radiation, Sparkles, Tickets, Zap } from 'lucide-angular';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../state/core/game-table-snapshot-selectors';
import { PlayerSummaryPanelComponent } from './player-summary-panel.component';

describe('PlayerSummaryPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerSummaryPanelComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Biohazard, ChevronDown, Plus, Radiation, Sparkles, Tickets, Zap }))],
    }).compileComponents();
  });

  it('opens and closes the extra player controls menu', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')).toBeNull();

    extraToggle(fixture).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Commander damage');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Other counters');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Opponent');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Raggadragga, Goreguts Boss');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Poison');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Tickets');
    expect(fixture.componentInstance.playerCounterTrackers[0].icon).toBe('biohazard');

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')).toBeNull();
  });

  it('emits life changes from the life total control', () => {
    const fixture = createFixture();
    const lifeChanged = vi.fn();
    fixture.componentInstance.lifeChanged.subscribe(lifeChanged);

    const lifeButton = fixture.nativeElement.querySelector('[data-testid="life-value"]') as HTMLButtonElement;
    const parentContextMenu = vi.fn();
    fixture.nativeElement.addEventListener('contextmenu', parentContextMenu);
    lifeButton.click();
    lifeButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(lifeChanged).toHaveBeenNthCalledWith(1, { playerId: 'player-1', delta: 1 });
    expect(lifeChanged).toHaveBeenNthCalledWith(2, { playerId: 'player-1', delta: -1 });
    expect(parentContextMenu).not.toHaveBeenCalled();
  });

  it('emits commander damage and player counter changes from the extra controls', () => {
    const fixture = createFixture();
    const commanderDamageChanged = vi.fn();
    const playerCounterChanged = vi.fn();
    fixture.componentInstance.commanderDamageChanged.subscribe(commanderDamageChanged);
    fixture.componentInstance.playerCounterChanged.subscribe(playerCounterChanged);

    extraToggle(fixture).click();
    fixture.detectChanges();

    const addCommanderDamage = fixture.nativeElement.querySelector('[aria-label="Add commander damage from Opponent"]') as HTMLButtonElement;
    const removePoison = fixture.nativeElement.querySelector('[aria-label="Remove Poison counter"]') as HTMLButtonElement;

    addCommanderDamage.click();
    removePoison.click();

    expect(commanderDamageChanged).toHaveBeenCalledWith({ targetPlayerId: 'player-1', sourcePlayerId: 'player-2', delta: 1 });
    expect(playerCounterChanged).toHaveBeenCalledWith({ playerId: 'player-1', key: 'poison', delta: -1 });
  });

  it('keeps other counters collapsed by default when every other counter is zero', () => {
    const fixture = createFixture({ counterValues: {} });

    extraToggle(fixture).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-label="Remove Poison counter"]')).toBeNull();

    const otherCountersToggle = fixture.nativeElement.querySelector('.counter-menu-toggle') as HTMLButtonElement;
    expect(otherCountersToggle.getAttribute('aria-expanded')).toBe('false');

    otherCountersToggle.click();
    fixture.detectChanges();

    expect(otherCountersToggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('[aria-label="Remove Poison counter"]')).not.toBeNull();
  });

  it('renders extra controls as read-only when the player cannot be edited', () => {
    const fixture = createFixture({ canEditCounters: false });
    const commanderDamageChanged = vi.fn();
    const playerCounterChanged = vi.fn();
    fixture.componentInstance.commanderDamageChanged.subscribe(commanderDamageChanged);
    fixture.componentInstance.playerCounterChanged.subscribe(playerCounterChanged);

    extraToggle(fixture).click();
    fixture.detectChanges();

    const addCommanderDamage = fixture.nativeElement.querySelector('[aria-label="Add commander damage from Opponent"]');
    const removePoison = fixture.nativeElement.querySelector('[aria-label="Remove Poison counter"]');
    const readonlyValues = fixture.nativeElement.querySelectorAll('.counter-readonly-value');

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).not.toContain('Read only');
    expect(addCommanderDamage).toBeNull();
    expect(removePoison).toBeNull();
    expect(readonlyValues.length).toBeGreaterThan(0);

    fixture.componentInstance.changeCommanderDamage(new MouseEvent('click'), 'player-2', 1);
    fixture.componentInstance.changePlayerCounter(new MouseEvent('click'), 'poison', -1);

    expect(commanderDamageChanged).not.toHaveBeenCalled();
    expect(playerCounterChanged).not.toHaveBeenCalled();
  });
});

function createFixture(options: { canEditCounters?: boolean; counterValues?: Partial<Record<string, number>> } = {}): ComponentFixture<PlayerSummaryPanelComponent> {
  const fixture = TestBed.createComponent(PlayerSummaryPanelComponent);
  const currentPlayer = player('player-1', 'Player', { commanderDamage: { 'player-2': 7 } });
  const opponent = player('player-2', 'Opponent', {
    command: [card('commander-1', 'Raggadragga, Goreguts Boss')],
  });
  fixture.componentRef.setInput('player', currentPlayer);
  fixture.componentRef.setInput('players', [currentPlayer, opponent]);
  fixture.componentRef.setInput('colorAccent', () => '#d7b46a');
  fixture.componentRef.setInput('deckLabel', () => 'Test deck');
  fixture.componentRef.setInput('manaSymbols', () => ['B', 'G']);
  fixture.componentRef.setInput('playerCounterValue', (_player: PlayerView, key: string) => (
    options.counterValues ? options.counterValues[key] ?? 0 : key === 'poison' ? 3 : 0
  ));
  fixture.componentRef.setInput('canEditCounters', options.canEditCounters ?? true);
  fixture.detectChanges();

  return fixture;
}

function extraToggle(fixture: ComponentFixture<PlayerSummaryPanelComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-toggle') as HTMLButtonElement;
}

function player(
  id: string,
  displayName: string,
  overrides: {
    command?: GameCardInstance[];
    commanderDamage?: Record<string, number>;
  } = {},
): PlayerView {
  return {
    id,
    state: {
      user: { id, email: `${id}@test`, displayName, roles: [] },
      status: 'active',
      life: 40,
      commanderDamage: overrides.commanderDamage ?? {},
      counters: {},
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: overrides.command ?? [],
      } satisfies Record<GameZoneName, GameCardInstance[]>,
    },
  } as unknown as PlayerView;
}

function card(instanceId: string, name: string): GameCardInstance {
  return {
    instanceId,
    ownerId: 'player-2',
    controllerId: 'player-2',
    name,
    imageUris: {},
    cardFaces: [],
    typeLine: 'Legendary Creature',
    tapped: false,
    isCommander: true,
  };
}
