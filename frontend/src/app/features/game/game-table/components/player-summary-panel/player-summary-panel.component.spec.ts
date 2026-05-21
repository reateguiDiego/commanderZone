import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Biohazard, ChevronDown, LucideAngularModule, Minus, Plus, Radiation, Sparkles, Tickets, Zap } from 'lucide-angular';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../state/core/game-table-snapshot-selectors';
import {
  PLAYER_SUMMARY_ACTION_DEBOUNCE_MS,
  PLAYER_SUMMARY_LIFE_FEEDBACK_EXIT_MS,
  PlayerSummaryPanelComponent,
} from './player-summary-panel.component';

describe('PlayerSummaryPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerSummaryPanelComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Biohazard, ChevronDown, Minus, Plus, Radiation, Sparkles, Tickets, Zap }))],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('emits life changes from visible life controls and legacy total gestures', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const lifeChanged = vi.fn();
    fixture.componentInstance.lifeChanged.subscribe(lifeChanged);

    const lifeButton = fixture.nativeElement.querySelector('[data-testid="life-value"]') as HTMLButtonElement;
    const decreaseButton = fixture.nativeElement.querySelector('[data-testid="life-decrease"]') as HTMLButtonElement;
    const increaseButton = fixture.nativeElement.querySelector('[data-testid="life-increase"]') as HTMLButtonElement;
    const parentContextMenu = vi.fn();
    fixture.nativeElement.addEventListener('contextmenu', parentContextMenu);
    decreaseButton.click();
    increaseButton.click();
    lifeButton.click();
    lifeButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    increaseButton.click();
    fixture.detectChanges();

    expect(lifeButton.textContent?.trim()).toBe('41');
    expect(fixture.nativeElement.querySelector('.life-feedback-gain')?.textContent.trim()).toBe('+1');
    expect(fixture.nativeElement.querySelector('.life-feedback-damage')).toBeNull();
    expect(lifeChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS - 1);
    expect(lifeChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(lifeChanged).toHaveBeenCalledOnce();
    expect(lifeChanged).toHaveBeenCalledWith({ playerId: 'player-1', delta: 1 });
    expect(parentContextMenu).not.toHaveBeenCalled();
  });

  it('shows the net life feedback during the same debounce window', () => {
    vi.useFakeTimers();
    const fixture = createFixture();

    const decreaseButton = fixture.nativeElement.querySelector('[data-testid="life-decrease"]') as HTMLButtonElement;
    const increaseButton = fixture.nativeElement.querySelector('[data-testid="life-increase"]') as HTMLButtonElement;

    increaseButton.click();
    fixture.detectChanges();
    expect(lifeFeedbackText(fixture)).toBe('+1');

    increaseButton.click();
    increaseButton.click();
    increaseButton.click();
    fixture.detectChanges();
    expect(lifeFeedbackText(fixture)).toBe('+4');
    expect(fixture.nativeElement.querySelector('.life-total-gain')).not.toBeNull();

    decreaseButton.click();
    decreaseButton.click();
    decreaseButton.click();
    decreaseButton.click();
    fixture.detectChanges();
    expect(lifeFeedbackText(fixture)).toBe('0');
    expect(fixture.nativeElement.querySelector('.life-total-neutral')).not.toBeNull();

    decreaseButton.click();
    fixture.detectChanges();
    expect(lifeFeedbackText(fixture)).toBe('-1');
    expect(fixture.nativeElement.querySelector('.life-total-damage')).not.toBeNull();

    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.life-feedback-exiting')).not.toBeNull();
    vi.advanceTimersByTime(PLAYER_SUMMARY_LIFE_FEEDBACK_EXIT_MS);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.life-feedback')).toBeNull();
  });

  it('clamps life changes between -99 and 499 before emitting', () => {
    vi.useFakeTimers();
    const fixture = createFixture({ life: 499 });
    const lifeChanged = vi.fn();
    fixture.componentInstance.lifeChanged.subscribe(lifeChanged);

    const lifeButton = fixture.nativeElement.querySelector('[data-testid="life-value"]') as HTMLButtonElement;
    const decreaseButton = fixture.nativeElement.querySelector('[data-testid="life-decrease"]') as HTMLButtonElement;
    const increaseButton = fixture.nativeElement.querySelector('[data-testid="life-increase"]') as HTMLButtonElement;

    increaseButton.click();
    fixture.detectChanges();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(lifeButton.textContent?.trim()).toBe('499');
    expect(lifeChanged).not.toHaveBeenCalled();

    decreaseButton.click();
    fixture.detectChanges();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(lifeButton.textContent?.trim()).toBe('498');
    expect(lifeChanged).toHaveBeenCalledOnce();
    expect(lifeChanged).toHaveBeenCalledWith({ playerId: 'player-1', delta: -1 });

    const lowerFixture = createFixture({ life: -99 });
    const lowerLifeChanged = vi.fn();
    lowerFixture.componentInstance.lifeChanged.subscribe(lowerLifeChanged);
    const lowerLifeButton = lowerFixture.nativeElement.querySelector('[data-testid="life-value"]') as HTMLButtonElement;
    const lowerDecreaseButton = lowerFixture.nativeElement.querySelector('[data-testid="life-decrease"]') as HTMLButtonElement;
    const lowerIncreaseButton = lowerFixture.nativeElement.querySelector('[data-testid="life-increase"]') as HTMLButtonElement;

    lowerDecreaseButton.click();
    lowerFixture.detectChanges();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(lowerLifeButton.textContent?.trim()).toBe('-99');
    expect(lowerLifeChanged).not.toHaveBeenCalled();

    lowerIncreaseButton.click();
    lowerFixture.detectChanges();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(lowerLifeButton.textContent?.trim()).toBe('-98');
    expect(lowerLifeChanged).toHaveBeenCalledOnce();
    expect(lowerLifeChanged).toHaveBeenCalledWith({ playerId: 'player-1', delta: 1 });
  });

  it('emits commander damage and player counter changes from the extra controls', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const commanderDamageChanged = vi.fn();
    const playerCounterChanged = vi.fn();
    fixture.componentInstance.commanderDamageChanged.subscribe(commanderDamageChanged);
    fixture.componentInstance.playerCounterChanged.subscribe(playerCounterChanged);

    extraToggle(fixture).click();
    fixture.detectChanges();

    const addCommanderDamage = fixture.nativeElement.querySelector('[aria-label="Add commander damage from Opponent"]') as HTMLButtonElement;
    const removeCommanderDamage = fixture.nativeElement.querySelector('[aria-label="Remove commander damage from Opponent"]') as HTMLButtonElement;
    const addPoison = fixture.nativeElement.querySelector('[aria-label="Add Poison counter"]') as HTMLButtonElement;
    const removePoison = fixture.nativeElement.querySelector('[aria-label="Remove Poison counter"]') as HTMLButtonElement;

    addCommanderDamage.click();
    addCommanderDamage.click();
    removeCommanderDamage.click();
    removePoison.click();
    removePoison.click();
    addPoison.click();

    expect(commanderDamageChanged).not.toHaveBeenCalled();
    expect(playerCounterChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(commanderDamageChanged).toHaveBeenCalledOnce();
    expect(playerCounterChanged).toHaveBeenCalledOnce();
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

function createFixture(
  options: { canEditCounters?: boolean; counterValues?: Partial<Record<string, number>>; life?: number } = {},
): ComponentFixture<PlayerSummaryPanelComponent> {
  const fixture = TestBed.createComponent(PlayerSummaryPanelComponent);
  const currentPlayer = player('player-1', 'Player', { commanderDamage: { 'player-2': 7 }, life: options.life });
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

function lifeFeedbackText(fixture: ComponentFixture<PlayerSummaryPanelComponent>): string | undefined {
  return fixture.nativeElement.querySelector('.life-feedback')?.textContent.trim();
}

function player(
  id: string,
  displayName: string,
  overrides: {
    command?: GameCardInstance[];
    commanderDamage?: Record<string, number>;
    life?: number;
  } = {},
): PlayerView {
  return {
    id,
    state: {
      user: { id, email: `${id}@test`, displayName, roles: [] },
      status: 'active',
      life: overrides.life ?? 40,
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
